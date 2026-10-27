"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_UPDATE_INTERVAL,
  MINIMUM_UPDATE_INTERVAL,
  DEFAULT_WMS_IMAGE_SIZE,
  DEFAULT_STALE_AFTER,
  DEFAULT_RETRY_DELAYS,
  MAX_RETRY_DELAY,
  normaliseUpdateInterval,
  normaliseImageSize,
  normaliseStaleAfter,
  normaliseRetryDelays
} = require("../src/config");

test("update interval enforces the five-minute minimum", () => {
  assert.equal(normaliseUpdateInterval(60_000), MINIMUM_UPDATE_INTERVAL);
  assert.equal(normaliseUpdateInterval(MINIMUM_UPDATE_INTERVAL), MINIMUM_UPDATE_INTERVAL);
  assert.equal(normaliseUpdateInterval(10 * 60_000), 10 * 60_000);
  assert.equal(normaliseUpdateInterval(undefined), DEFAULT_UPDATE_INTERVAL);
  assert.equal(normaliseUpdateInterval(Number.NaN), DEFAULT_UPDATE_INTERVAL);
});

test("WMS image size is rounded and constrained", () => {
  assert.equal(normaliseImageSize(100), 600);
  assert.equal(normaliseImageSize(1800.6), 1801);
  assert.equal(normaliseImageSize(5000), 3600);
  assert.equal(normaliseImageSize(undefined), DEFAULT_WMS_IMAGE_SIZE);
});

test("stale warning threshold supports disable and defaults", () => {
  assert.equal(normaliseStaleAfter(0), 0);
  assert.equal(normaliseStaleAfter(12_345.6), 12_346);
  assert.equal(normaliseStaleAfter(-1), DEFAULT_STALE_AFTER);
  assert.equal(normaliseStaleAfter(undefined), DEFAULT_STALE_AFTER);
});

test("retry delays reject invalid values, cap delays and limit entries", () => {
  assert.deepEqual(normaliseRetryDelays(undefined), [...DEFAULT_RETRY_DELAYS]);
  assert.deepEqual(normaliseRetryDelays([]), []);
  assert.deepEqual(
    normaliseRetryDelays([0, 1000.8, -1, Number.NaN, MAX_RETRY_DELAY + 1, 2, 3, 4, 5]),
    [0, 1001, MAX_RETRY_DELAY, 2, 3]
  );
});
