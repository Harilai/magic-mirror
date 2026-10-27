"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const moduleFile = path.join(root, "MMM-Meteosat.js");
const readmeFile = path.join(root, "README.md");

function loadDefaults() {
  let registration = null;
  const sandbox = {
    Module: {
      register(name, definition) {
        registration = { name, definition };
      }
    },
    console
  };

  vm.runInNewContext(fs.readFileSync(moduleFile, "utf8"), sandbox, {
    filename: moduleFile
  });

  if (!registration || registration.name !== "MMM-Meteosat" || !registration.definition?.defaults) {
    throw new Error("Could not load public defaults from MMM-Meteosat.js.");
  }

  return registration.definition.defaults;
}

function flattenLeaves(value, prefix = "") {
  const result = new Map();

  for (const [key, child] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      for (const [nestedName, nestedValue] of flattenLeaves(child, name)) {
        result.set(nestedName, nestedValue);
      }
    } else {
      result.set(name, child);
    }
  }

  return result;
}

function formatDefault(value) {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return JSON.stringify(value);
  return JSON.stringify(value);
}

function readReferenceRows(markdown) {
  const match = markdown.match(/<!-- config-reference:start -->([\s\S]*?)<!-- config-reference:end -->/);
  if (!match) throw new Error("README configuration-reference markers are missing.");

  const rows = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^\| `([^`]+)` \| [^|]+ \| `([^`]*)` \|/);
    if (!row) continue;
    if (rows.has(row[1])) throw new Error(`Duplicate README configuration row: ${row[1]}`);
    rows.set(row[1], row[2]);
  }
  return rows;
}

function main() {
  const expected = flattenLeaves(loadDefaults());
  const documented = readReferenceRows(fs.readFileSync(readmeFile, "utf8"));
  const errors = [];

  for (const [name, value] of expected) {
    if (!documented.has(name)) {
      errors.push(`Missing README configuration row: ${name}`);
      continue;
    }

    const expectedDefault = formatDefault(value);
    const actualDefault = documented.get(name);
    if (actualDefault !== expectedDefault) {
      errors.push(`${name}: documented default ${actualDefault}, code default ${expectedDefault}`);
    }
  }

  for (const name of documented.keys()) {
    if (!expected.has(name)) errors.push(`README documents unknown configuration option: ${name}`);
  }

  if (errors.length) {
    console.error("README configuration validation failed:\n");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`README configuration reference is current (${expected.size} options).`);
}

main();
