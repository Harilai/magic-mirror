"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { processImage, getGeometry, buildMask } = require("../src/imageProcessor");

const fixtures = path.join(__dirname, "fixtures");

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-image-"));
}

test("geometry and mask produce an opaque centre and transparent corners", () => {
  const geometry = getGeometry(10, 10);
  const alpha = Buffer.alloc(100, 255);
  const mask = buildMask(10, 10, geometry, alpha);
  assert.equal(mask[0], 0);
  assert.equal(mask[5 * 10 + 5], 255);
});

test("image processing creates an RGBA PNG and removes temporary files", async () => {
  const root = workspace();
  const sourceFile = path.join(fixtures, "opaque-50x50.png");
  const targetFile = path.join(root, "latest.png");
  const tempFile = path.join(root, "latest.png.tmp");
  try {
    const result = await processImage({ sourceFile, targetFile, tempFile });
    const metadata = await sharp(targetFile).metadata();
    assert.equal(result.width, 50);
    assert.equal(result.height, 50);
    assert.equal(metadata.format, "png");
    assert.equal(metadata.hasAlpha, true);
    assert.equal(fs.readdirSync(root).some((name) => name.includes(".tmp.")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source alpha is preserved by the geometric mask", async () => {
  const root = workspace();
  const targetFile = path.join(root, "latest.png");
  try {
    await processImage({ sourceFile: path.join(fixtures, "rgba-10x10.png"), targetFile, tempFile: path.join(root, "latest.png.tmp") });
    const { data, info } = await sharp(targetFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const centreAlpha = data[((5 * info.width + 5) * 4) + 3];
    assert.ok(centreAlpha > 0 && centreAlpha < 255);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid images fail without leaving output or temporary files", async () => {
  const root = workspace();
  const targetFile = path.join(root, "latest.png");
  try {
    await assert.rejects(processImage({ sourceFile: path.join(fixtures, "invalid.png"), targetFile, tempFile: path.join(root, "latest.png.tmp") }));
    assert.equal(fs.existsSync(targetFile), false);
    assert.equal(fs.readdirSync(root).some((name) => name.includes(".tmp.")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("obsolete processing results are discarded", async () => {
  const root = workspace();
  const targetFile = path.join(root, "latest.png");
  try {
    await assert.rejects(processImage({
      sourceFile: path.join(fixtures, "opaque-50x50.png"),
      targetFile,
      tempFile: path.join(root, "latest.png.tmp"),
      isActive: () => false
    }), (error) => error.name === "AbortError");
    assert.equal(fs.existsSync(targetFile), false);
    assert.equal(fs.readdirSync(root).some((name) => name.includes(".tmp.")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
