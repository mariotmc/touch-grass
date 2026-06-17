// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Cross-window break schedule: a single JSON file under the extension's global
 * storage, shared by every VS Code window. Pure best-effort file I/O — the
 * controller layers the reconcile logic on top. Shape: `{ nextBreakAt, breakEndsAt }`.
 */

/** @param {string} file @returns {any} parsed schedule, or null if absent/unreadable */
function readSchedule(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** @param {string} file @param {any} data — write atomically (tmp + rename); silent on failure */
function writeSchedule(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch {
    // best-effort: a missed write just means windows momentarily disagree
  }
}

module.exports = { readSchedule, writeSchedule };
