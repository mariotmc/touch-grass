// @ts-check
"use strict";

const vscode = require("vscode");
const { execFile } = require("child_process");
const fs = require("fs");

/**
 * Best-effort "you have a break" alert when one starts, so it can't slip past
 * while you're working in another app. VS Code has no API for cross-app
 * attention, so we shell out per-OS:
 *   - macOS: bring the window to the front (`osascript … activate`) — reliable.
 *   - Windows / WSL: try to foreground, then pop a tray notification. Windows
 *     blocks focus-stealing, so the notification is the part you actually see.
 *   - Linux: try `wmctrl` to foreground, plus `notify-send`.
 * Always silent on failure — the break runs regardless.
 */

const ignore = () => {}; // best-effort: swallow errors (helper missing, etc.)
const opts = { windowsHide: true };

const TITLE = "Time to touch grass";
const BODY = "Break time - look away from the screen and rest your eyes.";

function isWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

// Windows PowerShell (`powershell.exe` = 5.1; reached from WSL via interop): a
// best-effort foreground, then a tray-balloon notification (shown as a toast on
// Win10/11). A WinForms balloon needs no registered AppID, unlike a WinRT toast.
const PS_ALERT = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$p=Get-Process Code,'Code - Insiders'|?{$_.MainWindowHandle -ne 0}|Select -First 1;",
  "if($p){(New-Object -ComObject WScript.Shell).AppActivate($p.Id)|Out-Null};",
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
  "$n=New-Object System.Windows.Forms.NotifyIcon;",
  "$n.Icon=[System.Drawing.SystemIcons]::Information;$n.Visible=$true;",
  `$n.ShowBalloonTip(8000,'${TITLE}','${BODY}',[System.Windows.Forms.ToolTipIcon]::Info);`,
  "Start-Sleep -Milliseconds 8000;$n.Dispose()",
].join("");

function focusWindow() {
  try {
    if (process.platform === "darwin") {
      const app = vscode.env.appName || "Visual Studio Code";
      execFile("osascript", ["-e", `tell application "${app}" to activate`], opts, ignore);
    } else if (process.platform === "win32" || isWsl()) {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", PS_ALERT],
        opts,
        ignore
      );
    } else if (process.platform === "linux") {
      // X11 window managers only; a no-op if the helper isn't installed.
      execFile("wmctrl", ["-a", vscode.env.appName || "Visual Studio Code"], opts, ignore);
      execFile("notify-send", [TITLE, BODY], opts, ignore);
    }
  } catch {
    // never let an alert attempt break a break
  }
}

module.exports = { focusWindow };
