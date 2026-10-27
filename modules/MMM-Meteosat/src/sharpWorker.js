"use strict";

const fs = require("fs");
const sharp = require("sharp");
const { performance } = require("perf_hooks");

const MAX_INPUT_PIXELS = 3600 * 3600;
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
  const { data, info } = await sharp(request.sourceFile, { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
    .ensureAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`Unexpected source channel count: ${info.channels}.`);
  if (info.width * info.height > MAX_INPUT_PIXELS) throw new Error("Source image exceeds maximum pixel count.");

  const pixelCount = info.width * info.height;
  const sourceAlpha = Buffer.allocUnsafe(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) sourceAlpha[index] = data[index * 4 + 3];

  const geometry = getGeometry(info.width, info.height);
  const alpha = buildMask(info.width, info.height, geometry, sourceAlpha);
  for (let index = 0; index < pixelCount; index += 1) data[index * 4 + 3] = alpha[index];

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 }, limitInputPixels: MAX_INPUT_PIXELS })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(request.outputFile);

  const metadata = await sharp(request.outputFile, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (metadata.channels !== 4 || !metadata.hasAlpha) throw new Error("Generated PNG does not contain an alpha channel.");
  return {
    method: "geometric-alpha-mask",
    width: info.width,
    height: info.height,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    geometry,
    inputBytes,
    outputBytes: fs.statSync(request.outputFile).size,
    durationMs: Math.round(performance.now() - started)
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
