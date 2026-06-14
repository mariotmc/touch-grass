// @ts-check
"use strict";

const vscode = require("vscode");
const { formatClock } = require("./statusBar");

/**
 * Quick-pick shown when the status bar is clicked (or via the Open Menu command).
 * Items are state-dependent so the menu only offers actions that make sense.
 * @param {import("./controller").TouchGrassController} ctrl
 */
async function showMenu(ctrl) {
  /** @type {(vscode.QuickPickItem & { run: () => void })[]} */
  const items = [];

  if (ctrl.state === "breaking") {
    items.push({
      label: "$(debug-step-over) Skip this break",
      detail: "End the break now and start the next interval.",
      run: () => ctrl.skipBreak(),
    });
    items.push({
      label: "$(clock) Postpone break",
      detail: `Snooze for ${ctrl.cfg.postponeMinutes} min.`,
      run: () => ctrl.postpone(),
    });
  } else {
    items.push({
      label: "$(coffee) Take a break now",
      detail: "Open the meadow and start a break immediately.",
      run: () => ctrl.takeBreakNow(),
    });
    if (ctrl.state === "running") {
      items.push({
        label: "$(clock) Postpone next break",
        detail: `Push the next break back by ${ctrl.cfg.postponeMinutes} min.`,
        run: () => ctrl.postpone(),
      });
      items.push({
        label: "$(history) Reset interval timer",
        detail: `Restart the countdown at the full ${ctrl.cfg.intervalMinutes} min.`,
        run: () => ctrl.resetTimer(),
      });
    }
  }

  if (ctrl.state === "paused") {
    items.push({
      label: "$(play) Resume reminders",
      detail: "Start counting down to the next break.",
      run: () => ctrl.togglePause(),
    });
  } else {
    items.push({
      label: "$(debug-pause) Pause reminders",
      detail: "Stop reminders until you resume.",
      run: () => ctrl.togglePause(),
    });
  }

  items.push({
    label: "$(gear) Open Touch Grass settings",
    run: () => vscode.commands.executeCommand("workbench.action.openSettings", "touchGrass"),
  });

  const title =
    ctrl.state === "breaking"
      ? `Touch Grass — break ends in ${formatClock(ctrl.remainingMs())}`
      : ctrl.state === "running"
        ? `Touch Grass — next break in ${formatClock(ctrl.remainingMs())}`
        : "Touch Grass — paused";

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: "What would you like to do?",
  });
  pick?.run();
}

module.exports = { showMenu };
