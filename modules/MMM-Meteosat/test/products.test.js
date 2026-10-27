"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveProduct } = require("../src/products");

test("default product resolves to geocolour", () => {
  assert.equal(resolveProduct().resolved, "geocolour");
});

test("product names are normalised", () => {
  assert.equal(resolveProduct(" DUST ").resolved, "dust");
});

test("unsupported products are rejected", () => {
  assert.throws(() => resolveProduct("invalid-product"), /Unsupported product/);
});
