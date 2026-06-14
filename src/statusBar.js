// @ts-check
"use strict";

const vscode = require("vscode");

/** @param {number} ms -> "m:ss" (or "h:mm:ss" past an hour). */
function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

class StatusBar {
  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "touchGrass.openMenu";
    this.item.name = "Touch Grass";
  }

  /**
   * @param {"running" | "breaking" | "paused"} state
   * @param {number} remainingMs
   * @param {boolean} visible
   */
  update(state, remainingMs, visible) {
    if (!visible) {
      this.item.hide();
      return;
    }
    const clock = formatClock(remainingMs);
    if (state === "breaking") {
      this.item.text = `$(coffee) ${clock}`;
      this.item.tooltip = "Touch Grass — break time! Click for options.";
    } else if (state === "running") {
      this.item.text = `$(eye) ${clock}`;
      this.item.tooltip = `Touch Grass — next break in ${clock}. Click for options.`;
    } else {
      this.item.text = "$(debug-pause) Grass";
      this.item.tooltip = "Touch Grass — paused. Click to resume.";
    }
    this.item.show();
  }

  dispose() {
    this.item.dispose();
  }
}

module.exports = { StatusBar, formatClock };
