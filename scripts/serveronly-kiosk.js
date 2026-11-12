"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RETRY_INTERVAL_MS = 1000;
const DEFAULT_STARTUP_TIMEOUT_MS = 60000;

function fail(message) {
  console.error(`[MagicMirror kiosk] ERROR: ${message}`);
  process.exit(1);
}

function loadConfig() {
  const configuredPath = process.env.MM_CONFIG_FILE || path.join(ROOT, "config", "config.js");
  const configPath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(ROOT, configuredPath);
  if (!fs.existsSync(configPath)) fail(`Configuration file not found: ${configPath}`);
  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } catch (error) {
    fail(`Cannot load configuration ${configPath}: ${error.message}`);
  }
}

function getMirrorUrl(config) {
  const rawPort = process.env.MM_PORT !== undefined ? process.env.MM_PORT : (config.port ?? 8080);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Invalid server port: ${rawPort}`);

  let address = typeof config.address === "string" && config.address.trim() ? config.address.trim() : "localhost";
  if (address === "0.0.0.0" || address === "::") address = "127.0.0.1";

  const protocol = config.useHttps ? "https:" : "http:";
  const host = address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
  const basePath = typeof config.basePath === "string" && config.basePath.startsWith("/") ? config.basePath : "/";
  const url = new URL(`${protocol}//${host}:${port}`);
  url.pathname = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return url;
}

function requestReady(url) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const request = transport.get(url, { timeout: 2500, rejectUnauthorized: false }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 400);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function waitForServer(url) {
  const configuredTimeout = Number(process.env.MM_KIOSK_STARTUP_TIMEOUT_MS || DEFAULT_STARTUP_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_STARTUP_TIMEOUT_MS;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await requestReady(url)) {
      console.log(`[MagicMirror kiosk] Server ready at ${url.href}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
  fail(`MagicMirror did not become reachable at ${url.href} within ${timeout} ms. Check magicmirror-server.service logs.`);
}

async function main() {
  const config = loadConfig();
  const url = getMirrorUrl(config);
  await waitForServer(url);

  const browser = process.env.MM_BROWSER_BIN || "chromium";
  const args = [
    "--kiosk",
    "--no-first-run",
    "--disable-session-crashed-bubble",
    "--disable-infobars",
    "--noerrdialogs",
    "--disable-features=Translate",
    url.href
  ];

  console.log(`[MagicMirror kiosk] Starting ${browser} in kiosk mode`);
  const child = spawn(browser, args, { stdio: "inherit" });

  const forwardSignal = (signal) => {
    if (child && !child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.once("error", (error) => {
    fail(`Could not start browser '${browser}': ${error.message}. Install Chromium or set MM_BROWSER_BIN.`);
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      console.log(`[MagicMirror kiosk] Browser exited on ${signal}`);
      process.exitCode = 0;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

main().catch((error) => fail(error.message));
