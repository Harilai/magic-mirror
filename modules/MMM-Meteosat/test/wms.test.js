"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { Readable } = require("stream");
const { WmsRequestError, sanitiseLogText, parseTimeDimension, extractLatestLayerTime, readBodyWithLimit, streamResponseToFile, downloadWmsImage } = require("../src/sources/wms");

const fixtures = path.join(__dirname, "fixtures");

test("time dimension parser handles ranges, lists and invalid entries", () => {
  assert.equal(parseTimeDimension("2026-07-22T10:00:00Z/2026-07-22T10:40:00Z/PT10M").latest, "2026-07-22T10:40:00.000Z");
  assert.equal(parseTimeDimension("2026-07-22T10:10:00Z, 2026-07-22T10:30:00Z").latest, "2026-07-22T10:30:00.000Z");
  assert.equal(parseTimeDimension("not-a-date").latest, null);
  assert.equal(parseTimeDimension(" &amp; ").raw, "&");
});

test("latest layer time is selected from capabilities XML", () => {
  const xml = fs.readFileSync(path.join(fixtures, "capabilities.xml"), "utf8");
  assert.equal(extractLatestLayerTime(xml, "msg_fes:rgb_geocolour").imageTime, "2026-07-22T10:40:00.000Z");
  assert.equal(extractLatestLayerTime(xml, "msg_fes:rgb_dust").imageTime, "2026-07-22T10:30:00.000Z");
  assert.equal(extractLatestLayerTime(xml, "missing:layer").imageTime, null);
});

test("response reader accepts bodies within the configured limit", async () => {
  const response = { headers: new Headers(), body: Readable.from([Buffer.from("abc"), Buffer.from("def")]) };
  assert.equal((await readBodyWithLimit(response, 6)).toString(), "abcdef");
});

test("response reader rejects declared and streamed oversize bodies", async () => {
  const declared = { headers: new Headers({ "content-length": "7" }), body: Readable.from([Buffer.from("1234567")]) };
  await assert.rejects(readBodyWithLimit(declared, 6), (error) => error instanceof WmsRequestError && error.retryable === false);

  const streamed = { headers: new Headers(), body: Readable.from([Buffer.from("1234"), Buffer.from("5678")]) };
  await assert.rejects(readBodyWithLimit(streamed, 6), /exceeded maximum size/);
});

test("upstream log text is single-line, stripped and bounded", () => {
  const value = sanitiseLogText("line one\nline two\t\u0000tail", 18);
  assert.equal(value.includes("\n"), false);
  assert.equal(value.includes("\u0000"), false);
  assert.ok(value.length <= 18);
});


test("stream response writes one file and calculates its hash incrementally", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-stream-"));
  const destination = path.join(root, "image.bin");
  const body = Buffer.from("streamed-image-content");
  try {
    const response = {
      headers: new Headers({ "content-length": String(body.length) }),
      body: Readable.toWeb(Readable.from([body.subarray(0, 7), body.subarray(7)]))
    };
    const result = await streamResponseToFile(response, destination, body.length);
    assert.equal(result.bytes, body.length);
    assert.equal(result.hash, require("crypto").createHash("sha256").update(body).digest("hex"));
    assert.deepEqual(fs.readFileSync(destination), body);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stream response rejects declared and actual oversize bodies without leaving files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-stream-"));
  try {
    const declaredFile = path.join(root, "declared.bin");
    const declared = {
      headers: new Headers({ "content-length": "7" }),
      body: Readable.from([Buffer.from("1234567")])
    };
    await assert.rejects(
      streamResponseToFile(declared, declaredFile, 6),
      (error) => error instanceof WmsRequestError && error.retryable === false
    );
    assert.equal(fs.existsSync(declaredFile), false);

    const streamedFile = path.join(root, "streamed.bin");
    const streamed = {
      headers: new Headers(),
      body: Readable.from([Buffer.from("1234"), Buffer.from("5678")])
    };
    await assert.rejects(
      streamResponseToFile(streamed, streamedFile, 6),
      (error) => error instanceof WmsRequestError && error.retryable === false
    );
    assert.equal(fs.existsSync(streamedFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stream response removes partial files when aborted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-stream-"));
  const destination = path.join(root, "aborted.bin");
  const controller = new AbortController();
  const body = Readable.from((async function* () {
    yield Buffer.from("first chunk");
    await new Promise((resolve) => setTimeout(resolve, 100));
    yield Buffer.from("second chunk");
  })());

  try {
    const operation = streamResponseToFile({ headers: new Headers(), body }, destination, 100, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(operation, (error) => error.name === "AbortError");
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("WMS image download streams, validates, hashes and atomically stores the response", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-meteosat-wms-download-"));
  const width = 240;
  const height = 240;
  const raw = Buffer.alloc(width * height * 3);
  let state = 0x12345678;
  for (let index = 0; index < raw.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    raw[index] = state & 0xff;
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const targetFile = path.join(root, "source.png");
  const tempFile = path.join(root, "source.png.tmp");
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => new Response(png, {
      status: 200,
      headers: { "content-type": "image/png" }
    });
    const result = await downloadWmsImage({
      profile: { layer: "test:layer" },
      targetFile,
      tempFile,
      size: width,
      userAgent: "MMM-Meteosat-test",
      imageTime: "2026-11-13T09:00:00.000Z"
    });

    assert.equal(result.bytes, png.length);
    assert.equal(result.hash, require("crypto").createHash("sha256").update(png).digest("hex"));
    assert.equal(result.metadata.width, width);
    assert.equal(result.metadata.height, height);
    assert.deepEqual(fs.readFileSync(targetFile), png);
    assert.equal(fs.readdirSync(root).some((name) => name.includes(".tmp.")), false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
