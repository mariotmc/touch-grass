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
 *   - Windows / WSL: try to foreground, then flash the taskbar button
 *     (`FlashWindowEx`, the OS-blessed "needs attention" blink) until VS Code is
 *     focused — Windows blocks outright focus-stealing.
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

// Foreground attempt, then flash the VS Code taskbar button until it's focused
// (FLASHW_ALL | FLASHW_TIMERNOFG = 0xF). powershell.exe is Windows PowerShell
// 5.1, reached from WSL via interop (the window lives on the Windows side).
// Passed as base64 (-EncodedCommand) so the embedded C# survives intact.
const PS_FLASH = `
$ErrorActionPreference='SilentlyContinue'
$p = Get-Process Code,'Code - Insiders' | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
if ($p) {
  (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TGFlash { [StructLayout(LayoutKind.Sequential)] public struct FW { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; } [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FW pwfi); public static void Go(IntPtr h) { FW f = new FW(); f.cbSize = (uint)Marshal.SizeOf(f); f.hwnd = h; f.dwFlags = 0xF; f.uCount = uint.MaxValue; f.dwTimeout = 0; FlashWindowEx(ref f); } }'
  [TGFlash]::Go($p.MainWindowHandle)
}`;
const PS_FLASH_B64 = Buffer.from(PS_FLASH, "utf16le").toString("base64");

function focusWindow() {
  try {
    if (process.platform === "darwin") {
      const app = vscode.env.appName || "Visual Studio Code";
      execFile("osascript", ["-e", `tell application "${app}" to activate`], opts, ignore);
    } else if (process.platform === "win32" || isWsl()) {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", PS_FLASH_B64],
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
