"use strict";

const fs = require("fs");
const { createTemporaryPath } = require("./cache");
const { processImageInWorker } = require("./sharpWorkerClient");

const { getGeometry, buildMask, applyMaskToRgba } = require("./alphaMask");

async function processImage({ sourceFile, targetFile, tempFile, debug = null, isActive = null, signal = null, renderSize = null }) {
  const uniqueTempFile = createTemporaryPath(tempFile);
  try {
    const result = await processImageInWorker(sourceFile, uniqueTempFile, { signal, renderSize });
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

module.exports = { processImage, getGeometry, buildMask, applyMaskToRgba };
