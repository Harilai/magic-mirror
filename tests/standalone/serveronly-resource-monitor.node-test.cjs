"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseArgs,
  parseMemoryInfo,
  parseSmapsRollup,
  parseStatusRss,
  readThermalSensors,
  isTargetProcess,
  readProcessMemory,
  collectSample,
  summariseSamples
} = require("../../scripts/serveronly-resource-monitor");

test("memory info parser reads available memory and swap counters", () => {
  assert.deepEqual(parseMemoryInfo([
    "MemTotal:       8192000 kB",
    "MemFree:         512000 kB",
    "MemAvailable:   3072000 kB",
    "SwapTotal:      1024000 kB",
    "SwapFree:        768000 kB"
  ].join("\n")), {
    totalBytes: 8192000 * 1024,
    availableBytes: 3072000 * 1024,
    freeBytes: 512000 * 1024,
    swapTotalBytes: 1024000 * 1024,
    swapFreeBytes: 768000 * 1024
  });
});

test("smaps_rollup parser prefers PSS and records split values", () => {
  assert.deepEqual(parseSmapsRollup([
    "Rss:              2048 kB",
    "Pss:              1024 kB",
    "Pss_Anon:          700 kB",
    "Pss_File:          300 kB",
    "Pss_Shmem:          24 kB"
  ].join("\n")), {
    pssBytes: 1024 * 1024,
    pssAnonBytes: 700 * 1024,
    pssFileBytes: 300 * 1024,
    pssShmemBytes: 24 * 1024,
    rssBytes: 2048 * 1024
  });
});

test("RSS fallback and argument validation are explicit", () => {
  assert.equal(parseStatusRss("Name:\tchromium\nVmRSS:\t4096 kB\n"), 4096 * 1024);
  assert.equal(parseStatusRss("Name:\tchromium\n"), null);
  assert.equal(parseArgs(["--duration=60", "--interval=2", "--match=chromium"]).durationSeconds, 60);
  assert.throws(() => parseArgs(["--duration=5"]), /between 10 and 86400/);
  assert.throws(() => parseArgs(["--interval=0"]), /between 1 and 60/);
  assert.throws(() => parseArgs(["--unknown=1"]), /Unknown argument/);
});

test("process matching uses command lines instead of assuming every Node process belongs to MagicMirror", () => {
  const matcher = /chromium|serveronly/i;
  assert.equal(isTargetProcess("/usr/lib/chromium/chromium --type=renderer", matcher), true);
  assert.equal(isTargetProcess("node ./serveronly", matcher), true);
  assert.equal(isTargetProcess("node unrelated-build.js", matcher), false);
});

test("procfs sample records PSS for MagicMirror and Chromium processes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serveronly-resource-monitor-"));
  try {
    fs.writeFileSync(path.join(root, "meminfo"), [
      "MemTotal: 4096000 kB",
      "MemAvailable: 2048000 kB",
      "SwapTotal: 1024000 kB",
      "SwapFree: 1024000 kB"
    ].join("\n"));

    const nodeDirectory = path.join(root, "101");
    fs.mkdirSync(nodeDirectory);
    fs.writeFileSync(path.join(nodeDirectory, "cmdline"), "node\0./serveronly\0");
    fs.writeFileSync(path.join(nodeDirectory, "smaps_rollup"), "Rss: 102400 kB\nPss: 80000 kB\nPss_Anon: 60000 kB\nPss_File: 20000 kB\nPss_Shmem: 0 kB\n");

    const chromeDirectory = path.join(root, "102");
    fs.mkdirSync(chromeDirectory);
    fs.writeFileSync(path.join(chromeDirectory, "cmdline"), "/usr/lib/chromium/chromium\0--type=renderer\0");
    fs.writeFileSync(path.join(chromeDirectory, "status"), "VmRSS:\t120000 kB\n");
    fs.writeFileSync(path.join(chromeDirectory, "smaps_rollup"), "Rss: 120000 kB\nPss: 90000 kB\nPss_Anon: 70000 kB\nPss_File: 20000 kB\nPss_Shmem: 0 kB\n");

    const unrelatedDirectory = path.join(root, "103");
    fs.mkdirSync(unrelatedDirectory);
    fs.writeFileSync(path.join(unrelatedDirectory, "cmdline"), "node\0other-app.js\0");

    const sample = collectSample({ procRoot: root, matcher: /chromium|serveronly/i, now: new Date("2026-11-13T10:00:00.000Z") });
    assert.equal(sample.target.processCount, 2);
    assert.equal(sample.target.pssBytes, (80000 + 90000) * 1024);
    assert.equal(sample.target.rssBytes, (102400 + 120000) * 1024);
    assert.equal(sample.memory.availableBytes, 2048000 * 1024);
    assert.equal(sample.timestamp, "2026-11-13T10:00:00.000Z");
    assert.equal(sample.target.processes[0].pid, 102);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("RSS fallback remains visible when smaps_rollup is unreadable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serveronly-resource-fallback-"));
  try {
    fs.writeFileSync(path.join(root, "meminfo"), "MemTotal: 1024000 kB\nMemAvailable: 512000 kB\n");
    const proc = path.join(root, "202");
    fs.mkdirSync(proc);
    fs.writeFileSync(path.join(proc, "cmdline"), "node\0./serveronly\0");
    fs.writeFileSync(path.join(proc, "status"), "VmRSS:\t1234 kB\n");
    const processInfo = readProcessMemory(202, { procRoot: root, matcher: /serveronly/i });
    assert.equal(processInfo.memorySource, "status-rss-fallback");
    assert.equal(processInfo.pssBytes, null);
    assert.equal(processInfo.rssBytes, 1234 * 1024);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Linux thermal zones are reported in degrees Celsius", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serveronly-thermal-"));
  try {
    const thermalRoot = path.join(root, "class", "thermal");
    fs.mkdirSync(path.join(thermalRoot, "thermal_zone0"), { recursive: true });
    fs.mkdirSync(path.join(thermalRoot, "thermal_zone1"), { recursive: true });
    fs.writeFileSync(path.join(thermalRoot, "thermal_zone0", "type"), "cpu-thermal\n");
    fs.writeFileSync(path.join(thermalRoot, "thermal_zone0", "temp"), "67500\n");
    fs.writeFileSync(path.join(thermalRoot, "thermal_zone1", "type"), "wifi-thermal\n");
    fs.writeFileSync(path.join(thermalRoot, "thermal_zone1", "temp"), "42500\n");

    assert.deepEqual(readThermalSensors(root), [
      { zone: "thermal_zone0", type: "cpu-thermal", temperatureC: 67.5 },
      { zone: "thermal_zone1", type: "wifi-thermal", temperatureC: 42.5 }
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("summary reports peak target PSS and minimum system headroom", () => {
  const summary = summariseSamples([
    { timestamp: "a", memory: { availableBytes: 100 }, temperatures: [{ type: "cpu", temperatureC: 54 }], target: { processCount: 2, pssBytes: 50, rssBytes: 80, processes: [] } },
    { timestamp: "b", memory: { availableBytes: 70 }, temperatures: [{ type: "cpu", temperatureC: 68.5 }, { type: "gpu", temperatureC: 56 }], target: { processCount: 3, pssBytes: 120, rssBytes: 160, processes: [{ pid: 1 }] } },
    { timestamp: "c", memory: { availableBytes: 90 }, temperatures: [{ type: "cpu", temperatureC: 65 }], target: { processCount: 1, pssBytes: 110, rssBytes: 150, processes: [] } }
  ]);
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.peakTargetPssBytes, 120);
  assert.equal(summary.peakTargetRssBytes, 160);
  assert.equal(summary.minimumMemAvailableBytes, 70);
  assert.equal(summary.peakTargetProcessCount, 3);
  assert.equal(summary.peakPssAt, "b");
  assert.deepEqual(summary.peakPssProcesses, [{ pid: 1 }]);
  assert.deepEqual(summary.peakTemperaturesC, { cpu: 68.5, gpu: 56 });
});
