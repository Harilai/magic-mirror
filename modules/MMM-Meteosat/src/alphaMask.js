"use strict";

function getGeometry(width, height) {
  const size = Math.min(width, height);
  return {
    centerX: width * 0.5,
    centerY: height * 0.5,
    radius: size * 0.42,
    opaqueOffset: size * -0.003,
    transparentOffset: size * 0.003
  };
}

function validateDimensions(width, height, bufferLength, channels) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError("Image dimensions must be positive integers.");
  }
  if (bufferLength < width * height * channels) {
    throw new RangeError("Image pixel buffer is smaller than its declared dimensions.");
  }
}

function buildMask(width, height, geometry, sourceAlpha) {
  validateDimensions(width, height, sourceAlpha.length, 1);

  const mask = Buffer.alloc(width * height);
  const opaqueRadius = geometry.radius + geometry.opaqueOffset;
  const transparentRadius = geometry.radius + geometry.transparentOffset;
  const opaqueRadiusSquared = opaqueRadius * opaqueRadius;
  const transparentRadiusSquared = transparentRadius * transparentRadius;
  const featherWidth = Math.max(1, transparentRadius - opaqueRadius);

  for (let y = 0; y < height; y += 1) {
    const dy = y - geometry.centerY;
    const dySquared = dy * dy;
    const rowOffset = y * width;

    for (let x = 0; x < width; x += 1) {
      const dx = x - geometry.centerX;
      const distanceSquared = (dx * dx) + dySquared;
      let geometricAlpha;

      if (distanceSquared <= opaqueRadiusSquared) {
        geometricAlpha = 255;
      } else if (distanceSquared >= transparentRadiusSquared) {
        geometricAlpha = 0;
      } else {
        const distance = Math.sqrt(distanceSquared);
        geometricAlpha = Math.round(((transparentRadius - distance) / featherWidth) * 255);
      }

      const index = rowOffset + x;
      mask[index] = Math.round((geometricAlpha * sourceAlpha[index]) / 255);
    }
  }

  return mask;
}

function applyMaskToRgba(data, width, height, geometry) {
  validateDimensions(width, height, data.length, 4);

  const opaqueRadius = geometry.radius + geometry.opaqueOffset;
  const transparentRadius = geometry.radius + geometry.transparentOffset;
  const opaqueRadiusSquared = opaqueRadius * opaqueRadius;
  const transparentRadiusSquared = transparentRadius * transparentRadius;
  const featherWidth = Math.max(1, transparentRadius - opaqueRadius);

  for (let y = 0; y < height; y += 1) {
    const dy = y - geometry.centerY;
    const dySquared = dy * dy;
    const rowPixelOffset = y * width;

    for (let x = 0; x < width; x += 1) {
      const pixelIndex = rowPixelOffset + x;
      const dx = x - geometry.centerX;
      const distanceSquared = (dx * dx) + dySquared;
      let geometricAlpha;

      if (distanceSquared <= opaqueRadiusSquared) {
        geometricAlpha = 255;
      } else if (distanceSquared >= transparentRadiusSquared) {
        geometricAlpha = 0;
      } else {
        const distance = Math.sqrt(distanceSquared);
        geometricAlpha = Math.round(((transparentRadius - distance) / featherWidth) * 255);
      }

      const alphaOffset = (pixelIndex * 4) + 3;
      data[alphaOffset] = Math.round((geometricAlpha * data[alphaOffset]) / 255);
    }
  }

  return data;
}

module.exports = { getGeometry, buildMask, applyMaskToRgba };
