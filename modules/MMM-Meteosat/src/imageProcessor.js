"use strict";

const fs = require("fs");
const { createTemporaryPath } = require("./cache");
const { processImageInWorker } = require("./sharpWorkerClient");

const FULL_DISK_GEOMETRY = Object.freeze({
  centerXRatio: 0.5, centerYRatio: 0.5, radiusRatio: 0.42,
  opaqueOffsetRatio: -0.003, transparentOffsetRatio: 0.003
});

function getGeometry(width, height) {
  const size = Math.min(width, height);
  return {
    centerX: width * FULL_DISK_GEOMETRY.centerXRatio,
    centerY: height * FULL_DISK_GEOMETRY.centerYRatio,
    radius: size * FULL_DISK_GEOMETRY.radiusRatio,
    opaqueOffset: size * FULL_DISK_GEOMETRY.opaqueOffsetRatio,
    transparentOffset: size * FULL_DISK_GEOMETRY.transparentOffsetRatio
  };
}

function buildMask(width, height, geometry, sourceAlpha) {
  const mask = Buffer.alloc(width * height);
  const opaqueRadius = geometry.radius + geometry.opaqueOffset;
  const transparentRadius = geometry.radius + geometry.transparentOffset;
  const featherWidth = Math.max(1, transparentRadius - opaqueRadius);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const distance = Math.hypot(x - geometry.centerX, y - geometry.centerY);
      let geometricAlpha;
      if (distance <= opaqueRadius) geometricAlpha = 255;
      else if (distance >= transparentRadius) geometricAlpha = 0;
      else geometricAlpha = Math.round(((transparentRadius - distance) / featherWidth) * 255);
      mask[index] = Math.round((geometricAlpha * sourceAlpha[index]) / 255);
    }
  }
  return mask;
}

async function processImage({ sourceFile, targetFile, tempFile, debug = null, isActive = null, signal = null }) {
  const uniqueTempFile = createTemporaryPath(tempFile);
  try {
    const result = await processImageInWorker(sourceFile, uniqueTempFile, { signal });
    fs.chmodSync(uniqueTempFile, 0o644);
    if (isActive && !isActive()) {
      const error = new Error("Obsolete image processing result discarded.");
      error.name = "AbortError";
      throw error;
    }
    fs.renameSync(uniqueTempFile, targetFile);
    debug?.("Image processing", { ...result, worker: "node-child-process" });
    return result;
  } finally {
    fs.rmSync(uniqueTempFile, { force: true });
  }
}

module.exports = { processImage, getGeometry, buildMask };
