"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  VARIANTS,
  DEFAULT_MAX_AGE_MS,
  selectOverlayVariant,
  normaliseOverlayOpacity,
  getOverlayPaths,
  validateOverlayState,
  parseMaxAge,
  getExpiry,
  buildOverlayUrl,
  overlayIsFresh
} = require("../src/overlay");

test("overlay selection maps all configuration combinations", () => {
  assert.equal(selectOverlayVariant(false, false), null);
  assert.equal(selectOverlayVariant(true, false), VARIANTS.coastlines);
  assert.equal(selectOverlayVariant(false, true), VARIANTS.borders);
  assert.equal(selectOverlayVariant(true, true), VARIANTS.combined);
});

test("overlay opacity is constrained and defaults safely", () => {
  assert.equal(normaliseOverlayOpacity(-1), 0);
  assert.equal(normaliseOverlayOpacity(0.45), 0.45);
  assert.equal(normaliseOverlayOpacity(2), 1);
  assert.equal(normaliseOverlayOpacity(undefined), 0.6);
});

test("overlay URLs use only fixed official EUMETSAT layers", () => {
  const url = new URL(buildOverlayUrl(VARIANTS.combined, 1800));
  assert.equal(url.origin, "https://view.eumetsat.int");
  assert.equal(url.searchParams.get("layers"), "backgrounds:ne_10m_coastline,backgrounds:ne_boundary_lines_land");
  assert.equal(url.searchParams.get("width"), "1800");
  assert.equal(url.searchParams.get("height"), "1800");
  assert.equal(url.searchParams.get("transparent"), "true");
});

test("server max-age is parsed with a seven-day fallback", () => {
  assert.equal(parseMaxAge("public, max-age=604800, must-revalidate"), 604800000);
  assert.equal(parseMaxAge("must-revalidate"), DEFAULT_MAX_AGE_MS);
  assert.equal(parseMaxAge("max-age=1"), 3600000);
});


test("Cache-Control max-age takes precedence over Expires", () => {
  const now = Date.parse("2026-07-22T10:00:00.000Z");
  const response = {
    headers: {
      get(name) {
        if (name === "cache-control") return "public, max-age=7200";
        if (name === "expires") return "Wed, 29 Jul 2026 10:00:00 GMT";
        return null;
      }
    }
  };
  assert.equal(getExpiry(response, now).expiresAt, "2026-07-22T12:00:00.000Z");
});

test("Expires is used when Cache-Control has no max-age", () => {
  const now = Date.parse("2026-07-22T10:00:00.000Z");
  const response = {
    headers: {
      get(name) {
        if (name === "cache-control") return "must-revalidate";
        if (name === "expires") return "Wed, 23 Jul 2026 10:00:00 GMT";
        return null;
      }
    }
  };
  assert.equal(getExpiry(response, now).expiresAt, "2026-07-23T10:00:00.000Z");
});

test("overlay state validation rejects unsafe fields", () => {
  assert.deepEqual(validateOverlayState({
    variant: "combined",
    layers: ["backgrounds:ne_10m_coastline"],
    size: 1800,
    contentHash: "a".repeat(64),
    downloadedAt: "2026-07-22T10:00:00.000Z",
    path: "../../etc/passwd"
  }), {
    variant: "combined",
    layers: ["backgrounds:ne_10m_coastline"],
    size: 1800,
    contentHash: "a".repeat(64),
    downloadedAt: "2026-07-22T10:00:00.000Z"
  });
});

test("fresh overlay cache requires both file and unexpired state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-overlay-"));
  try {
    const paths = getOverlayPaths(root, 1800, VARIANTS.coastlines);
    fs.mkdirSync(paths.directory, { recursive: true });
    fs.writeFileSync(paths.imageFile, "png");
    assert.equal(overlayIsFresh(paths, { expiresAt: "2026-07-29T10:00:00.000Z" }, Date.parse("2026-07-22T10:00:00.000Z")), true);
    assert.equal(overlayIsFresh(paths, { expiresAt: "2026-07-21T10:00:00.000Z" }, Date.parse("2026-07-22T10:00:00.000Z")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
