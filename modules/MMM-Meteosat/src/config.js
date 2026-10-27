"use strict";

const DEFAULT_UPDATE_INTERVAL = 10 * 60 * 1000;
const MINIMUM_UPDATE_INTERVAL = 5 * 60 * 1000;
const DEFAULT_WMS_IMAGE_SIZE = 1800;
const DEFAULT_STALE_AFTER = 90 * 60 * 1000;
const DEFAULT_RETRY_DELAYS = Object.freeze([15 * 1000, 45 * 1000]);
const MAX_RETRY_DELAY = 5 * 60 * 1000;
const MAX_RETRY_DELAYS = 5;
const MINIMUM_WMS_IMAGE_SIZE = 600;
const MAXIMUM_WMS_IMAGE_SIZE = 3600;

function normaliseUpdateInterval(value) {
  return Number.isFinite(value)
    ? Math.max(MINIMUM_UPDATE_INTERVAL, Math.round(value))
    : DEFAULT_UPDATE_INTERVAL;
}

function normaliseImageSize(value) {
  return Number.isFinite(value)
    ? Math.min(MAXIMUM_WMS_IMAGE_SIZE, Math.max(MINIMUM_WMS_IMAGE_SIZE, Math.round(value)))
    : DEFAULT_WMS_IMAGE_SIZE;
}

function normaliseStaleAfter(value) {
  if (value === 0) return 0;
  return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_STALE_AFTER;
}

function normaliseRetryDelays(value) {
  return Array.isArray(value)
    ? value
      .filter((delay) => Number.isFinite(delay) && delay >= 0)
      .map((delay) => Math.min(MAX_RETRY_DELAY, Math.round(delay)))
      .slice(0, MAX_RETRY_DELAYS)
    : [...DEFAULT_RETRY_DELAYS];
}

module.exports = {
  DEFAULT_UPDATE_INTERVAL,
  MINIMUM_UPDATE_INTERVAL,
  DEFAULT_WMS_IMAGE_SIZE,
  DEFAULT_STALE_AFTER,
  DEFAULT_RETRY_DELAYS,
  MAX_RETRY_DELAY,
  MAX_RETRY_DELAYS,
  MINIMUM_WMS_IMAGE_SIZE,
  MAXIMUM_WMS_IMAGE_SIZE,
  normaliseUpdateInterval,
  normaliseImageSize,
  normaliseStaleAfter,
  normaliseRetryDelays
};
