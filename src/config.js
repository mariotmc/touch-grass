// @ts-check
"use strict";

const vscode = require("vscode");

const SECTION = "touchGrass";

/** @param {number} n @param {number} lo @param {number} hi @param {number} fallback */
function clampNum(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Read and normalize all `touchGrass.*` settings into a plain object.
 * Everything is clamped so a bad user value can never break the timer.
 */
function getConfig() {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: c.get("enabled", true),
    startAutomatically: c.get("startAutomatically", true),
    intervalMinutes: clampNum(c.get("intervalMinutes", 60), 1, 600, 60),
    breakDurationSeconds: clampNum(c.get("breakDurationSeconds", 300), 5, 3600, 300),
    postponeMinutes: clampNum(c.get("postponeMinutes", 5), 1, 120, 5),
    autoEndBreak: c.get("autoEndBreak", true),
    maximizeOnBreak: c.get("maximizeOnBreak", true),
    showStatusBar: c.get("showStatusBar", true),
    reducedMotion: c.get("reducedMotion", false),
    focusWindowOnBreak: c.get("focusWindowOnBreak", true),
    syncAcrossWindows: c.get("syncAcrossWindows", true),
  };
}

module.exports = { SECTION, getConfig };
