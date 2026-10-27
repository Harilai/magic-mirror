"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { WmsRequestError, sanitiseLogText, parseTimeDimension, extractLatestLayerTime, readBodyWithLimit } = require("../src/sources/wms");

const fixtures = path.join(__dirname, "fixtures");

test("time dimension parser handles ranges, lists and invalid entries", () => {
  assert.equal(parseTimeDimension("2026-07-22T10:00:00Z/2026-07-22T10:40:00Z/PT10M").latest, "2026-07-22T10:40:00.000Z");
  assert.equal(parseTimeDimension("2026-07-22T10:10:00Z, 2026-07-22T10:30:00Z").latest, "2026-07-22T10:30:00.000Z");
  assert.equal(parseTimeDimension("not-a-date").latest, null);
  assert.equal(parseTimeDimension(" &amp; ").raw, "&");
});

test("latest layer time is selected from capabilities XML", () => {
  const xml = fs.readFileSync(path.join(fixtures, "capabilities.xml"), "utf8");
  assert.equal(extractLatestLayerTime(xml, "msg_fes:rgb_geocolour").imageTime, "2026-07-22T10:40:00.000Z");
  assert.equal(extractLatestLayerTime(xml, "msg_fes:rgb_dust").imageTime, "2026-07-22T10:30:00.000Z");
  assert.equal(extractLatestLayerTime(xml, "missing:layer").imageTime, null);
});

test("response reader accepts bodies within the configured limit", async () => {
  const response = { headers: new Headers(), body: Readable.from([Buffer.from("abc"), Buffer.from("def")]) };
  assert.equal((await readBodyWithLimit(response, 6)).toString(), "abcdef");
});

test("response reader rejects declared and streamed oversize bodies", async () => {
  const declared = { headers: new Headers({ "content-length": "7" }), body: Readable.from([Buffer.from("1234567")]) };
  await assert.rejects(readBodyWithLimit(declared, 6), (error) => error instanceof WmsRequestError && error.retryable === false);

  const streamed = { headers: new Headers(), body: Readable.from([Buffer.from("1234"), Buffer.from("5678")]) };
  await assert.rejects(readBodyWithLimit(streamed, 6), /exceeded maximum size/);
});

test("upstream log text is single-line, stripped and bounded", () => {
  const value = sanitiseLogText("line one\nline two\t\u0000tail", 18);
  assert.equal(value.includes("\n"), false);
  assert.equal(value.includes("\u0000"), false);
  assert.ok(value.length <= 18);
});
