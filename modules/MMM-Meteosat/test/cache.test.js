"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sanitiseCacheId, getCacheId, getCachePaths, ensureCache, validateState, readState, writeState } = require("../src/cache");

test("cache identifiers are normalised safely", () => {
  assert.equal(sanitiseCacheId(" ../../My Cache "), "my-cache");
  assert.equal(getCacheId("module_3_MMM-Meteosat", ""), "m3");
});

test("state validation removes paths and invalid values", () => {
  const state = validateState({
    imageFile: "../../etc/passwd",
    imageTime: 123,
    contentHash: "invalid",
    downloadedAt: "2026-07-22T12:00:00.000Z",
    lastAttemptAt: "2026-07-22T12:05:00.000Z",
    lastSuccessfulDownloadAt: "2026-07-22T12:00:00.000Z",
    lastImageChangeAt: "2026-07-22T11:55:00.000Z",
    productLabel: "GeoColour"
  });
  assert.equal(state.imageFile, undefined);
  assert.equal(state.imageTime, undefined);
  assert.equal(state.contentHash, undefined);
  assert.equal(state.downloadedAt, "2026-07-22T12:00:00.000Z");
  assert.equal(state.lastAttemptAt, "2026-07-22T12:05:00.000Z");
  assert.equal(state.lastSuccessfulDownloadAt, "2026-07-22T12:00:00.000Z");
  assert.equal(state.lastImageChangeAt, "2026-07-22T11:55:00.000Z");
  assert.equal(state.productLabel, "GeoColour");
});

test("invalid JSON is ignored and reported", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-"));
  const paths = getCachePaths(root, "m1", "geocolour");
  ensureCache(paths);
  fs.writeFileSync(paths.stateFile, "{");
  let warning = "";
  assert.deepEqual(readState(paths, (value) => { warning = value; }), {});
  assert.match(warning, /Invalid cache state/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("state writes are validated and leave no temporary files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-"));
  const paths = getCachePaths(root, "m1", "geocolour");
  ensureCache(paths);
  const written = writeState(paths, {
    imageTime: "2026-07-22T12:00:00.000Z",
    contentHash: "a".repeat(64),
    imageFile: "unsafe"
  });
  assert.equal(written.imageFile, undefined);
  assert.equal(readState(paths).contentHash, "a".repeat(64));
  assert.equal(fs.readdirSync(paths.directory).some((name) => name.includes(".tmp.")), false);
  fs.rmSync(root, { recursive: true, force: true });
});


test("missing state files and incomplete states are handled safely", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-"));
  const paths = getCachePaths(root, "m1", "geocolour");
  ensureCache(paths);
  assert.deepEqual(readState(paths), {});
  fs.writeFileSync(paths.stateFile, JSON.stringify({ imageTime: "bad", processing: [], productLabel: "GeoColour" }));
  assert.deepEqual(readState(paths), { productLabel: "GeoColour" });
  fs.rmSync(root, { recursive: true, force: true });
});

test("temporary paths are unique", () => {
  const { createTemporaryPath } = require("../src/cache");
  const first = createTemporaryPath("file.tmp");
  const second = createTemporaryPath("file.tmp");
  assert.notEqual(first, second);
  assert.match(first, /^file\.tmp\./);
});
