// @ts-check
"use strict";

const vscode = require("vscode");
const { getConfig, SECTION } = require("./config");
const { StatusBar } = require("./statusBar");
const { BreakPanel } = require("./breakPanel");
const { showMenu } = require("./menu");
const { focusWindow } = require("./focusWindow");
const { readSchedule, writeSchedule } = require("./sync");

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
    // Cross-window sync: one shared schedule file under the extension's global
    // storage (shared by every VS Code window). `lastSync` dedupes our writes.
    this.syncPath = vscode.Uri.joinPath(context.globalStorageUri, "schedule.json").fsPath;
    this.lastSync = "";

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
      // Join the shared state if other windows have one (running, breaking, or
      // paused); otherwise start a fresh schedule.
      const shared = this.cfg.syncAcrossWindows ? readSchedule(this.syncPath) : null;
      if (!(shared && this.applyShared(shared))) {
        this.start();
      }
    }
    this.render();
  }

  startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  tick() {
    this.pullSync();
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

  /** Begin (or resume) the work countdown — joining a shared schedule if one
   *  already exists, so a newly opened window adopts the current countdown. */
  start() {
    this.state = "running";
    this.breakEndsAt = null;
    // Resuming means run: adopt an active shared schedule, but not a paused one.
    const shared = this.cfg.syncAcrossWindows && this.cfg.enabled ? readSchedule(this.syncPath) : null;
    if (!(shared && !shared.paused && this.applyShared(shared))) {
      this.scheduleNext();
    }
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
      // An explicit pause is the one paused state we broadcast — a window that's
      // merely disabled or not-auto-started stays quiet so it can't pause others.
      if (this.cfg.syncAcrossWindows && this.cfg.enabled) {
        this.lastSync = this.snapshotKey();
        writeSchedule(this.syncPath, { nextBreakAt: null, breakEndsAt: null, paused: true });
      }
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

  // ---- cross-window sync -------------------------------------------------

  /** A compact fingerprint of the current schedule, to dedupe writes/adopts. */
  snapshotKey() {
    return `${this.state}:${this.nextBreakAt}:${this.breakEndsAt}`;
  }

  /**
   * Adopt a shared schedule into local state, opening/closing the break panel to
   * match. Deterministic `breakEndsAt` means all windows converge on the same
   * break. Returns false if `s` carried nothing worth adopting.
   * @param {any} s @returns {boolean}
   */
  applyShared(s) {
    if (s && s.paused === true) {
      if (this.state !== "paused") {
        if (this.state === "breaking") this.panel.close();
        this.state = "paused";
        this.nextBreakAt = null;
        this.breakEndsAt = null;
      }
      this.lastSync = this.snapshotKey();
      return true;
    }
    const nb = s && typeof s.nextBreakAt === "number" ? s.nextBreakAt : null;
    const be = s && typeof s.breakEndsAt === "number" ? s.breakEndsAt : null;
    if (be !== null && be > Date.now() - BREAK_END_GRACE_MS) {
      if (this.state === "breaking" && this.breakEndsAt === be) return true;
      const wasBreaking = this.state === "breaking";
      this.state = "breaking";
      this.breakEndsAt = be;
      this.nextBreakAt = null;
      this.lastSync = this.snapshotKey();
      if (wasBreaking) this.panel.update(this.breakPayload());
      else this.panel.open(this.breakPayload());
      return true;
    }
    // Only adopt a future break time. A nextBreakAt already in the past is a
    // stale schedule from a closed session — adopting it would fire a break the
    // instant a window opens after a restart (a window still fires its own
    // genuinely-due break via the tick, so nothing is lost).
    if (nb !== null && nb > Date.now()) {
      if (this.state === "running" && this.nextBreakAt === nb) return true;
      if (this.state === "breaking") this.panel.close();
      this.state = "running";
      this.nextBreakAt = nb;
      this.breakEndsAt = null;
      this.lastSync = this.snapshotKey();
      return true;
    }
    return false;
  }

  /** Pull the shared schedule each tick (skipped while disabled or sync off). */
  pullSync() {
    if (!this.cfg.syncAcrossWindows || !this.cfg.enabled) return;
    const s = readSchedule(this.syncPath);
    if (s) this.applyShared(s);
  }

  /** Publish our active schedule so other windows adopt it. The paused state is
   *  broadcast separately (see togglePause). No-op when unchanged, paused,
   *  disabled, or sync off. */
  publishSync() {
    if (!this.cfg.syncAcrossWindows || !this.cfg.enabled) return;
    if (this.state !== "running" && this.state !== "breaking") return;
    const key = this.snapshotKey();
    if (key === this.lastSync) return;
    this.lastSync = key;
    writeSchedule(this.syncPath, { nextBreakAt: this.nextBreakAt, breakEndsAt: this.breakEndsAt });
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
    this.publishSync();
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
