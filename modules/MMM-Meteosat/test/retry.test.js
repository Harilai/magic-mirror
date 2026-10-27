"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runWithRetries } = require("../src/retry");

function retryable(message = "temporary") {
  const error = new Error(message);
  error.retryable = true;
  return error;
}

test("retry helper retries retryable errors and preserves delays", async () => {
  let calls = 0;
  const delays = [];
  const result = await runWithRetries({
    operationName: "test",
    retryDelays: [10, 20],
    operation: async () => {
      calls += 1;
      if (calls < 3) throw retryable();
      return "ok";
    },
    sleepFunction: async (delay) => { delays.push(delay); }
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("retry helper does not retry permanent errors", async () => {
  let calls = 0;
  await assert.rejects(runWithRetries({
    operationName: "test",
    retryDelays: [10, 20],
    operation: async () => { calls += 1; throw new Error("permanent"); },
    sleepFunction: async () => assert.fail("sleep must not be called")
  }), /permanent/);
  assert.equal(calls, 1);
});

test("retry helper stops after configured attempts", async () => {
  let calls = 0;
  await assert.rejects(runWithRetries({
    operationName: "test",
    retryDelays: [0, 0],
    operation: async () => { calls += 1; throw retryable("still failing"); },
    sleepFunction: async () => {}
  }), /still failing/);
  assert.equal(calls, 3);
});

test("retry helper aborts during retry wait", async () => {
  const controller = new AbortController();
  await assert.rejects(runWithRetries({
    operationName: "test",
    retryDelays: [10],
    signal: controller.signal,
    operation: async () => { throw retryable(); },
    sleepFunction: async () => { controller.abort(); }
  }), (error) => error.name === "AbortError");
});
