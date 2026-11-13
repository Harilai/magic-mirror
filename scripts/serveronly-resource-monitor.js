#!/usr/bin/env node
"use strict";

/**
 * Samples Linux memory while MagicMirror Serveronly and Chromium are running.
 *
 * Example:
 *   node scripts/serveronly-resource-monitor.js --duration=900 --interval=5 --output=resources.json
 *
 * PSS is preferred over RSS because PSS proportionally accounts for shared pages
 * across Chromium's multi-process architecture.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DEFAULT_DURATION_SECONDS = 900;
const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_MATCH = "chromium|chrome|serveronly|MagicMirror|magic-mirror|MMM-Meteosat|sharpWorker";

function parseArgs(args) {
  const options = {
    durationSeconds: DEFAULT_DURATION_SECONDS,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    output: null,
    match: DEFAULT_MATCH
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const match = /^--(duration|interval|output|match)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const [, key, value] = match;
    if (key === "duration") options.durationSeconds = Number(value);
    if (key === "interval") options.intervalSeconds = Number(value);
    if (key === "output") options.output = value.trim() || null;
    if (key === "match") options.match = value;
  }

  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds < 10 || options.durationSeconds > 86400) {
    throw new RangeError("duration must be between 10 and 86400 seconds.");
  }
  if (!Number.isFinite(options.intervalSeconds) || options.intervalSeconds < 1 || options.intervalSeconds > 60) {
    throw new RangeError("interval must be between 1 and 60 seconds.");
  }
  if (!options.match.trim()) throw new Error("match must not be empty.");
  try {
    options.matchRegex = new RegExp(options.match, "i");
  } catch (error) {
    throw new Error(`Invalid match regular expression: ${error.message}`);
  }
  return options;
}

function parseMemoryInfo(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z_()]+):\s+(\d+)\s+kB$/.exec(line.trim());
    if (match) values[match[1]] = Number(match[2]) * 1024;
  }
  return {
    totalBytes: values.MemTotal ?? null,
    availableBytes: values.MemAvailable ?? null,
    freeBytes: values.MemFree ?? null,
    swapTotalBytes: values.SwapTotal ?? null,
    swapFreeBytes: values.SwapFree ?? null
  };
}

function parseSmapsRollup(content) {
  const fields = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^(Pss|Pss_Anon|Pss_File|Pss_Shmem|Rss):\s+(\d+)\s+kB$/.exec(line.trim());
    if (match) fields[match[1]] = Number(match[2]) * 1024;
  }
  return {
    pssBytes: fields.Pss ?? null,
    pssAnonBytes: fields.Pss_Anon ?? null,
    pssFileBytes: fields.Pss_File ?? null,
    pssShmemBytes: fields.Pss_Shmem ?? null,
    rssBytes: fields.Rss ?? null
  };
}

function readThermalSensors(sysRoot = "/sys") {
  const thermalRoot = path.join(sysRoot, "class", "thermal");
  let entries;
  try {
    entries = fs.readdirSync(thermalRoot).filter((entry) => /^thermal_zone[0-9]+$/.test(entry));
  } catch {
    return [];
  }

  const sensors = [];
  for (const entry of entries) {
    const zone = path.join(thermalRoot, entry);
    try {
      const type = fs.readFileSync(path.join(zone, "type"), "utf8").trim() || entry;
      const rawTemperature = Number(fs.readFileSync(path.join(zone, "temp"), "utf8").trim());
      if (!Number.isFinite(rawTemperature)) continue;
      const temperatureC = Math.abs(rawTemperature) >= 1000 ? rawTemperature / 1000 : rawTemperature;
      sensors.push({ zone: entry, type, temperatureC: Math.round(temperatureC * 10) / 10 });
    } catch {
      // Thermal zones may disappear or be inaccessible while the monitor is running.
    }
  }
  return sensors.sort((left, right) => left.zone.localeCompare(right.zone, undefined, { numeric: true }));
}

function parseStatusRss(content) {
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(content);
  return match ? Number(match[1]) * 1024 : null;
}

function isTargetProcess(command, matcher) {
  return matcher.test(command);
}

function listProcessIds(procRoot = "/proc") {
  try {
    return fs.readdirSync(procRoot).filter((entry) => /^\d+$/.test(entry)).map(Number);
  } catch {
    return [];
  }
}

function readProcessMemory(pid, { procRoot = "/proc", matcher } = {}) {
  const processDirectory = path.join(procRoot, String(pid));
  try {
    const command = fs.readFileSync(path.join(processDirectory, "cmdline"), "utf8").replace(/\0/g, " ").trim()
      || fs.readFileSync(path.join(processDirectory, "comm"), "utf8").trim();
    if (!isTargetProcess(command, matcher)) return null;

    let memory = null;
    let source = "smaps_rollup";
    try {
      memory = parseSmapsRollup(fs.readFileSync(path.join(processDirectory, "smaps_rollup"), "utf8"));
    } catch {
      source = "status-rss-fallback";
      memory = { pssBytes: null, pssAnonBytes: null, pssFileBytes: null, pssShmemBytes: null, rssBytes: parseStatusRss(fs.readFileSync(path.join(processDirectory, "status"), "utf8")) };
    }

    return { pid, command: command.slice(0, 240), ...memory, memorySource: source };
  } catch {
    // Processes can exit between readdir and procfs reads; permission can also be restricted.
    return null;
  }
}

function collectTargetProcesses({ procRoot = "/proc", matcher = new RegExp(DEFAULT_MATCH, "i") } = {}) {
  const results = [];
  const monitorPid = procRoot === "/proc" ? process.pid : null;
  for (const pid of listProcessIds(procRoot)) {
    // Do not include this sampler in its own MagicMirror/Chromium resource totals.
    if (monitorPid !== null && pid === monitorPid) continue;
    const process = readProcessMemory(pid, { procRoot, matcher });
    if (process) results.push(process);
  }
  return results.sort((left, right) => (right.pssBytes ?? right.rssBytes ?? 0) - (left.pssBytes ?? left.rssBytes ?? 0));
}

function sumKnown(processes, key) {
  const values = processes.map((process) => process[key]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function collectSample({ procRoot = "/proc", sysRoot = "/sys", matcher = new RegExp(DEFAULT_MATCH, "i"), now = new Date() } = {}) {
  const memInfoPath = path.join(procRoot, "meminfo");
  const memory = parseMemoryInfo(fs.readFileSync(memInfoPath, "utf8"));
  const processes = collectTargetProcesses({ procRoot, matcher });
  return {
    timestamp: now.toISOString(),
    memory,
    temperatures: readThermalSensors(sysRoot),
    target: {
      processCount: processes.length,
      pssBytes: sumKnown(processes, "pssBytes"),
      rssBytes: sumKnown(processes, "rssBytes"),
      processes
    }
  };
}

function summariseSamples(samples) {
  if (!samples.length) throw new Error("No samples were collected.");
  const extreme = (values, comparator) => values
    .filter(Number.isFinite)
    .reduce((best, value) => best === null ? value : comparator(best, value), null);
  const max = (values) => extreme(values, Math.max);
  const min = (values) => extreme(values, Math.min);
  const peakTemperaturesC = {};
  for (const sample of samples) {
    for (const sensor of sample.temperatures || []) {
      peakTemperaturesC[sensor.type] = Math.max(peakTemperaturesC[sensor.type] ?? -Infinity, sensor.temperatureC);
    }
  }
  const peakPssSample = samples.reduce((best, sample) =>
    (sample.target.pssBytes ?? -1) > (best.target.pssBytes ?? -1) ? sample : best
  );
  return {
    sampleCount: samples.length,
    peakTargetPssBytes: max(samples.map((sample) => sample.target.pssBytes)),
    peakTargetRssBytes: max(samples.map((sample) => sample.target.rssBytes)),
    minimumMemAvailableBytes: min(samples.map((sample) => sample.memory.availableBytes)),
    peakTargetProcessCount: max(samples.map((sample) => sample.target.processCount)),
    peakTemperaturesC,
    peakPssAt: peakPssSample.timestamp,
    peakPssProcesses: peakPssSample.target.processes,
    samples
  };
}

function formatMiB(bytes) {
  return Number.isFinite(bytes) ? `${(bytes / (1024 ** 2)).toFixed(1)} MiB` : "unavailable";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMonitor(options) {
  const matcher = options.matchRegex || new RegExp(options.match || DEFAULT_MATCH, "i");
  const samples = [];
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + options.durationSeconds * 1000;
  let interrupted = false;

  const stop = () => { interrupted = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!interrupted) {
      samples.push(collectSample({ matcher }));
      const latest = samples[samples.length - 1];
      const availableGiB = latest.memory.availableBytes === null
        ? "n/a"
        : `${(latest.memory.availableBytes / (1024 ** 3)).toFixed(2)} GiB`;
      const hottest = latest.temperatures.length
        ? ` | hottest ${Math.max(...latest.temperatures.map((sensor) => sensor.temperatureC)).toFixed(1)} °C`
        : " | temperature n/a";
      console.log(
        `[${latest.timestamp}] MemAvailable ${availableGiB} | target PSS ${formatMiB(latest.target.pssBytes)} | target RSS ${formatMiB(latest.target.rssBytes)} | processes ${latest.target.processCount}${hottest}`
      );
      if (Date.now() >= deadline) break;
      await sleep(Math.min(options.intervalSeconds * 1000, Math.max(0, deadline - Date.now())));
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    startedAt,
    finishedAt: new Date().toISOString(),
    interrupted,
    durationRequestedSeconds: options.durationSeconds,
    intervalSeconds: options.intervalSeconds,
    match: options.match,
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      hostname: os.hostname()
    },
    summary: summariseSamples(samples)
  };

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(outputPath, 0o600);
    console.log(`Resource report written to ${outputPath}`);
  } else {
    console.log(JSON.stringify({
      sampleCount: result.summary.sampleCount,
      peakTargetPss: formatMiB(result.summary.peakTargetPssBytes),
      peakTargetRss: formatMiB(result.summary.peakTargetRssBytes),
      minimumMemAvailable: formatMiB(result.summary.minimumMemAvailableBytes),
      peakPssAt: result.summary.peakPssAt
    }, null, 2));
  }

  if (result.summary.peakTargetPssBytes === null) {
    console.warn("WARNING: No target PSS was measurable. Ensure MagicMirror Serveronly and Chromium are running and readable through /proc.");
  }
  return result;
}

function printHelp() {
  console.log(`MagicMirror Serveronly resource monitor

Run while the server and Chromium kiosk are active:
  node scripts/serveronly-resource-monitor.js --duration=900 --interval=5 --output=resources.json

Options:
  --duration=SECONDS   Sampling duration (10–86400; default 900)
  --interval=SECONDS   Sampling interval (1–60; default 5)
  --output=FILE        Write a detailed JSON report (mode 0600)
  --match=REGEX        Process command-line filter
  --help               Show this help

The report records MemAvailable/swap, target-process PSS/RSS and available Linux thermal zones.
PSS is preferred for Chromium because it accounts proportionally for shared pages.
It does not replace a physical test in the final mirror enclosure.`);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return printHelp();
    await runMonitor(options);
  } catch (error) {
    console.error(`[MagicMirror resource monitor] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  parseMemoryInfo,
  parseSmapsRollup,
  parseStatusRss,
  readThermalSensors,
  isTargetProcess,
  listProcessIds,
  readProcessMemory,
  collectTargetProcesses,
  collectSample,
  summariseSamples
};
