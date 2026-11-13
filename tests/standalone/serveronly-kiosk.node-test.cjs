"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { getRemoteMirrorUrl, requestReady } = require("../../scripts/serveronly-kiosk");

test("remote kiosk URL accepts HTTP and normalises a base path", () => {
  const url = getRemoteMirrorUrl("http://192.168.25.10:8080/mirror");
  assert.equal(url.href, "http://192.168.25.10:8080/mirror/");
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "192.168.25.10");
});

test("remote kiosk URL accepts HTTPS and IPv6 authorities", () => {
  assert.equal(
    getRemoteMirrorUrl("https://mirror.example.local").href,
    "https://mirror.example.local/"
  );
  assert.equal(
    getRemoteMirrorUrl("http://[fd00::10]:8080/").href,
    "http://[fd00::10]:8080/"
  );
});

test("remote kiosk URL rejects non-HTTP schemes", () => {
  assert.throws(() => getRemoteMirrorUrl("file:///etc/passwd"), /http:\/\/ or https:\/\//);
  assert.throws(() => getRemoteMirrorUrl("javascript:alert(1)"), /http:\/\/ or https:\/\//);
});

test("remote kiosk URL rejects credentials, queries, fragments and malformed values", () => {
  assert.throws(() => getRemoteMirrorUrl("http://user:pass@mirror.local:8080"), /must not contain credentials/);
  assert.throws(() => getRemoteMirrorUrl("http://mirror.local/?token=abc"), /query string or fragment/);
  assert.throws(() => getRemoteMirrorUrl("http://mirror.local/#section"), /query string or fragment/);
  assert.throws(() => getRemoteMirrorUrl("not-a-url"), /valid absolute URL/);
  assert.throws(() => getRemoteMirrorUrl(""), /non-empty HTTP\(S\) URL/);
});


test("remote readiness probe verifies a reachable HTTP server", async () => {
  const server = http.createServer((request, response) => {
    response.statusCode = request.url === "/mirror/" ? 200 : 404;
    response.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.equal(await requestReady(new URL(`http://127.0.0.1:${address.port}/mirror/`)), true);
    assert.equal(await requestReady(new URL(`http://127.0.0.1:${address.port}/missing/`)), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
