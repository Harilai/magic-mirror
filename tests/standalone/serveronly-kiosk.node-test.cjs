"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getRemoteMirrorUrl } = require("../../scripts/serveronly-kiosk");

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
