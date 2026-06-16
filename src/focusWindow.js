// @ts-check
"use strict";

const vscode = require("vscode");
const { execFile } = require("child_process");
const fs = require("fs");

/**
 * Best-effort: pull the VS Code window to the foreground when a break starts, so
 * a break can't slip past while you're working in another app. VS Code exposes no
 * API for this, so we shell out per-OS. Always silent on failure — the break runs
 * regardless; the window just might not come forward (OSes resist focus-stealing,
 * notably Windows, where this can only flash the taskbar).
 */

const ignore = () => {}; // best-effort: swallow errors (e.g. helper not installed)

function isWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

// Activate the VS Code window via Windows scripting — used on native Windows and
// from WSL through powershell.exe interop (the window lives on the Windows side).
const PS_FOREGROUND =
  "$ErrorActionPreference='SilentlyContinue';" +
  "$p=Get-Process Code,'Code - Insiders'|Where-Object MainWindowHandle -ne 0|Select-Object -First 1;" +
  "if($p){(New-Object -ComObject WScript.Shell).AppActivate($p.Id)|Out-Null}";

function focusWindow() {
  try {
    if (process.platform === "darwin") {
      const app = vscode.env.appName || "Visual Studio Code";
      execFile("osascript", ["-e", `tell application "${app}" to activate`], ignore);
    } else if (process.platform === "win32" || isWsl()) {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_FOREGROUND], ignore);
    } else if (process.platform === "linux") {
      // X11 window managers only; a no-op if wmctrl isn't installed.
      execFile("wmctrl", ["-a", vscode.env.appName || "Visual Studio Code"], ignore);
    }
  } catch {
    // never let a focus attempt break a break
  }
}

module.exports = { focusWindow };
