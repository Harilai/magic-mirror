"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const sharp = require("sharp");
const { processImage } = require("../src/imageProcessor");

function parseArgs(args) {
  const options = { sourceSize: 1800, renderSize: 700, repeat: 3, help: false };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const match = /^--(source-size|render-size|repeat)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const value = Number(match[2]);
    if (!Number.isInteger(value)) throw new Error(`Invalid integer for ${match[1]}.`);
    if (match[1] === "source-size") options.sourceSize = value;
    if (match[1] === "render-size") options.renderSize = value;
    if (match[1] === "repeat") options.repeat = value;
  }

  if (options.sourceSize < 600 || options.sourceSize > 3600) {
    throw new RangeError("source-size must be between 600 and 3600.");
  }
  if (options.renderSize < 1 || options.renderSize > options.sourceSize) {
    throw new RangeError("render-size must be between 1 and source-size.");
  }
  if (options.repeat < 1 || options.repeat > 10) {
    throw new RangeError("repeat must be between 1 and 10.");
  }
  return options;
}

function summarise(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1]
  };
}

async function runBenchmark(options) {
  if (process.platform !== "linux") {
    throw new Error("This benchmark is intended for Linux target devices.");
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-benchmark-"));
  const sourceFile = path.join(workspace, "source.png");
  const targetFile = path.join(workspace, "rendered.png");
  const tempFile = path.join(workspace, "rendered.png.tmp");
  const elapsedTimes = [];
  const workerTimes = [];
  const workerPeakRss = [];
  let sourceBytes = 0;
  let outputBytes = 0;
  let outputDimensions = null;

  try {
    await sharp({
      create: {
        width: options.sourceSize,
        height: options.sourceSize,
        channels: 4,
        background: { r: 32, g: 96, b: 160, alpha: 1 }
      }
    }).png({ compressionLevel: 1 }).toFile(sourceFile);
    sourceBytes = fs.statSync(sourceFile).size;

    for (let index = 0; index < options.repeat; index += 1) {
      const started = performance.now();
      const result = await processImage({
        sourceFile,
        targetFile,
        tempFile,
        renderSize: options.renderSize
      });
      elapsedTimes.push(Math.round(performance.now() - started));
      workerTimes.push(result.durationMs);
      if (Number.isFinite(result.workerMaxRssKb)) workerPeakRss.push(result.workerMaxRssKb);
      outputBytes = result.outputBytes;
      outputDimensions = { width: result.width, height: result.height };
    }

    const metadata = await sharp(targetFile).metadata();
    if (metadata.format !== "png" || metadata.width !== outputDimensions.width || metadata.height !== outputDimensions.height) {
      throw new Error("Benchmark output image failed validation.");
    }

    return {
      generatedAt: new Date().toISOString(),
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        node: process.versions.node,
        cpu: os.cpus()[0]?.model || "unknown"
      },
      workload: {
        source: { width: options.sourceSize, height: options.sourceSize, bytes: sourceBytes },
        renderSize: options.renderSize,
        repeat: options.repeat,
        output: { ...outputDimensions, bytes: outputBytes }
      },
      results: {
        endToEndDurationMs: summarise(elapsedTimes),
        workerDurationMs: summarise(workerTimes),
        workerMaxRssKb: workerPeakRss.length ? summarise(workerPeakRss) : null
      },
      note: "Synthetic Sharp/alpha-mask workload. Not a Chromium, GPU, whole-system RAM or thermal certification."
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function printHelp() {
  console.log(`MMM-Meteosat CPU/memory benchmark

  npm run benchmark -- --source-size=1800 --render-size=700 --repeat=3

Options:
  --source-size=PIXELS  Synthetic square source size (600–3600, default 1800)
  --render-size=PIXELS  Processed output cap (1–source-size, default 700)
  --repeat=COUNT        Number of worker runs (1–10, default 3)
  --help                Show this help

Run on each candidate Linux device after installing the module dependencies.
Compare only results with identical source/render sizes and repeat counts.
`);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return printHelp();
    console.log(JSON.stringify(await runBenchmark(options), null, 2));
  } catch (error) {
    console.error(`[MMM-Meteosat benchmark] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, summarise, runBenchmark };
