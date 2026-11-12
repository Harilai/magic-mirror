"use strict";

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`[MagicMirror preflight] ERROR: ${message}`);
  process.exit(1);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) fail(`Cannot parse Node.js version: ${version}`);
  return match.slice(1).map(Number);
}

function assertSupportedNode() {
  const [major, minor, patch] = parseVersion(process.versions.node);
  const supported = major >= 24 || (major === 22 && (minor > 22 || (minor === 22 && patch >= 2)));
  if (!supported) {
    fail(`Node.js ${process.versions.node} is unsupported. This repository requires >=22.22.2 <23 or >=24.`);
  }
  console.log(`[MagicMirror preflight] Node.js ${process.versions.node}: supported`);
}

function loadConfig() {
  const configuredPath = process.env.MM_CONFIG_FILE || path.join(ROOT, "config", "config.js");
  const configPath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(ROOT, configuredPath);
  if (!fs.existsSync(configPath)) fail(`Configuration file not found: ${configPath}`);

  try {
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    if (!config || typeof config !== "object") fail("The configuration file did not export an object.");
    return config;
  } catch (error) {
    fail(`Cannot load configuration ${configPath}: ${error.message}`);
  }
}

function getRuntimeConfig(config) {
  const rawPort = process.env.MM_PORT !== undefined ? process.env.MM_PORT : (config.port ?? 8080);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`Invalid server port '${rawPort}'. Set MM_PORT or config.port to an integer from 1 to 65535.`);
  }
  const address = typeof config.address === "string" && config.address.trim() ? config.address.trim() : "localhost";
  return { port, address };
}

function checkPort(port, address) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use on ${address}. No process was stopped. Identify the owner (for example with 'ss -ltnp') and resolve the conflict manually.`));
      } else {
        reject(new Error(`Cannot check ${address}:${port}: ${error.message}`));
      }
    });
    probe.once("listening", () => probe.close((error) => error ? reject(error) : resolve()));
    probe.listen({ port, host: address, exclusive: true });
  });
}

async function main() {
  assertSupportedNode();
  const config = loadConfig();
  const { port, address } = getRuntimeConfig(config);
  await checkPort(port, address);
  console.log(`[MagicMirror preflight] Port ${port} on ${address}: available`);
  console.log("[MagicMirror preflight] Configuration loaded. No secrets were printed.");
}

main().catch((error) => fail(error.message));
