"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getGeometry, buildMask, applyMaskToRgba } = require("../src/alphaMask");

function referenceMask(width, height, geometry, sourceAlpha) {
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

test("squared-distance mask is pixel-equivalent to the original hypot implementation", () => {
  for (const [width, height] of [[10, 10], [37, 29], [101, 73], [240, 180]]) {
    const sourceAlpha = Buffer.alloc(width * height);
    for (let index = 0; index < sourceAlpha.length; index += 1) {
      sourceAlpha[index] = (index * 73 + width * 11 + height * 7) % 256;
    }

    const geometry = getGeometry(width, height);
    assert.deepEqual(
      buildMask(width, height, geometry, sourceAlpha),
      referenceMask(width, height, geometry, sourceAlpha),
      `mask mismatch at ${width}x${height}`
    );
  }
});

test("in-place mask changes only RGBA alpha bytes", () => {
  const width = 43;
  const height = 31;
  const data = Buffer.alloc(width * height * 4);
  const sourceAlpha = Buffer.alloc(width * height);

  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = (index * 17) % 256;
    data[index * 4 + 1] = (index * 29) % 256;
    data[index * 4 + 2] = (index * 41) % 256;
    data[index * 4 + 3] = (index * 53) % 256;
    sourceAlpha[index] = data[index * 4 + 3];
  }

  const expected = referenceMask(width, height, getGeometry(width, height), sourceAlpha);
  const originalRgb = Buffer.from(data);
  applyMaskToRgba(data, width, height, getGeometry(width, height));

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    assert.equal(data[offset], originalRgb[offset]);
    assert.equal(data[offset + 1], originalRgb[offset + 1]);
    assert.equal(data[offset + 2], originalRgb[offset + 2]);
    assert.equal(data[offset + 3], expected[index]);
  }
});

test("mask helpers reject malformed dimensions and undersized buffers", () => {
  const geometry = getGeometry(2, 2);
  assert.throws(() => buildMask(2, 2, geometry, Buffer.alloc(3)), /smaller than/);
  assert.throws(() => applyMaskToRgba(Buffer.alloc(15), 2, 2, geometry), /smaller than/);
  assert.throws(() => buildMask(0, 2, geometry, Buffer.alloc(0)), /positive integers/);
});
