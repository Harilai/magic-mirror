"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateFreshness } = require("../src/status");

const NOW = Date.parse("2026-07-22T12:00:00.000Z");
const MINUTE = 60 * 1000;

test("freshness primarily detects an old acquisition time", () => {
  const result = evaluateFreshness({
    imageTime: "2026-07-22T10:00:00.000Z",
    lastImageChangeAt: "2026-07-22T11:30:00.000Z"
  }, 90 * MINUTE, NOW);

  assert.equal(result.stale, true);
  assert.equal(result.reason, "image-time");
});

test("freshness also detects content that remains identical too long", () => {
  const result = evaluateFreshness({
    imageTime: "2026-07-22T11:45:00.000Z",
    lastImageChangeAt: "2026-07-22T10:00:00.000Z"
  }, 90 * MINUTE, NOW);

  assert.equal(result.stale, true);
  assert.equal(result.reason, "unchanged-content");
});

test("freshness stays clear for current images and when disabled", () => {
  assert.equal(evaluateFreshness({
    imageTime: "2026-07-22T11:45:00.000Z",
    lastImageChangeAt: "2026-07-22T11:30:00.000Z"
  }, 90 * MINUTE, NOW).stale, false);

  assert.equal(evaluateFreshness({
    imageTime: "2026-07-20T11:45:00.000Z",
    lastImageChangeAt: "2026-07-20T11:30:00.000Z"
  }, 0, NOW).stale, false);
});
