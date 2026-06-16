// @ts-check
"use strict";

const vscode = require("vscode");
const { getConfig, SECTION } = require("./config");
const { StatusBar } = require("./statusBar");
const { BreakPanel } = require("./breakPanel");
const { showMenu } = require("./menu");
const { focusWindow } = require("./focusWindow");

/**
 * @typedef {"running" | "breaking" | "paused"} State
 */

// When a break auto-ends, the webview shows a short "welcome back" farewell and
// then reports `done`. The controller only force-closes as a fallback this long
// after the timer hits zero, so that farewell is actually seen.
const BREAK_END_GRACE_MS = 4000;

/**
 * Owns all Touch Grass state: a tiny state machine driven by a 1 Hz ticker that
 * compares absolute timestamps against the wall clock.
 */
class TouchGrassController {
  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    this.context = context;
    this.cfg = getConfig();

    /** @type {State} */
    this.state = "paused";
    /** Epoch ms at which the next break should start (when running). @type {number | null} */
    this.nextBreakAt = null;
    /** Epoch ms at which the current break should end (when breaking). @type {number | null} */
    this.breakEndsAt = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.ticker = null;

    this.statusBar = new StatusBar();
    this.panel = new BreakPanel(context, {
      onSkip: () => this.skipBreak(),
      onPostpone: () => this.postpone(),
      onDone: () => this.endBreak("auto"),
      onUserClosed: () => this.handlePanelClosed(),
    });

    this.disposables = [
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) this.onConfigChanged();
      }),
    ];
  }

  // ---- lifecycle ---------------------------------------------------------

  init() {
    this.startTicker();
    if (!this.cfg.enabled || !this.cfg.startAutomatically) {
      this.state = "paused";
    } else {
      this.start();
    }
    this.render();
  }

  startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  tick() {
    const now = Date.now();
    if (this.state === "running" && this.nextBreakAt !== null && now >= this.nextBreakAt) {
      this.beginBreak();
    } else if (
      this.state === "breaking" &&
      this.cfg.autoEndBreak &&
      this.breakEndsAt !== null &&
      now >= this.breakEndsAt + BREAK_END_GRACE_MS
    ) {
      // Fallback only: normally the webview reports `done` first (see grace note).
      this.endBreak("auto");
    }
    this.render();
  }

  // ---- transitions -------------------------------------------------------

  /** Begin (or resume) the work countdown. */
  start() {
    this.state = "running";
    this.breakEndsAt = null;
    this.scheduleNext();
    this.render();
  }

  scheduleNext() {
    this.nextBreakAt = Date.now() + this.cfg.intervalMinutes * 60_000;
  }

  beginBreak() {
    if (this.state === "breaking") return;
    this.state = "breaking";
    this.breakEndsAt = Date.now() + this.cfg.breakDurationSeconds * 1000;
    this.nextBreakAt = null;
    this.panel.open(this.breakPayload());
    if (this.cfg.focusWindowOnBreak) focusWindow();
    this.render();
  }

  /** @param {"auto" | "skip"} _reason */
  endBreak(_reason) {
    if (this.state !== "breaking") return;
    this.panel.close();
    this.state = "running";
    this.breakEndsAt = null;
    this.scheduleNext();
    this.render();
  }

  // ---- user actions ------------------------------------------------------

  takeBreakNow() {
    if (this.state === "breaking") {
      this.panel.reveal();
      return;
    }
    // Taking a break implicitly resumes a paused timer.
    this.beginBreak();
  }

  skipBreak() {
    if (this.state === "breaking") {
      this.endBreak("skip");
    } else if (this.state === "running") {
      // Nothing is breaking; treat "skip" as "give me a fresh full interval".
      this.scheduleNext();
      this.render();
    }
  }

  postpone() {
    const ms = this.cfg.postponeMinutes * 60_000;
    if (this.state === "breaking") {
      this.panel.close();
      this.state = "running";
      this.breakEndsAt = null;
      this.nextBreakAt = Date.now() + ms;
    } else if (this.state === "running") {
      this.nextBreakAt = (this.nextBreakAt ?? Date.now()) + ms;
    } else {
      // paused: resume and schedule the first break after the postpone window
      this.state = "running";
      this.nextBreakAt = Date.now() + ms;
    }
    this.render();
  }

  resetTimer() {
    if (this.state === "breaking") {
      this.panel.close();
      this.breakEndsAt = null;
    }
    this.state = "running";
    this.scheduleNext();
    this.render();
  }

  togglePause() {
    if (this.state === "paused") {
      this.start();
    } else {
      this.pause();
    }
  }

  pause() {
    if (this.state === "breaking") {
      this.panel.close();
      this.breakEndsAt = null;
    }
    this.state = "paused";
    this.nextBreakAt = null;
    this.render();
  }

  /** The user closed the break tab by hand → treat as Skip. */
  handlePanelClosed() {
    if (this.state === "breaking") {
      this.state = "running";
      this.breakEndsAt = null;
      this.scheduleNext();
      this.render();
    }
  }

  openMenu() {
    return showMenu(this);
  }

  // ---- reactions ---------------------------------------------------------

  onConfigChanged() {
    const prev = this.cfg;
    this.cfg = getConfig();

    if (!this.cfg.enabled) {
      this.pause();
      this.render();
      return;
    }
    if (!prev.enabled && this.cfg.enabled) {
      // Re-enabled from the settings UI.
      if (this.cfg.startAutomatically) this.start();
      this.render();
      return;
    }
    // A new interval length takes effect from now.
    if (this.state === "running" && this.cfg.intervalMinutes !== prev.intervalMinutes) {
      this.scheduleNext();
    }
    // Live-update an in-progress break if relevant settings changed.
    if (this.state === "breaking") {
      this.panel.update(this.breakPayload());
    }
    this.render();
  }

  // ---- helpers -----------------------------------------------------------

  breakPayload() {
    return {
      breakEndsAt: this.breakEndsAt ?? Date.now() + this.cfg.breakDurationSeconds * 1000,
      durationSeconds: this.cfg.breakDurationSeconds,
      reducedMotion: this.cfg.reducedMotion,
      autoEndBreak: this.cfg.autoEndBreak,
      focusMode: this.cfg.maximizeOnBreak,
    };
  }

  /** Milliseconds remaining on whatever is currently counting down. */
  remainingMs() {
    const now = Date.now();
    if (this.state === "running" && this.nextBreakAt !== null) {
      return Math.max(0, this.nextBreakAt - now);
    }
    if (this.state === "breaking" && this.breakEndsAt !== null) {
      return Math.max(0, this.breakEndsAt - now);
    }
    return 0;
  }

  render() {
    this.statusBar.update(this.state, this.remainingMs(), this.cfg.showStatusBar);
  }

  dispose() {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.statusBar.dispose();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

module.exports = { TouchGrassController };
