# Changelog

## 0.1.0

Initial release.

- Hourly (configurable) break reminders with a strict wall-clock timer.
- Dismissible pixel-art break view (maximizes the editor): a calm grassy
  meadow with drifting clouds, flowers, and butterflies, whose palette
  follows the local time of day (dawn / day / sunset / dusk / starry night
  with a crescent moon).
- Optionally alerts you when a break starts so it isn't missed while you're in
  another app — foregrounds VS Code on macOS, flashes the taskbar button on
  Windows/WSL, shows a notification on Linux (`focusWindowOnBreak`).
- Optional cross-window sync (`syncAcrossWindows`): share one break schedule
  across every open VS Code window, so a new window joins the current countdown
  instead of starting its own.
- Live countdown + progress bar during the break; **Skip** and **Postpone**
  always available (Esc also skips).
- Status-bar countdown to the next break; click for a quick menu
  (break now / postpone / reset / pause / settings).
- Commands: Take a Break Now, Postpone, Skip, Reset Interval Timer,
  Pause/Resume.
- Settings for interval, break duration, postpone length, auto-start,
  auto-end, status-bar visibility, and reduced motion.
