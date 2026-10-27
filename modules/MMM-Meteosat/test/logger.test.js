"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MeteosatLogger } = require("../src/logger");

function capture(level, callback) {
  const methods = ["log", "warn", "error"];
  const original = Object.fromEntries(methods.map((name) => [name, console[name]]));
  const entries = [];
  for (const name of methods) console[name] = (message) => entries.push({ method: name, message });
  try {
    callback(new MeteosatLogger("test", level));
  } finally {
    for (const name of methods) console[name] = original[name];
  }
  return entries;
}

test("ERROR level emits only ERROR messages", () => {
  const entries = capture("ERROR", (logger) => {
    logger.error("error"); logger.warn("warn"); logger.info("info"); logger.debug("debug");
  });
  assert.deepEqual(entries.map((entry) => entry.message), ["[MMM-Meteosat][test][ERROR] error"]);
});

test("WARN level emits ERROR and WARN messages", () => {
  const entries = capture("WARN", (logger) => {
    logger.error("error"); logger.warn("warn"); logger.info("info"); logger.debug("debug");
  });
  assert.deepEqual(entries.map((entry) => entry.method), ["error", "warn"]);
});

test("INFO level suppresses DEBUG messages and blocks", () => {
  const entries = capture("INFO", (logger) => {
    logger.info("info"); logger.debug("debug"); logger.block("DEBUG", "hidden", { value: 1 });
  });
  assert.equal(entries.length, 1);
  assert.match(entries[0].message, /\[INFO\] info$/);
});

test("DEBUG level emits all levels with matching labels", () => {
  const entries = capture("DEBUG", (logger) => {
    logger.error("error"); logger.warn("warn"); logger.info("info"); logger.debug("debug");
  });
  assert.deepEqual(entries.map((entry) => entry.message.match(/\[(ERROR|WARN|INFO|DEBUG)\]/)[1]), ["ERROR", "WARN", "INFO", "DEBUG"]);
});

test("invalid level falls back to INFO", () => {
  const entries = capture("TRACE", (logger) => {
    logger.info("info"); logger.debug("debug");
  });
  assert.equal(entries.length, 1);
  assert.match(entries[0].message, /\[INFO\]/);
});
