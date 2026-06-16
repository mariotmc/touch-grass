# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Touch Grass is a personal VS Code extension: an hourly break reminder that opens a
full pixel-art meadow with a live countdown, so you look away and rest your eyes.
`README.md` has the user-facing feature list. (Animated pets were
tried and deliberately removed — don't reintroduce them without being asked.)

## Environment constraints (read first)

- **Zero dependencies, plain CommonJS, no build step — by design.** `package.json`
  declares no `dependencies`/`devDependencies`; `main` points straight at
  `src/extension.js`, which VS Code's bundled runtime executes as-is. Do **not**
  add npm packages, TypeScript, or a bundler without explicit instruction. The
  only `require()`s are `require('vscode')` (ambient, provided by the host), Node
  built-ins (`child_process`, `fs`) in `focusWindow.js`, and relative files.
- **Node/npm are unavailable on this machine** (nvm is broken, network is
  blocked). You cannot `npm install`, run `node`, or package a `.vsix` here.
  Syntax-check with the command below, then have the user run it via F5.

## Commands

**Syntax-check all JS without Node** (macOS JavaScriptCore; `checkSyntax` takes a
*file path* and parses without executing, so the missing `vscode`/`document`
globals don't matter):

```bash
JSC="/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
"$JSC" -e 'var R="'"$PWD"'", fs=["src/extension.js","src/controller.js","src/config.js","src/statusBar.js","src/menu.js","src/breakPanel.js","src/focusWindow.js","media/break.js","media/sprites.js"];
for (var i=0;i<fs.length;i++){try{checkSyntax(R+"/"+fs[i]);print("OK   "+fs[i])}catch(e){print("ERR  "+fs[i]+": "+e)}}'
```

**Verify a webview change:** there is no headless harness — the syntax check
above catches parse errors, then ask the user to press **F5** (or **Cmd+R** in
the Extension Development Host) and confirm the scene visually.

**Run the extension:** open the folder in VS Code and press **F5**. This needs the
built-in **JavaScript Debugger** (`ms-vscode.js-debug`) enabled — it registers the
`extensionHost` debug type; if it's disabled you get "Configured debug type
'extensionHost' is not supported" (Extensions view → `@disabled` → enable it).
After editing, press **Cmd+R** in the `[Extension Development Host]` window to
reload — no relaunch needed.

**Package a `.vsix`** (requires Node, unavailable here): `npx @vscode/vsce package`.

## Architecture

Two sides talking over the VS Code webview message bridge.

**Extension host — `src/` (CommonJS, has the `vscode` API):**

- `controller.js` — `TouchGrassController`, the single source of truth. A 1 Hz
  `setInterval` ticker compares **absolute timestamps** (`nextBreakAt`,
  `breakEndsAt`) against `Date.now()`. This is the "strict wall-clock" model: it
  survives sleep and fires an overdue break on wake. States: `running | breaking |
  paused`. Owns the status bar and the break panel; all user actions
  (take/skip/postpone/reset/pause) are methods here.
- `config.js` — `getConfig()` reads and clamps every `touchGrass.*` setting into a
  plain object so a bad user value can't break the timer.
- `statusBar.js` — the countdown status-bar item (also exports `formatClock`).
- `menu.js` — the status-bar quick-pick (`showMenu`).
- `breakPanel.js` — owns the single webview panel: builds the CSP'd HTML, runs the
  message protocol, and implements **focus mode** (maximize editor + hide sidebar).
- `focusWindow.js` — best-effort: shells out per-OS (osascript / PowerShell /
  wmctrl) to bring the VS Code window to the foreground when a break starts (no
  VS Code API for it); silent on failure. Distinct from "focus mode" above.
- `extension.js` — `activate()`: registers the `touchGrass.*` commands and wires
  them to the controller.

**Webview — `media/` (browser globals, no bundler, no network):**

- `break.js` — the canvas renderer: draws the procedural scene in one of five
  time-of-day palettes keyed to the local hour (`THEMES`/`timeTheme`: dawn 5-8,
  day 8-17, sunset 17-19, dusk 19-21, night otherwise — a classic 16-bit RPG
  flat horizon with a water band, grass fringe, sun or crescent moon, stars at
  night) plus the countdown UI.
- `break.css` — break-screen layout and overlay card.
- `sprites.js` — pixel data on `window.TG_SPRITES`: the plant char-grids +
  palette (sky/grass colours are hardcoded in `break.js`).

**Message protocol:** ext→webview `start` / `update` (payload: `breakEndsAt`,
`durationSeconds`, `reducedMotion`, `autoEndBreak`, `focusMode`); webview→ext
`ready` (asks for the payload), `skip`, `postpone`, `done` (countdown reached
zero).

## Invariants to preserve

- **Webview drawing rules.** Plants draw in painter's order sorted by `baseY`
  (lower on screen overdraws what's behind).
- **Auto-end timing.** At zero the webview shows a ~2.2s "Welcome back" farewell
  then posts `done`; the controller force-closes only as a fallback at
  `breakEndsAt + BREAK_END_GRACE_MS` (4 s). Don't make the controller close
  exactly at zero or the farewell is pre-empted.
- **Close detection.** `BreakPanel.closingProgrammatically` distinguishes our own
  `close()` from the user closing the tab; a user close routes through
  `onUserClosed` and is treated as Skip. Focus mode is released from
  `onDidDispose`, so the layout is restored on every close path (auto/skip/manual).
- **Focus-mode reversibility.** The sidebar uses a *symmetric* toggle
  (`toggleSidebarVisibility` on both engage and release) so the layout round-trips
  exactly regardless of its prior state; the editor uses `toggleMaximizeEditorGroup`
  to engage and the deterministic `unmaximizeEditorGroup` to release. These editor
  commands require VS Code ≥ 1.85 (hence `engines.vscode`).
