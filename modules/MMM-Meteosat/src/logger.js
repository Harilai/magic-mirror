"use strict";

const LEVELS = Object.freeze({ ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 });

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

class MeteosatLogger {
  constructor(instanceId, level = "INFO") {
    this.instanceId = instanceId;
    this.level = Object.hasOwn(LEVELS, level) ? level : "INFO";
  }

  enabled(level) {
    return LEVELS[level] <= LEVELS[this.level];
  }

  write(level, message) {
    if (!this.enabled(level)) return;
    const text = `[MMM-Meteosat][${this.instanceId}][${level}] ${message}`;
    if (level === "ERROR") console.error(text);
    else if (level === "WARN") console.warn(text);
    else console.log(text);
  }

  error(message) { this.write("ERROR", message); }
  warn(message) { this.write("WARN", message); }
  info(message) { this.write("INFO", message); }
  debug(message) { this.write("DEBUG", message); }

  block(level, title, entries = {}) {
    if (!this.enabled(level)) return;

    this.write(level, `---- ${title} ${"-".repeat(Math.max(1, 56 - title.length))}`);
    for (const [key, value] of Object.entries(entries)) {
      this.write(level, `${String(key).padEnd(22, ".")} ${formatValue(value)}`);
    }
    this.write(level, "-".repeat(64));
  }
}

module.exports = { MeteosatLogger, LEVELS };
