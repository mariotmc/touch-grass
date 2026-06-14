// Touch Grass — break scene animation (runs inside the webview).
// Draws a procedural meadow whose palette follows the local time of day
// (dawn/day/sunset/dusk/night) while counting the break down; plant sprites
// come from window.TG_SPRITES. Talks to the extension via the webview bridge.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const S = window.TG_SPRITES || { common: {}, plants: {} };

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const cdEl = document.getElementById("countdown");
  const progEl = document.getElementById("progressFill");
  const promptEl = document.querySelector(".prompt");
  const subEl = document.querySelector(".subprompt");

  /** Live break config, replaced by the extension's `start` / `update` messages. */
  let cfg = {
    breakEndsAt: Date.now() + 300000,
    durationSeconds: 300,
    reducedMotion: false,
    autoEndBreak: true,
  };

  let W = 0;
  let H = 0;
  let groundY = 0;
  let pxScale = 5; // scale for procedural plants

  let plants = [];
  let clouds = [];
  let butterflies = [];
  const cache = {};

  let lastT = 0;
  let ended = false;
  let doneSent = false;

  // ---- helpers -----------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---- offscreen sprite cache -------------------------------------------
  function rasterize(frame, palette) {
    const h = frame.length;
    const w = frame[0].length;
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const c = off.getContext("2d");
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const col = palette[frame[y][x]];
        if (col) {
          c.fillStyle = col;
          c.fillRect(x, y, 1, 1);
        }
      }
    }
    return off;
  }

  function plantFrame(name) {
    const key = `plant:${name}`;
    if (cache[key]) return cache[key];
    cache[key] = rasterize(S.plants[name], S.common);
    return cache[key];
  }

  function drawSprite(img, cx, baseY, scale) {
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, Math.round(cx - dw / 2), Math.round(baseY - dh), dw, dh);
  }

  // ---- layout / spawning -------------------------------------------------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    groundY = Math.floor(H * 0.6);
    pxScale = clamp(Math.round(H / 200), 2, 7);
    layoutScene();
  }

  function layoutScene() {
    // Decorations scattered along the grass band (regenerated on resize).
    plants = [];
    const plantNames = Object.keys(S.plants || {});
    if (plantNames.length) {
      const count = Math.round(W / 90);
      for (let i = 0; i < count; i++) {
        const baseY = rand(groundY + 12, H - 8);
        plants.push({
          name: pick(plantNames),
          x: rand(0, W),
          baseY,
          scale: pxScale * (0.7 + 0.6 * depthAt(baseY)),
        });
      }
      plants.sort((a, b) => a.baseY - b.baseY);
    }

    // Clouds.
    clouds = [];
    const nClouds = cfg.reducedMotion ? 2 : 4;
    for (let i = 0; i < nClouds; i++) {
      clouds.push({
        x: rand(0, W),
        y: rand(H * 0.05, H * 0.32),
        s: rand(0.7, 1.5),
        speed: rand(4, 11) * (cfg.reducedMotion ? 0.3 : 1),
      });
    }

    // Butterflies.
    butterflies = [];
    const nBf = cfg.reducedMotion ? 0 : randInt(1, 2);
    for (let i = 0; i < nBf; i++) {
      butterflies.push({
        x: rand(0, W),
        y: rand(groundY - 60, groundY + 30),
        phase: rand(0, Math.PI * 2),
        color: pick(["#ff9ec2", "#ffd23f", "#9b6bff", "#ff6b8a"]),
        flap: 0,
      });
    }
  }

  function depthAt(baseY) {
    const span = Math.max(1, H - groundY);
    return clamp((baseY - groundY) / span, 0, 1);
  }

  // ---- scene drawing: time-of-day palettes (classic 16-bit RPG vibe) ------
  // Five bands keyed to the local hour, each a full scene palette:
  // sky [top, mid, low] · cloud tint · sun/moon + glow · horizon water band ·
  // grass fringe · field [top, bottom]. The moon is a crescent; night adds stars.
  const THEMES = {
    dawn: {
      sky: ["#5878c8", "#a98fcb", "#f6cfa4"], cloud: "rgba(244,176,200,0.9)",
      sun: "#fff3cf", glow: "rgba(255,236,180,0.28)", sunX: 0.74, sunY: 0.28, moon: false, stars: false,
      water: "#7868a8", fringe: "#c2c553", field: ["#58a048", "#3c7838"],
    },
    day: {
      sky: ["#56c8f0", "#8ce0f8", "#cdf2fb"], cloud: "rgba(255,255,255,0.92)",
      sun: "#fffef2", glow: "rgba(255,255,235,0.35)", sunX: 0.74, sunY: 0.28, moon: false, stars: false,
      water: "#4a90d9", fringe: "#b8e858", field: ["#6cc04a", "#4e9c3c"],
    },
    sunset: {
      sky: ["#2848a0", "#c050a0", "#f08048"], cloud: "rgba(240,120,160,0.9)",
      sun: "#ffd080", glow: "rgba(255,140,120,0.4)", sunX: 0.74, sunY: 0.28, moon: false, stars: false,
      water: "#585090", fringe: "#b0a040", field: ["#3c7838", "#2a5830"],
    },
    dusk: {
      sky: ["#383878", "#9858a0", "#d86858"], cloud: "rgba(224,104,128,0.85)",
      sun: "#f6ecd9", sunX: 0.74, sunY: 0.28, moon: true, stars: false,
      water: "#403868", fringe: "#807038", field: ["#28522a", "#1b3a1e"],
    },
    night: {
      sky: ["#101828", "#242a48", "#3a3258"], cloud: "rgba(58,50,76,0.7)",
      sun: "#f4f6ff", sunX: 0.74, sunY: 0.28, moon: true, stars: true,
      water: "#202850", fringe: "#4a4830", field: ["#0e2012", "#08140b"],
    },
  };

  function timeTheme() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h >= 5 && h < 8) return THEMES.dawn;
    if (h >= 8 && h < 17) return THEMES.day;
    if (h >= 17 && h < 19) return THEMES.sunset;
    if (h >= 19 && h < 21) return THEMES.dusk;
    return THEMES.night;
  }

  function drawSky(theme) {
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, theme.sky[0]);
    sky.addColorStop(0.55, theme.sky[1]);
    sky.addColorStop(1, theme.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, groundY);

    if (theme.stars) {
      ctx.fillStyle = "rgba(190,222,230,0.9)";
      for (let i = 0; i < 45; i++) {
        ctx.fillRect((i * 97.13) % W, (i * 53.7) % (groundY * 0.65), 2, 2);
      }
    }

    const sx = W * theme.sunX;
    const sy = groundY * theme.sunY;
    const r = Math.max(20, H * 0.045);
    if (!theme.moon) {
      // soft sun bloom, fading to nothing (no hard-edged ring)
      const halo = ctx.createRadialGradient(sx, sy, r * 0.5, sx, sy, r * 2.2);
      halo.addColorStop(0, theme.glow);
      halo.addColorStop(1, theme.glow.replace(/[\d.]+\)$/, "0)"));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = theme.sun;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    if (theme.moon) {
      // crescent: refill the bite with the SAME gradient the sky was painted
      // with — gradients live in canvas coordinates, so the patch is
      // pixel-identical to the background. Deliberately NOT clipped to the
      // disc: the unclipped fill also covers the disc's anti-aliased edge
      // fringe (otherwise a faint 1px arc of the ball's outline survives
      // inside the bite), and beyond the disc it paints sky-on-sky.
      ctx.fillStyle = sky;
      ctx.beginPath();
      ctx.arc(sx - r * 0.5, sy - r * 0.18, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCloud(x, y, s, tint) {
    ctx.fillStyle = tint;
    const b = 16 * s;
    const blobs = [
      [0, 0, b],
      [b * 1.1, b * 0.2, b * 0.8],
      [-b * 1.1, b * 0.25, b * 0.7],
      [b * 0.4, -b * 0.5, b * 0.75],
    ];
    for (const [dx, dy, rr] of blobs) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGround(theme) {
    // thin water band on the horizon, then the bright grass fringe, then the field
    const wb = Math.max(6, Math.round(H * 0.03));
    const fr = Math.max(3, Math.round(H * 0.012));
    ctx.fillStyle = theme.water;
    ctx.fillRect(0, groundY - wb, W, wb);
    ctx.fillStyle = theme.fringe;
    ctx.fillRect(0, groundY, W, fr);
    const g = ctx.createLinearGradient(0, groundY + fr, 0, H);
    g.addColorStop(0, theme.field[0]);
    g.addColorStop(1, theme.field[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, groundY + fr, W, H - groundY - fr);
  }

  function drawButterfly(bf) {
    const wing = Math.abs(Math.sin(bf.flap)) * 5 + 2;
    ctx.fillStyle = bf.color;
    ctx.beginPath();
    ctx.ellipse(bf.x - wing, bf.y, wing, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(bf.x + wing, bf.y, wing, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#33303a";
    ctx.fillRect(bf.x - 1, bf.y - 3, 2, 7);
  }

  function draw(dt) {
    const theme = timeTheme();
    ctx.clearRect(0, 0, W, H);
    drawSky(theme);

    for (const c of clouds) {
      c.x += c.speed * dt;
      if (c.x - 60 > W) c.x = -60;
      drawCloud(c.x, c.y, c.s, theme.cloud);
    }

    drawGround(theme);

    // Plants in painter's order: lower on screen (larger baseY) is nearer
    // and overdraws what's behind it (pre-sorted in layoutScene). They dim
    // at night so the flowers don't glow against the dark field.
    if (theme.stars) ctx.globalAlpha = 0.45;
    for (const p of plants) {
      drawSprite(plantFrame(p.name), p.x, p.baseY, p.scale);
    }
    ctx.globalAlpha = 1;

    if (!theme.stars) {
      // butterflies sleep at night
      for (const bf of butterflies) {
        bf.flap += dt * 18;
        bf.phase += dt;
        bf.x += Math.cos(bf.phase * 0.8) * 22 * dt;
        bf.y += Math.sin(bf.phase * 1.7) * 14 * dt;
        bf.x = clamp(bf.x, 10, W - 10);
        bf.y = clamp(bf.y, groundY - 90, groundY + 40);
        drawButterfly(bf);
      }
    }
  }

  // ---- countdown ---------------------------------------------------------
  function fmt(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function updateCountdown(now) {
    const remMs = Math.max(0, cfg.breakEndsAt - now);
    cdEl.textContent = fmt(Math.ceil(remMs / 1000));
    const frac = cfg.durationSeconds > 0 ? remMs / (cfg.durationSeconds * 1000) : 0;
    progEl.style.width = clamp(frac, 0, 1) * 100 + "%";
    if (remMs <= 0 && !ended) {
      ended = true;
      onBreakEnd();
    }
  }

  function onBreakEnd() {
    promptEl.textContent = "Welcome back 🌿";
    cdEl.textContent = "0:00";
    subEl.style.display = "";
    if (cfg.autoEndBreak) {
      subEl.textContent = "Hope your eyes feel a little better.";
      setTimeout(() => {
        if (!doneSent) {
          doneSent = true;
          vscode.postMessage({ type: "done" });
        }
      }, 2200);
    } else {
      subEl.textContent = "Take your time — click Skip when you are ready.";
    }
  }

  // ---- main loop ---------------------------------------------------------
  function loop(t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    draw(dt);
    updateCountdown(Date.now());
    requestAnimationFrame(loop);
  }

  // ---- messaging ---------------------------------------------------------
  function applyConfig(m) {
    const prevMotion = cfg.reducedMotion;
    cfg.breakEndsAt = typeof m.breakEndsAt === "number" ? m.breakEndsAt : cfg.breakEndsAt;
    cfg.durationSeconds = m.durationSeconds || cfg.durationSeconds;
    cfg.reducedMotion = !!m.reducedMotion;
    cfg.autoEndBreak = m.autoEndBreak !== false;
    ended = false;
    doneSent = false;
    promptEl.textContent = "Time to touch grass";
    subEl.textContent = "";
    subEl.style.display = "none";
    // A live `update` (settings changed mid-break) only rebuilds the scene
    // when its look actually changed.
    if (m.type === "start" || cfg.reducedMotion !== prevMotion) layoutScene();
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m && (m.type === "start" || m.type === "update")) applyConfig(m);
  });

  document.getElementById("skip").addEventListener("click", () => vscode.postMessage({ type: "skip" }));
  document.getElementById("postpone").addEventListener("click", () => vscode.postMessage({ type: "postpone" }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") vscode.postMessage({ type: "skip" });
  });

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(loop);

  vscode.postMessage({ type: "ready" });
})();
