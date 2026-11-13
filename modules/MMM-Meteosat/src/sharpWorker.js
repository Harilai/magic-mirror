"use strict";

const fs = require("fs");
const sharp = require("sharp");
const { performance } = require("perf_hooks");
const { getGeometry, applyMaskToRgba } = require("./alphaMask");

const MAX_INPUT_PIXELS = 3600 * 3600;
async function inspectImage(request) {
  const metadata = await sharp(request.file, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true }).metadata();
  return {
    format: metadata.format || null,
    width: metadata.width || null,
    height: metadata.height || null,
    channels: metadata.channels || null,
    hasAlpha: metadata.hasAlpha === true
  };
}

async function processImage(request) {
  const started = performance.now();
  const inputBytes = fs.statSync(request.sourceFile).size;
  const requestedRenderSize = Number.isInteger(request.renderSize) && request.renderSize > 0
    ? request.renderSize
    : null;

  let pipeline = sharp(request.sourceFile, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
    .ensureAlpha()
    .toColourspace("srgb");

  if (requestedRenderSize !== null) {
    pipeline = pipeline.resize({
      width: requestedRenderSize,
      height: requestedRenderSize,
      fit: "inside",
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3
    });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`Unexpected source channel count: ${info.channels}.`);
  if (info.width * info.height > MAX_INPUT_PIXELS) throw new Error("Source image exceeds maximum pixel count.");

  const geometry = getGeometry(info.width, info.height);
  applyMaskToRgba(data, info.width, info.height, geometry);

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 }, limitInputPixels: MAX_INPUT_PIXELS })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(request.outputFile);

  const metadata = await sharp(request.outputFile, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (metadata.channels !== 4 || !metadata.hasAlpha) throw new Error("Generated PNG does not contain an alpha channel.");
  return {
    method: "geometric-alpha-mask",
    width: info.width,
    height: info.height,
    renderSize: Math.max(info.width, info.height),
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    geometry,
    inputBytes,
    outputBytes: fs.statSync(request.outputFile).size,
    durationMs: Math.round(performance.now() - started),
    workerMaxRssKb: process.platform === "linux" ? process.resourceUsage().maxRSS : null
  };
}

async function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  let result;
  if (request.operation === "inspect") result = await inspectImage(request);
  else if (request.operation === "process") result = await processImage(request);
  else throw new Error("Unsupported sharp worker operation.");
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { name: error.name, message: error.message } })}\n`);
  process.exitCode = 1;
});
