"use strict";

function parseTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function evaluateFreshness(state = {}, staleAfter = 0, now = Date.now()) {
  const threshold = Number.isFinite(staleAfter) && staleAfter > 0 ? staleAfter : 0;
  const imageTimestamp = parseTime(state.imageTime);
  const changeTimestamp = parseTime(state.lastImageChangeAt);
  const imageAgeMs = imageTimestamp === null ? null : Math.max(0, now - imageTimestamp);
  const unchangedForMs = changeTimestamp === null ? null : Math.max(0, now - changeTimestamp);
  const imageTimeStale = threshold > 0 && imageAgeMs !== null && imageAgeMs > threshold;
  const contentStale = threshold > 0 && unchangedForMs !== null && unchangedForMs > threshold;

  let reason = null;
  if (imageTimeStale && contentStale) reason = "image-time-and-content";
  else if (imageTimeStale) reason = "image-time";
  else if (contentStale) reason = "unchanged-content";

  return {
    stale: imageTimeStale || contentStale,
    reason,
    imageAgeMs,
    unchangedForMs
  };
}

module.exports = { evaluateFreshness };
