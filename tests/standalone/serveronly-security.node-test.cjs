"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { checkSecurityConfig, parseCpuFlags, checkSharpCpuFeatures } = require("../../scripts/serveronly-device-check");

function remoteConfig(apiKey = "") {
  return {
    address: "127.0.0.1",
    ipWhitelist: ["127.0.0.1"],
    modules: [{
      module: "MMM-Remote-Control",
      config: { secureEndpoints: true, apiKey }
    }]
  };
}

test("device check accepts an API key loaded from the designated environment variable", () => {
  const previous = process.env.MM_REMOTE_CONTROL_API_KEY;
  const secret = "test-only-secret-value";
  process.env.MM_REMOTE_CONTROL_API_KEY = secret;

  try {
    const results = [];
    checkSecurityConfig(remoteConfig(secret), results);
    const keyResult = results.find((entry) => entry.check === "remote-control-api-key");
    assert.deepEqual(keyResult, {
      status: "PASS",
      check: "remote-control-api-key",
      detail: "Remote Control API key is loaded from MM_REMOTE_CONTROL_API_KEY; its value was not displayed."
    });
    assert.equal(JSON.stringify(results).includes(secret), false);
  } finally {
    if (previous === undefined) delete process.env.MM_REMOTE_CONTROL_API_KEY;
    else process.env.MM_REMOTE_CONTROL_API_KEY = previous;
  }
});

test("device check warns when a key is hardcoded instead of environment-sourced", () => {
  const previous = process.env.MM_REMOTE_CONTROL_API_KEY;
  delete process.env.MM_REMOTE_CONTROL_API_KEY;

  try {
    const results = [];
    checkSecurityConfig(remoteConfig("hardcoded-value"), results);
    const keyResult = results.find((entry) => entry.check === "remote-control-api-key");
    assert.equal(keyResult.status, "WARN");
    assert.match(keyResult.detail, /not confirmed to come from MM_REMOTE_CONTROL_API_KEY/);
    assert.equal(JSON.stringify(results).includes("hardcoded-value"), false);
  } finally {
    if (previous !== undefined) process.env.MM_REMOTE_CONTROL_API_KEY = previous;
  }
});

test("device check warns when no Remote Control key is configured", () => {
  const previous = process.env.MM_REMOTE_CONTROL_API_KEY;
  delete process.env.MM_REMOTE_CONTROL_API_KEY;

  try {
    const results = [];
    checkSecurityConfig(remoteConfig(""), results);
    const keyResult = results.find((entry) => entry.check === "remote-control-api-key");
    assert.equal(keyResult.status, "WARN");
    assert.match(keyResult.detail, /protected Remote Control endpoints will remain blocked/);
  } finally {
    if (previous !== undefined) process.env.MM_REMOTE_CONTROL_API_KEY = previous;
  }
});

test("project configuration reads Remote Control API key from environment only", () => {
  const previous = process.env.MM_REMOTE_CONTROL_API_KEY;
  const secret = "config-env-test-secret";
  process.env.MM_REMOTE_CONTROL_API_KEY = secret;
  const configPath = path.resolve(__dirname, "../../config/config.js");

  try {
    delete require.cache[configPath];
    const config = require(configPath);
    const remote = config.modules.find((entry) => entry.module === "MMM-Remote-Control");
    assert.equal(remote.config.apiKey, secret);
    assert.equal(remote.config.secureEndpoints, true);
  } finally {
    delete require.cache[configPath];
    if (previous === undefined) delete process.env.MM_REMOTE_CONTROL_API_KEY;
    else process.env.MM_REMOTE_CONTROL_API_KEY = previous;
  }
});


test("CPU flag parser reads x86 SSE4.2 features", () => {
  const flags = parseCpuFlags(["processor : 0", "flags : fpu sse sse2 sse4_1 sse4_2 avx"].join(String.fromCharCode(10)));
  assert.ok(flags.has("sse4_2"));
  assert.ok(flags.has("sse4_1"));
});

test("device check fails x86 Sharp preflight when SSE4.2 is unavailable", () => {
  const results = [];
  const supported = checkSharpCpuFeatures("x64", "flags : fpu sse sse2 sse4_1", results);
  assert.equal(supported, false);
  assert.equal(results[0].status, "FAIL");
  assert.equal(results[0].check, "sharp-cpu-features");
});

test("device check accepts x86 Sharp preflight when SSE4.2 is available", () => {
  const results = [];
  const supported = checkSharpCpuFeatures("x64", "flags : fpu sse sse2 sse4_1 sse4_2", results);
  assert.equal(supported, true);
  assert.equal(results[0].status, "PASS");
  assert.equal(results[0].check, "sharp-cpu-features");
});

test("ARM64 devices do not require the x86 SSE4.2 flag", () => {
  const results = [];
  assert.equal(checkSharpCpuFeatures("arm64", "", results), true);
  assert.equal(results.length, 0);
});
