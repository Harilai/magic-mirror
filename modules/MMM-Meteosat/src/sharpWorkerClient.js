"use strict";

const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

function workerError(message, name = "Error") {
  const error = new Error(message);
  error.name = name;
  return error;
}

function runSharpWorker(request, { signal = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(workerError("Sharp worker operation aborted.", "AbortError"));
      return;
    }

    const worker = path.join(__dirname, "sharpWorker.js");
    const nodeBinary = process.env.MMM_METEOSAT_NODE_BINARY || "node";
    const child = spawn(nodeBinary, [worker], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const terminate = () => {
      if (!child.killed) child.kill("SIGKILL");
    };
    const abort = () => {
      terminate();
      finish(reject, workerError("Sharp worker operation aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      terminate();
      finish(reject, workerError(`Sharp worker timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        terminate();
        finish(reject, workerError("Sharp worker returned too much output."));
      }
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8192); });
    child.on("error", (error) => finish(reject, workerError(`Could not start sharp worker: ${error.message}`)));
    child.on("close", () => {
      if (settled) return;
      let response;
      try {
        response = JSON.parse(stdout.trim());
      } catch {
        finish(reject, workerError(`Sharp worker returned invalid output${stderr ? `: ${stderr.trim()}` : "."}`));
        return;
      }
      if (!response.ok) {
        finish(reject, workerError(response.error?.message || "Sharp worker failed.", response.error?.name || "Error"));
        return;
      }
      finish(resolve, response.result);
    });

    child.stdin.end(JSON.stringify(request));
  });
}

function inspectImage(file, options) {
  return runSharpWorker({ operation: "inspect", file }, options);
}

function processImageInWorker(sourceFile, outputFile, options) {
  return runSharpWorker({ operation: "process", sourceFile, outputFile }, options);
}

module.exports = { runSharpWorker, inspectImage, processImageInWorker };
