"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sanitiseCacheId(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "default";
}

function automaticCacheId(instanceId) {
  const match = String(instanceId || "").match(/^module_(\d+)(?:_|$)/i);
  return match ? `m${match[1]}` : sanitiseCacheId(instanceId);
}

function getCacheId(instanceId, configuredCacheId) {
  return configuredCacheId
    ? sanitiseCacheId(configuredCacheId)
    : automaticCacheId(instanceId);
}

function getCachePaths(baseDirectory, cacheId, productId) {
  const relativeDirectory = path.join("cache", cacheId, productId);
  const directory = path.join(baseDirectory, relativeDirectory);

  return {
    directory,
    sourceFile: path.join(directory, "source.png"),
    tempSourceFile: path.join(directory, "source.png.tmp"),
    imageFile: path.join(directory, "latest.png"),
    tempImageFile: path.join(directory, "latest.png.tmp"),
    stateFile: path.join(directory, "status.json"),
    tempStateFile: path.join(directory, "status.json.tmp"),
    relativeImageFile: path.join(relativeDirectory, "latest.png").replaceAll(path.sep, "/"),
    relativeSourceFile: path.join(relativeDirectory, "source.png").replaceAll(path.sep, "/")
  };
}

function ensureCache(paths) {
  fs.mkdirSync(paths.directory, { recursive: true, mode: 0o755 });
}

function createTemporaryPath(basePath) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  return `${basePath}.${suffix}`;
}

function validString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};

  const result = {
    requestedProduct: validString(state.requestedProduct),
    resolvedProduct: validString(state.resolvedProduct),
    productLabel: validString(state.productLabel),
    layer: validString(state.layer),
    source: validString(state.source),
    contentHash: /^[a-f0-9]{64}$/i.test(state.contentHash || "") ? state.contentHash : null,
    imageTime: validIsoDate(state.imageTime),
    responseTime: validIsoDate(state.responseTime),
    downloadedAt: validIsoDate(state.downloadedAt),
    lastAttemptAt: validIsoDate(state.lastAttemptAt),
    lastSuccessfulDownloadAt: validIsoDate(state.lastSuccessfulDownloadAt),
    lastImageChangeAt: validIsoDate(state.lastImageChangeAt),
    processing: state.processing && typeof state.processing === "object" && !Array.isArray(state.processing)
      ? state.processing
      : null
  };

  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null));
}

function readState(paths, onWarning = null) {
  if (!fs.existsSync(paths.stateFile)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(paths.stateFile, "utf8"));
    return validateState(parsed);
  } catch (error) {
    onWarning?.(`Invalid cache state ignored: ${error.message}`);
    return {};
  }
}

function writeState(paths, state) {
  const validated = validateState(state);
  const temporaryFile = createTemporaryPath(paths.tempStateFile);

  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o644 });
    fs.renameSync(temporaryFile, paths.stateFile);
    return validated;
  } finally {
    fs.rmSync(temporaryFile, { force: true });
  }
}

module.exports = {
  sanitiseCacheId,
  getCacheId,
  getCachePaths,
  ensureCache,
  createTemporaryPath,
  validateState,
  readState,
  writeState
};
