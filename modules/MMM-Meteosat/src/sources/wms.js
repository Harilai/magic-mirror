"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { inspectImage } = require("../sharpWorkerClient");
const { performance } = require("perf_hooks");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createTemporaryPath } = require("../cache");

const ENDPOINT = "https://view.eumetsat.int/geoserver/wms";
const REQUEST_TIMEOUT = 90_000;
const MINIMUM_IMAGE_SIZE = 10_000;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_CAPABILITIES_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 3600 * 3600;
const CAPABILITIES_CACHE_MAX_AGE = 60_000;
const capabilitiesCache = new Map();

class WmsRequestError extends Error {
  constructor(message, { status = null, retryable = false, details = null } = {}) {
    super(message);
    this.name = "WmsRequestError";
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

function sanitiseLogText(value, maxLength = 300) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, maxLength);
}

function combineSignals(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs} ms.`)), timeoutMs);
  const abort = () => controller.abort(externalSignal?.reason || new Error("Request aborted."));
  externalSignal?.addEventListener("abort", abort, { once: true });

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  };
}

async function readBodyWithLimit(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new WmsRequestError(`Response exceeds maximum size of ${maxBytes} bytes.`, {
      retryable: false,
      details: { declaredLength, maxBytes }
    });
  }

  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new WmsRequestError(`Response exceeded maximum size of ${maxBytes} bytes.`, {
        retryable: false,
        details: { receivedBytes: total, maxBytes }
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
async function streamResponseToFile(response, destination, maxBytes, { signal = null } = {}) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new WmsRequestError(`Response exceeds maximum size of ${maxBytes} bytes.`, {
      retryable: false,
      details: { declaredLength, maxBytes }
    });
  }
  if (!response.body) {
    throw new WmsRequestError("Response has no body.", { retryable: true });
  }

  const hash = crypto.createHash("sha256");
  let total = 0;
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new WmsRequestError(`Response exceeded maximum size of ${maxBytes} bytes.`, {
          retryable: false,
          details: { receivedBytes: total, maxBytes }
        }));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  const body = typeof response.body.pipe === "function" ? response.body : Readable.fromWeb(response.body);
  const destinationStream = fs.createWriteStream(destination, { flags: "wx", mode: 0o644 });

  try {
    if (signal) await pipeline(body, meter, destinationStream, { signal });
    else await pipeline(body, meter, destinationStream);
  } catch (error) {
    fs.rmSync(destination, { force: true });
    if (signal?.aborted || error.name === "AbortError" || error.code === "ABORT_ERR") {
      const aborted = new Error("Response streaming aborted.");
      aborted.name = "AbortError";
      throw aborted;
    }
    throw error;
  }

  return { bytes: total, hash: hash.digest("hex") };
}

async function discardResponseBody(response) {
  try {
    if (typeof response.body?.cancel === "function") await response.body.cancel();
    else response.body?.destroy?.();
  } catch {
    // The response is already closing; there is no additional recovery work.
  }
}

function buildUrl(profile, size, imageTime = null) {
  const query = new URLSearchParams({
    service: "WMS", version: "1.3.0", request: "GetMap",
    layers: profile.layer, styles: "", format: "image/png",
    transparent: "true", bgcolor: "0x000000",
    bbox: "-6500000,-6500000,6500000,6500000",
    width: String(size), height: String(size), srs: "AUTO:97004,9001,0,0"
  });
  if (imageTime) query.set("time", imageTime);
  return `${ENDPOINT}?${query}`;
}

function buildCapabilitiesUrl() {
  const query = new URLSearchParams({ service: "WMS", version: "1.3.0", request: "GetCapabilities" });
  return `${ENDPOINT}?${query}`;
}

function decodeXml(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
}

function parseTimeDimension(value) {
  const decoded = decodeXml(value).trim();
  const entries = decoded.split(",").map((entry) => entry.trim()).filter(Boolean);
  const candidates = [];
  const parsedEntries = [];
  for (const entry of entries) {
    const parts = entry.split("/");
    const selected = parts.length >= 2 ? parts[1] : parts[0];
    const timestamp = Date.parse(selected);
    parsedEntries.push({ raw: entry, start: parts[0] || null, end: parts[1] || null, period: parts[2] || null, selected });
    if (Number.isFinite(timestamp)) candidates.push(timestamp);
  }
  return { raw: decoded, entries: parsedEntries, latest: candidates.length ? new Date(Math.max(...candidates)).toISOString() : null };
}

function extractLatestLayerTime(xml, layerName) {
  const escapedName = layerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = new RegExp(`<Name>\\s*${escapedName}\\s*</Name>`, "i");
  const nameMatch = namePattern.exec(xml);
  if (!nameMatch) return { imageTime: null, dimension: null };
  const searchStart = nameMatch.index;
  const layerEnd = xml.indexOf("</Layer>", searchStart);
  const block = xml.slice(searchStart, layerEnd === -1 ? searchStart + 50_000 : layerEnd);
  const timePattern = /<(?:Dimension|Extent)\b[^>]*\bname=["']time["'][^>]*>([\s\S]*?)<\/(?:Dimension|Extent)>/i;
  const timeMatch = timePattern.exec(block);
  if (!timeMatch) return { imageTime: null, dimension: null };
  const dimension = parseTimeDimension(timeMatch[1]);
  return { imageTime: dimension.latest, dimension };
}

async function fetchLatestImageTime(profile, userAgent, debug = null, signal = null) {
  const cached = capabilitiesCache.get(profile.layer);
  const cacheAge = cached ? Date.now() - cached.checkedAt : null;
  if (cached && cacheAge < CAPABILITIES_CACHE_MAX_AGE) {
    debug?.("Capabilities cache", { result: "HIT", ageMs: cacheAge, maxAgeMs: CAPABILITIES_CACHE_MAX_AGE, imageTime: cached.imageTime });
    return { imageTime: cached.imageTime, source: "cache", durationMs: 0, dimension: cached.dimension || null };
  }

  const requestSignal = combineSignals(signal, REQUEST_TIMEOUT);
  const started = performance.now();
  let response;
  let body;
  try {
    response = await fetch(buildCapabilitiesUrl(), {
      headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1", "User-Agent": userAgent },
      signal: requestSignal.signal
    });
    body = await readBodyWithLimit(response, MAX_CAPABILITIES_BYTES);
  } catch (error) {
    if (error instanceof WmsRequestError) throw error;
    throw new WmsRequestError(`EUMETView capabilities request failed: ${sanitiseLogText(error.message)}`, {
      retryable: !signal?.aborted,
      details: { request: "GetCapabilities", durationMs: Math.round(performance.now() - started) }
    });
  } finally {
    requestSignal.cleanup();
  }

  const durationMs = Math.round(performance.now() - started);
  const contentType = response.headers.get("content-type");
  if (!response.ok) {
    const preview = sanitiseLogText(body.toString("utf8"));
    throw new WmsRequestError(`EUMETView capabilities request failed: HTTP ${response.status}${preview ? ` - ${preview}` : ""}`, {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
      details: { request: "GetCapabilities", durationMs, contentType, bodyPreview: preview }
    });
  }

  const xml = body.toString("utf8");
  const parsed = extractLatestLayerTime(xml, profile.layer);
  capabilitiesCache.set(profile.layer, { imageTime: parsed.imageTime, dimension: parsed.dimension, checkedAt: Date.now() });
  debug?.("GetCapabilities response", { status: response.status, contentType, bytes: body.length, durationMs, layer: profile.layer, rawTimeDimension: parsed.dimension?.raw || null, selectedAcquisition: parsed.imageTime });
  return { imageTime: parsed.imageTime, source: "network", durationMs, dimension: parsed.dimension };
}

async function downloadWmsImage({ profile, targetFile, tempFile, size, userAgent, imageTime = null, debug = null, signal = null, isActive = null }) {
  const timeResult = imageTime ? { imageTime } : await fetchLatestImageTime(profile, userAgent, debug, signal);
  const resolvedImageTime = timeResult.imageTime;
  const url = buildUrl(profile, size, resolvedImageTime);
  const started = performance.now();
  debug?.("GetMap request", { layer: profile.layer, time: resolvedImageTime || "latest", width: size, height: size, format: "image/png", url });

  const requestSignal = combineSignals(signal, REQUEST_TIMEOUT);
  let response;
  let streamed;
  let uniqueTempFile = null;
  try {
    response = await fetch(url, {
      headers: { Accept: "image/png,image/*;q=0.9", "User-Agent": userAgent },
      signal: requestSignal.signal
    });
    if (!response.ok) {
      await discardResponseBody(response);
    } else {
      uniqueTempFile = createTemporaryPath(tempFile);
      streamed = await streamResponseToFile(response, uniqueTempFile, MAX_IMAGE_BYTES, { signal: requestSignal.signal });
    }
  } catch (error) {
    if (error instanceof WmsRequestError || error.name === "AbortError") throw error;
    throw new WmsRequestError(`EUMETView WMS request failed: ${sanitiseLogText(error.message)}`, {
      retryable: !signal?.aborted,
      details: { request: "GetMap", durationMs: Math.round(performance.now() - started) }
    });
  } finally {
    requestSignal.cleanup();
  }

  const durationMs = Math.round(performance.now() - started);
  const contentType = response.headers.get("content-type");
  if (!response.ok) {
    throw new WmsRequestError(`EUMETView WMS request failed: HTTP ${response.status}.`, {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
      details: { request: "GetMap", durationMs, contentType }
    });
  }

  try {
    if (streamed.bytes < MINIMUM_IMAGE_SIZE) {
      throw new WmsRequestError(`EUMETView returned an unusually small image: ${streamed.bytes} bytes.`, {
        retryable: true,
        details: { request: "GetMap", durationMs, bytes: streamed.bytes, minimumBytes: MINIMUM_IMAGE_SIZE }
      });
    }

    let metadata;
    try {
      metadata = await inspectImage(uniqueTempFile, { signal });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new WmsRequestError(`EUMETView returned an unreadable image: ${sanitiseLogText(error.message)}`, {
        retryable: true,
        details: { request: "GetMap", durationMs, bytes: streamed.bytes }
      });
    }

    if (!["png", "jpeg"].includes(metadata.format)) {
      throw new WmsRequestError(`Unexpected WMS image format: ${metadata.format || "unknown"}.`, {
        retryable: true,
        details: { request: "GetMap", format: metadata.format || null }
      });
    }
    if ((metadata.width || 0) * (metadata.height || 0) > MAX_INPUT_PIXELS) {
      throw new WmsRequestError("WMS image pixel dimensions exceed the configured safety limit.", { retryable: false });
    }

    if (isActive && !isActive()) {
      const error = new Error("Obsolete download discarded.");
      error.name = "AbortError";
      throw error;
    }

    fs.renameSync(uniqueTempFile, targetFile);
    debug?.("GetMap response", {
      status: response.status, contentType, bytes: streamed.bytes, durationMs,
      format: metadata.format, width: metadata.width, height: metadata.height,
      channels: metadata.channels, hasAlpha: metadata.hasAlpha, sha256: streamed.hash
    });
    return {
      hash: streamed.hash,
      bytes: streamed.bytes,
      imageTime: resolvedImageTime,
      responseTime: response.headers.get("last-modified") || response.headers.get("date") || null,
      downloadedAt: new Date().toISOString(),
      source: "EUMETSAT EUMETView WMS",
      layer: profile.layer,
      durationMs,
      metadata
    };
  } finally {
    if (uniqueTempFile) fs.rmSync(uniqueTempFile, { force: true });
  }
}
module.exports = {
  downloadWmsImage,
  fetchLatestImageTime,
  WmsRequestError,
  sanitiseLogText,
  parseTimeDimension,
  extractLatestLayerTime,
  readBodyWithLimit,
  streamResponseToFile,
  discardResponseBody
};
