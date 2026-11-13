"use strict";

const fs = require("fs");
const path = require("path");
const { inspectImage } = require("./sharpWorkerClient");
const { createTemporaryPath } = require("./cache");
const { WmsRequestError, streamResponseToFile, discardResponseBody, sanitiseLogText } = require("./sources/wms");

const ENDPOINT = "https://view.eumetsat.int/geoserver/wms";
const REQUEST_TIMEOUT = 90_000;
const MAX_OVERLAY_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MINIMUM_MAX_AGE_MS = 60 * 60 * 1000;
const MAXIMUM_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const VARIANTS = Object.freeze({
  coastlines: Object.freeze({
    id: "coastlines",
    filename: "coastlines.png",
    layers: ["backgrounds:ne_10m_coastline"]
  }),
  borders: Object.freeze({
    id: "borders",
    filename: "country-borders.png",
    layers: ["backgrounds:ne_boundary_lines_land"]
  }),
  combined: Object.freeze({
    id: "combined",
    filename: "coastlines-and-borders.png",
    layers: ["backgrounds:ne_10m_coastline", "backgrounds:ne_boundary_lines_land"]
  })
});

function selectOverlayVariant(showCoastlines, showCountryBorders) {
  if (showCoastlines && showCountryBorders) return VARIANTS.combined;
  if (showCoastlines) return VARIANTS.coastlines;
  if (showCountryBorders) return VARIANTS.borders;
  return null;
}

function normaliseOverlayOpacity(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.6;
}

function getOverlayPaths(baseDirectory, size, variant) {
  const relativeDirectory = path.join("cache", "overlays", String(size));
  const directory = path.join(baseDirectory, relativeDirectory);
  return {
    directory,
    imageFile: path.join(directory, variant.filename),
    tempImageFile: path.join(directory, `${variant.filename}.tmp`),
    stateFile: path.join(directory, `${variant.id}.json`),
    tempStateFile: path.join(directory, `${variant.id}.json.tmp`),
    relativeImageFile: path.join(relativeDirectory, variant.filename).replaceAll(path.sep, "/")
  };
}

function validIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function validateOverlayState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state = {
    variant: Object.hasOwn(VARIANTS, value.variant) ? value.variant : null,
    layers: Array.isArray(value.layers) && value.layers.every((entry) => typeof entry === "string") ? value.layers : null,
    size: Number.isInteger(value.size) && value.size > 0 ? value.size : null,
    contentHash: /^[a-f0-9]{64}$/i.test(value.contentHash || "") ? value.contentHash : null,
    downloadedAt: validIsoDate(value.downloadedAt),
    checkedAt: validIsoDate(value.checkedAt),
    expiresAt: validIsoDate(value.expiresAt),
    cacheControl: typeof value.cacheControl === "string" ? value.cacheControl.slice(0, 300) : null,
    bytes: Number.isInteger(value.bytes) && value.bytes >= 0 ? value.bytes : null
  };
  return Object.fromEntries(Object.entries(state).filter(([, entry]) => entry !== null));
}

function readOverlayState(paths) {
  if (!fs.existsSync(paths.stateFile)) return {};
  try {
    return validateOverlayState(JSON.parse(fs.readFileSync(paths.stateFile, "utf8")));
  } catch {
    return {};
  }
}

function writeOverlayState(paths, state) {
  const validated = validateOverlayState(state);
  const temporaryFile = createTemporaryPath(paths.tempStateFile);
  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o644 });
    fs.renameSync(temporaryFile, paths.stateFile);
    return validated;
  } finally {
    fs.rmSync(temporaryFile, { force: true });
  }
}

function parseMaxAgeValue(cacheControl) {
  const match = String(cacheControl || "").match(/(?:^|,)\s*max-age\s*=\s*(\d+)/i);
  if (!match) return null;
  const milliseconds = Number(match[1]) * 1000;
  return Math.min(MAXIMUM_MAX_AGE_MS, Math.max(MINIMUM_MAX_AGE_MS, milliseconds));
}

function parseMaxAge(cacheControl) {
  return parseMaxAgeValue(cacheControl) ?? DEFAULT_MAX_AGE_MS;
}

function getExpiry(response, now = Date.now()) {
  const cacheControl = response.headers.get("cache-control") || "";
  const explicitMaxAgeMs = parseMaxAgeValue(cacheControl);
  const expiresHeader = response.headers.get("expires");
  const expiresValue = Date.parse(expiresHeader || "");
  let expiresAt;

  if (explicitMaxAgeMs !== null) expiresAt = now + explicitMaxAgeMs;
  else if (Number.isFinite(expiresValue) && expiresValue > now) expiresAt = Math.min(expiresValue, now + MAXIMUM_MAX_AGE_MS);
  else expiresAt = now + DEFAULT_MAX_AGE_MS;

  return { cacheControl, expiresAt: new Date(expiresAt).toISOString() };
}

function buildOverlayUrl(variant, size) {
  const query = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: variant.layers.join(","),
    styles: "",
    format: "image/png",
    transparent: "true",
    bbox: "-6500000,-6500000,6500000,6500000",
    width: String(size),
    height: String(size),
    srs: "AUTO:97004,9001,0,0"
  });
  return `${ENDPOINT}?${query}`;
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

async function downloadOverlay({ variant, size, paths, userAgent, signal = null, isActive = null, debug = null }) {
  const url = buildOverlayUrl(variant, size);
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
      uniqueTempFile = createTemporaryPath(paths.tempImageFile);
      streamed = await streamResponseToFile(response, uniqueTempFile, MAX_OVERLAY_BYTES, { signal: requestSignal.signal });
    }
  } catch (error) {
    if (error instanceof WmsRequestError || error.name === "AbortError") throw error;
    throw new WmsRequestError(`EUMETView overlay request failed: ${sanitiseLogText(error.message)}`, {
      retryable: !signal?.aborted,
      details: { request: "GetMap overlay", variant: variant.id }
    });
  } finally {
    requestSignal.cleanup();
  }

  if (!response.ok) {
    throw new WmsRequestError(`EUMETView overlay request failed: HTTP ${response.status}.`, {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
      details: { request: "GetMap overlay", variant: variant.id }
    });
  }

  try {
    let metadata;
    try {
      metadata = await inspectImage(uniqueTempFile, { signal });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new WmsRequestError(`EUMETView returned an unreadable overlay: ${sanitiseLogText(error.message)}`, { retryable: true });
    }

    if (metadata.format !== "png" || metadata.width !== size || metadata.height !== size || metadata.hasAlpha !== true) {
      throw new WmsRequestError("EUMETView returned an invalid overlay image.", {
        retryable: true,
        details: { format: metadata.format, width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha }
      });
    }
    if (isActive && !isActive()) {
      const error = new Error("Obsolete overlay download discarded.");
      error.name = "AbortError";
      throw error;
    }

    const previousState = readOverlayState(paths);
    const changed = previousState.contentHash !== streamed.hash || !fs.existsSync(paths.imageFile);
    if (changed) {
      fs.renameSync(uniqueTempFile, paths.imageFile);
      uniqueTempFile = null;
    }

    const checkedAt = new Date().toISOString();
    const expiry = getExpiry(response);
    const state = writeOverlayState(paths, {
      variant: variant.id,
      layers: variant.layers,
      size,
      contentHash: streamed.hash,
      downloadedAt: changed ? checkedAt : previousState.downloadedAt || checkedAt,
      checkedAt,
      expiresAt: expiry.expiresAt,
      cacheControl: expiry.cacheControl,
      bytes: streamed.bytes
    });
    debug?.("Overlay response", { variant: variant.id, layers: variant.layers, bytes: streamed.bytes, width: size, height: size, cacheControl: expiry.cacheControl, expiresAt: expiry.expiresAt, sha256: streamed.hash });
    return { paths, state, changed };
  } finally {
    if (uniqueTempFile) fs.rmSync(uniqueTempFile, { force: true });
  }
}
function overlayIsFresh(paths, state, now = Date.now()) {
  return fs.existsSync(paths.imageFile)
    && Number.isFinite(Date.parse(state.expiresAt))
    && Date.parse(state.expiresAt) > now;
}

async function ensureOverlay(options) {
  const { baseDirectory, variant, size } = options;
  if (!variant) return null;
  const paths = getOverlayPaths(baseDirectory, size, variant);
  fs.mkdirSync(paths.directory, { recursive: true, mode: 0o755 });
  const state = readOverlayState(paths);
  if (overlayIsFresh(paths, state)) return { paths, state, changed: false };
  return downloadOverlay({ ...options, paths });
}

module.exports = {
  VARIANTS,
  DEFAULT_MAX_AGE_MS,
  selectOverlayVariant,
  normaliseOverlayOpacity,
  getOverlayPaths,
  validateOverlayState,
  readOverlayState,
  writeOverlayState,
  parseMaxAge,
  getExpiry,
  buildOverlayUrl,
  overlayIsFresh,
  downloadOverlay,
  ensureOverlay
};
