"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const REQUIRED_NODE = ">=22.22.2 <23 or >=24";

function parseVersion(value) {
  const match = /^(?:v)?(\\d+)\\.(\\d+)\\.(\\d+)/.exec(String(value));
  if (!match) return null;
  return match.slice(1).map(Number);
}

function isSupportedNode(version, architecture = process.arch) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed;
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2);
  // Official Node 24 Linux builds do not target 32-bit ARM (armv7).
  return major >= 24 && architecture !== "arm";
}

function parseOsRelease(content) {
  const values = {};
  for (const line of String(content).split(/\\r?\\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return values;
}

function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout || 5000,
    env: process.env,
    windowsHide: true
  });
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    const result = run("sh", ["-lc", "command -v \"$1\" 2>/dev/null", "sh", candidate], { timeout: 2500 });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return null;
}

function add(results, status, check, detail) {
  results.push({ status, check, detail });
}

function loadConfig() {
  const configuredPath = process.env.MM_CONFIG_FILE || path.join(ROOT, "config", "config.js");
  const absolutePath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(ROOT, configuredPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Configuration file not found: ${absolutePath}`);
  delete require.cache[require.resolve(absolutePath)];
  const config = require(absolutePath);
  if (!config || typeof config !== "object" || !Array.isArray(config.modules)) {
    throw new Error("Configuration must export an object containing a modules array.");
  }
  return { config, absolutePath };
}

function inspectConfiguredModules(config, results) {
  const customModulesDir = path.resolve(ROOT, config.paths?.modules || "modules");
  const defaultModulesDir = path.resolve(ROOT, config.paths?.defaultModules || "defaultmodules");
  const names = [...new Set(config.modules.map((entry) => entry?.module).filter((name) => typeof name === "string"))];
  const configured = new Set(names);

  for (const name of names) {
    const isDefault = fs.existsSync(path.join(defaultModulesDir, name));
    const moduleDir = isDefault ? path.join(defaultModulesDir, name) : path.join(customModulesDir, name);
    const packagePath = path.join(moduleDir, "package.json");
    let entryPath = path.join(moduleDir, `${name}.js`);
    if (fs.existsSync(packagePath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (metadata.main) entryPath = path.resolve(moduleDir, metadata.main);
      } catch (error) {
        add(results, "FAIL", `module:${name}`, `Invalid package.json: ${error.message}`);
        continue;
      }
    }
    if (fs.existsSync(entryPath)) {
      add(results, "PASS", `module:${name}`, `Entry point found: ${path.relative(ROOT, entryPath)}`);
    } else {
      add(results, "FAIL", `module:${name}`, `Entry point not found under ${path.relative(ROOT, moduleDir)}`);
    }
  }

  return configured;
}

async function checkSharp(results) {
  const moduleDir = path.join(ROOT, "modules", "MMM-Meteosat");
  const workerPath = path.join(moduleDir, "src", "sharpWorker.js");
  if (!fs.existsSync(workerPath)) {
    add(results, "SKIP", "sharp", "MMM-Meteosat is not present in this checkout.");
    return;
  }

  try {
    const requireFromWorker = createRequire(workerPath);
    const sharp = requireFromWorker("sharp");
    const svg = Buffer.from('<svg width="16" height="16"><rect width="16" height="16" fill="#336699"/></svg>');
    const png = await sharp(svg).png().toBuffer();
    const metadata = await sharp(png).metadata();
    if (metadata.format !== "png" || metadata.width !== 16 || metadata.height !== 16) {
      throw new Error("Native image-processing smoke test returned unexpected metadata.");
    }
    add(results, "PASS", "sharp", `Loaded sharp ${sharp.versions.sharp || "unknown"} / libvips ${sharp.versions.vips || "unknown"} and processed a 16x16 PNG.`);
  } catch (error) {
    add(results, "FAIL", "sharp", `MMM-Meteosat is present but sharp failed to load or process an image: ${error.message}`);
  }

  const workerNode = process.env.MMM_METEOSAT_NODE_BINARY || "node";
  const workerVersion = run(workerNode, ["--version"]);
  if (workerVersion.status === 0) {
    add(results, "PASS", "meteosat-worker-node", `${workerNode} resolves to ${workerVersion.stdout.trim()}.`);
  } else {
    add(results, "FAIL", "meteosat-worker-node", `Cannot execute '${workerNode}' from this service environment: ${workerVersion.error?.message || workerVersion.stderr || "not found"}`);
  }
}

function checkSecurityConfig(config, results) {
  const remote = config.modules.find((entry) => entry?.module === "MMM-Remote-Control");
  if (!remote) return;

  if (remote.config?.secureEndpoints === true) {
    add(results, "PASS", "remote-control-secure-endpoints", "secureEndpoints is enabled.");
  } else {
    add(results, "WARN", "remote-control-secure-endpoints", "secureEndpoints is not explicitly true.");
  }

  const whitelist = Array.isArray(config.ipWhitelist) ? config.ipWhitelist : [];
  if (whitelist.some((entry) => typeof entry === "string" && entry !== entry.trim())) {
    add(results, "WARN", "ip-whitelist-whitespace", "At least one ipWhitelist entry has leading or trailing whitespace.");
  } else {
    add(results, "PASS", "ip-whitelist-whitespace", "No whitespace issue detected in ipWhitelist.");
  }

  const apiKey = remote.config?.apiKey;
  if (typeof apiKey === "string" && apiKey.trim()) {
    add(results, "WARN", "remote-control-api-key", "An API key is present in the loaded config. Ensure it is rotated and supplied from an untracked local secret source; the value was not displayed.");
  } else {
    add(results, "PASS", "remote-control-api-key", "No literal API key is present in the loaded config.");
  }
}

async function collectDiagnostics() {
  const results = [];
  const architecture = process.arch;
  const platform = process.platform;
  const version = process.versions.node;
  const reportHeader = process.report?.getReport?.().header || {};
  const glibc = reportHeader.glibcVersionRuntime || null;
  const bits = architecture === "x64" || architecture === "arm64" ? 64 : architecture === "ia32" || architecture === "arm" ? 32 : null;
  const osRelease = fs.existsSync("/etc/os-release")
    ? parseOsRelease(fs.readFileSync("/etc/os-release", "utf8"))
    : {};

  if (platform === "linux") {
    add(results, "PASS", "operating-system", `${osRelease.PRETTY_NAME || os.type()} (${osRelease.ID || "unknown distro"}), kernel ${os.release()}.`);
  } else {
    add(results, "FAIL", "operating-system", `Expected Linux for the documented Chromium kiosk deployment; detected ${platform}.`);
  }

  add(results, "PASS", "architecture", `${architecture}${bits ? ` / ${bits}-bit` : ""}.`);
  if (isSupportedNode(version, architecture)) {
    add(results, "PASS", "node-engine", `Node.js ${version} satisfies repository engine ${REQUIRED_NODE}.`);
  } else {
    add(results, "FAIL", "node-engine", `Node.js ${version} on ${architecture} does not satisfy the deployable target baseline ${REQUIRED_NODE}; ARMv7 must use Node 22.22.2 or a compatible 22.x release.`);
  }

  if (glibc) {
    add(results, "PASS", "libc", `glibc ${glibc} detected.`);
  } else {
    const ldd = run("ldd", ["--version"]);
    const firstLine = (ldd.stdout || ldd.stderr || "").split(/\\r?\\n/)[0].trim();
    add(results, "WARN", "libc", firstLine || "glibc version not reported by Node; this may be a musl-based system. Validate native sharp support on this OS.");
  }

  const totalMemory = os.totalmem();
  const gib = totalMemory / (1024 ** 3);
  add(results, gib < 1.5 ? "WARN" : "PASS", "memory", `${gib.toFixed(2)} GiB total RAM detected. Measure peak usage with Chromium and all modules active.`);

  const browser = process.env.MM_BROWSER_BIN || findExecutable(["chromium", "chromium-browser", "google-chrome"]);
  if (browser) {
    const browserVersion = run(browser, ["--version"], { timeout: 10000 });
    if (browserVersion.status === 0) {
      add(results, "PASS", "chromium", `${browser}: ${(browserVersion.stdout || browserVersion.stderr).trim()}`);
    } else {
      add(results, "FAIL", "chromium", `Browser executable was found but --version failed: ${browserVersion.error?.message || browserVersion.stderr || "unknown error"}`);
    }
  } else {
    add(results, "FAIL", "chromium", "No Chromium executable found. Install chromium or set MM_BROWSER_BIN.");
  }

  let config;
  let configuredModules = new Set();
  try {
    const loaded = loadConfig();
    config = loaded.config;
    add(results, "PASS", "configuration", `Loaded ${path.relative(ROOT, loaded.absolutePath)} without printing its values.`);
    configuredModules = inspectConfiguredModules(config, results);
    checkSecurityConfig(config, results);
  } catch (error) {
    add(results, "FAIL", "configuration", error.message);
  }

  if (configuredModules.has("MMM-Meteosat")) {
    await checkSharp(results);
  } else {
    add(results, "SKIP", "sharp", "MMM-Meteosat is not enabled in the loaded config.");
  }

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      platform,
      architecture,
      bits,
      node: version,
      libc: glibc ? `glibc ${glibc}` : "not reported",
      totalMemoryBytes: totalMemory,
      distro: osRelease.PRETTY_NAME || null
    },
    results,
    summary: {
      passed: results.filter((item) => item.status === "PASS").length,
      warnings: results.filter((item) => item.status === "WARN").length,
      failed: results.filter((item) => item.status === "FAIL").length,
      skipped: results.filter((item) => item.status === "SKIP").length
    }
  };
}

async function main() {
  const report = await collectDiagnostics();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("MagicMirror device acceptance diagnostic");
    console.log(`Runtime: ${report.runtime.platform} / ${report.runtime.architecture} / Node ${report.runtime.node} / ${report.runtime.libc}`);
    console.log("");
    for (const item of report.results) {
      console.log(`[${item.status}] ${item.check}: ${item.detail}`);
    }
    console.log("");
    console.log(`Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failed, ${report.summary.skipped} skipped.`);
  }
  if (report.summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[MagicMirror device check] ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseVersion, isSupportedNode, parseOsRelease, collectDiagnostics };
