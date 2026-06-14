// @ts-check
"use strict";

const vscode = require("vscode");

/**
 * @typedef {Object} BreakHandlers
 * @property {() => void} onSkip
 * @property {() => void} onPostpone
 * @property {() => void} onDone        Break countdown reached zero (auto-end).
 * @property {() => void} onUserClosed  User closed the tab by hand.
 */

function makeNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Manages the single break webview panel (the popup). */
class BreakPanel {
  /**
   * @param {vscode.ExtensionContext} context
   * @param {BreakHandlers} handlers
   */
  constructor(context, handlers) {
    this.context = context;
    this.handlers = handlers;
    /** @type {vscode.WebviewPanel | null} */
    this.panel = null;
    /** Set while we dispose the panel ourselves, so onDidDispose can tell apart user-close. */
    this.closingProgrammatically = false;
    /** Last payload, re-sent if the webview signals `ready` after creation. @type {any} */
    this.pending = null;
    /** True while we've maximized the editor / hidden the side bar for a break. */
    this.focusEngaged = false;
  }

  /**
   * Make the break feel like a takeover: maximize the editor group (VS Code hides
   * the panel + other splits and remembers them) and hide the side bar. The
   * side bar uses a symmetric toggle so the release is an exact round-trip.
   */
  async engageFocus() {
    if (this.focusEngaged) return;
    this.focusEngaged = true;
    try {
      await vscode.commands.executeCommand("workbench.action.toggleMaximizeEditorGroup");
      await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
    } catch {
      // Older VS Code without these commands — degrade to a plain tab.
    }
  }

  async releaseFocus() {
    if (!this.focusEngaged) return;
    this.focusEngaged = false;
    try {
      await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
      await vscode.commands.executeCommand("workbench.action.unmaximizeEditorGroup");
    } catch {
      // Best effort: nothing to restore if the commands are unavailable.
    }
  }

  /** @param {any} payload */
  open(payload) {
    this.pending = payload;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      this.post({ type: "start", ...payload });
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "touchGrass.break",
      "🌱 Time to Touch Grass",
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );

    this.panel.webview.html = this.buildHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));

    this.panel.onDidDispose(() => {
      const wasProgrammatic = this.closingProgrammatically;
      this.closingProgrammatically = false;
      this.panel = null;
      // Restore the layout however the break ended (auto, skip, or manual close).
      void this.releaseFocus();
      if (!wasProgrammatic) this.handlers.onUserClosed();
    });

    if (payload && payload.focusMode) void this.engageFocus();
  }

  /** Push fresh settings to an already-open break (e.g. reduced-motion changes). */
  update(payload) {
    this.pending = payload;
    this.post({ type: "update", ...payload });
  }

  reveal() {
    this.panel?.reveal(vscode.ViewColumn.Active, false);
  }

  /** @param {any} msg */
  onMessage(msg) {
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "ready":
        if (this.pending) this.post({ type: "start", ...this.pending });
        break;
      case "skip":
        this.handlers.onSkip();
        break;
      case "postpone":
        this.handlers.onPostpone();
        break;
      case "done":
        this.handlers.onDone();
        break;
    }
  }

  /** @param {any} msg */
  post(msg) {
    this.panel?.webview.postMessage(msg);
  }

  close() {
    if (this.panel) {
      this.closingProgrammatically = true;
      this.panel.dispose();
      this.panel = null;
    }
  }

  dispose() {
    this.close();
  }

  /** @param {vscode.Webview} webview */
  buildHtml(webview) {
    const nonce = makeNonce();
    const asUri = (file) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", file));

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${asUri("break.css")}" rel="stylesheet" />
  <title>Time to Touch Grass</title>
</head>
<body>
  <canvas id="scene" aria-hidden="true"></canvas>

  <div id="ui">
    <div class="card">
      <div class="prompt">Time to touch grass</div>
      <div class="subprompt"></div>
      <div id="countdown" class="countdown" role="timer" aria-live="polite">5:00</div>
      <div class="progress"><div id="progressFill" class="progress-fill"></div></div>
      <div class="buttons">
        <button id="postpone" class="btn">Postpone</button>
        <button id="skip" class="btn btn-primary">Skip break</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${asUri("sprites.js")}"></script>
  <script nonce="${nonce}" src="${asUri("break.js")}"></script>
</body>
</html>`;
  }
}

module.exports = { BreakPanel };
