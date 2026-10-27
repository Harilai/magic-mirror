"use strict";

function abortError(message = "Update aborted because the module was reconfigured.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function sleep(delay, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function runWithRetries({ operationName, operation, retryDelays = [], signal = null, logger = null, sleepFunction = sleep }) {
  const totalAttempts = retryDelays.length + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    if (signal?.aborted) throw abortError();
    try {
      return await operation(attempt);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw abortError();
      logger?.block?.("DEBUG", `${operationName} attempt failed`, {
        attempt: `${attempt}/${totalAttempts}`,
        message: error.message,
        status: error.status,
        retryable: error.retryable === true,
        details: error.details || null
      });
      if (error?.retryable !== true || attempt >= totalAttempts) throw error;
      const delay = retryDelays[attempt - 1];
      logger?.warn?.(`${operationName} attempt ${attempt}/${totalAttempts} failed: ${error.message} Retrying in ${Math.round(delay / 1000)} seconds.`);
      await sleepFunction(delay, signal);
    }
  }
  throw new Error("Retry loop ended unexpectedly.");
}

module.exports = { abortError, sleep, runWithRetries };
