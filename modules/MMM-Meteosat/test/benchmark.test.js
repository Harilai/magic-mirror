"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs, summarise, runBenchmark } = require("../scripts/benchmark");

test("benchmark arguments enforce supported source, render and repetition limits", () => {
  assert.deepEqual(parseArgs(["--source-size=1800", "--render-size=700", "--repeat=3"]), {
    sourceSize: 1800, renderSize: 700, repeat: 3, help: false
  });
  assert.throws(() => parseArgs(["--source-size=500"]), /between 600 and 3600/);
  assert.throws(() => parseArgs(["--render-size=1900", "--source-size=1800"]), /between 1 and source-size/);
  assert.throws(() => parseArgs(["--repeat=0"]), /between 1 and 10/);
});

test("benchmark summary calculates min, median and max", () => {
  assert.deepEqual(summarise([12, 4, 10, 8, 6]), { min: 4, median: 8, max: 12 });
});

test("benchmark runs the image worker and reports dimensions, timing and peak RSS", async () => {
  const report = await runBenchmark({ sourceSize: 600, renderSize: 300, repeat: 1 });
  assert.equal(report.runtime.platform, "linux");
  assert.equal(report.workload.source.width, 600);
  assert.equal(report.workload.output.width, 300);
  assert.equal(report.workload.output.height, 300);
  assert.ok(report.results.endToEndDurationMs.min > 0);
  assert.ok(report.results.workerDurationMs.min > 0);
  assert.ok(report.results.workerMaxRssKb.min > 0);
  assert.match(report.note, /Not a Chromium/);
});
