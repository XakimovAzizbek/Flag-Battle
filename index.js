/* =========================================================
   BAYROQLAR JANGI — Flag Battle Royale (cheksiz)
   ========================================================= */

(function () {
  "use strict";

  // ---------- DOM ----------
  const canvas = document.getElementById("arena");
  const ctx = canvas.getContext("2d");
  const statusText = document.getElementById("statusText");
  const aliveCountEl = document.getElementById("aliveCount");
  const nextRoundTimerEl = document.getElementById("nextRoundTimer");
  const winnerDisplay = document.getElementById("winnerDisplay");
  const winnerFlagEl = document.getElementById("winnerFlag");
  const winnerNameEl = document.getElementById("winnerName");
  const roundDisplay = document.getElementById("roundDisplay");
  const leaderboardBody = document.getElementById("leaderboardBody");

  // ---------- CONFIG ----------
  const CONFIG = {
    ballRadius: 9,
    gapAngleWidth: 0.34,
    ringRotationSpeed: 0.009,
    ringThickness: 10,
    restitution: 0.98,
    speedMin: 1.5,
    speedMax: 2.5,
    speedHardCap: 4.2,
    respawnDelay: 5000,          // 5 soniya kutish
    maxFlags: 180
    // maxRounds olib tashlandi → cheksiz
  };

  let ARENA_RADIUS = 0;
  let CENTER = { x: 0, y: 0 };
  let gapAngle = -Math.PI / 2;

  let flagsPool = [];
  let balls = [];
  let eliminatedOrder = [];
  let roundActive = false;
  let countdownHandle = null;
  let animHandle = null;

  // Round & leaderboard
  let roundCount = 0;
  let winners = [];

  // ---------- SOUND (Web Audio) ----------
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  function playTone(freq, duration, type = 'sine', volume = 0.3) {
    try {
      initAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }

  function playSound(type) {
    initAudio();
    switch (type) {
      case 'start':
        playTone(523, 0.15, 'square', 0.2);
        setTimeout(() => playTone(659, 0.15, 'square', 0.2), 150);
        break;
      case 'win':
        playTone(880, 0.1, 'sine', 0.25);
        setTimeout(() => playTone(1100, 0.1, 'sine', 0.25), 120);
        setTimeout(() => playTone(1320, 0.2, 'sine', 0.3), 240);
        break;
      case 'lose':
        playTone(300, 0.3, 'sawtooth', 0.15);
        setTimeout(() => playTone(200, 0.4, 'sawtooth', 0.15), 250);
        break;
      case 'collision':
        playTone(600, 0.05, 'square', 0.1);
        break;
      case 'next_round':
        playTone(440, 0.1, 'sine', 0.15);
        setTimeout(() => playTone(554, 0.1, 'sine', 0.15), 150);
        setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 300);
        break;
      default: break;
    }
  }

  // ---------- UTIL ----------
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function pickSpeed() {
    const s = rand(CONFIG.speedMin, CONFIG.speedMax);
    const a = rand(0, Math.PI * 2);
    return { vx: Math.cos(a) * s, vy: Math.sin(a) * s };
  }

  // ---------- LOAD bayroq.txt ----------
  async function loadFlags() {
    try {
      const res = await fetch("bayroq.txt", { cache: "no-store" });
      if (!res.ok) throw new Error("bayroq.txt topilmadi");
      const raw = await res.text();
      return parseFlags(raw);
    } catch (err) {
      console.error(err);
      statusText.textContent = "bayroq.txt o'qilmadi — namuna ro'yxat ishlatilmoqda.";
      return fallbackFlags();
    }
  }

  function parseFlags(raw) {
    const lines = raw.split(/\r?\n/);
    const out = [];
    let cur = {};
    for (const lineRaw of lines) {
      const line = lineRaw.trim();
      if (!line) {
        if (cur.emoji && cur.nomi) out.push(cur);
        cur = {};
        continue;
      }
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const val = line.slice(idx + 1).trim();
      if (key === "bayroq") cur.emoji = val;
      else if (key === "nomi") cur.nomi = val;
    }
    if (cur.emoji && cur.nomi) out.push(cur);
    return out.length ? out : fallbackFlags();
  }

  function fallbackFlags() {
    return [
      { emoji: "🇺🇿", nomi: "Uzbekistan" },
      { emoji: "🇹🇷", nomi: "Turkiya" },
      { emoji: "🇷🇺", nomi: "Russia" },
      { emoji: "🇺🇸", nomi: "USA" },
      { emoji: "🇬🇧", nomi: "England" },
      { emoji: "🇰🇷", nomi: "Korea" },
      { emoji: "🇯🇵", nomi: "Japan" },
      { emoji: "🇧🇷", nomi: "Brazil" }
    ];
  }

  // ---------- CANVAS SIZE ----------
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    const size = Math.min(wrap.clientWidth, wrap.clientHeight) * 0.97;
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ARENA_RADIUS = size / 2 - CONFIG.ringThickness - CONFIG.ballRadius - 2;
    CENTER = { x: size / 2, y: size / 2 };
  }

  // ---------- BALL FACTORY ----------
  function makeBalls(flags) {
    const list = flags.slice(0, CONFIG.maxFlags);
    const n = list.length;
    const placeR = ARENA_RADIUS * 0.55;

    return list.map((f, i) => {
      const a = (i / n) * Math.PI * 2;
      const { vx, vy } = pickSpeed();
      return {
        id: i,
        emoji: f.emoji,
        nomi: f.nomi,
        x: CENTER.x + Math.cos(a) * placeR,
        y: CENTER.y + Math.sin(a) * placeR,
        vx, vy,
        r: CONFIG.ballRadius,
        alive: true,
        hitFlash: 0
      };
    });
  }

  // ---------- PHYSICS ----------
  function step() {
    gapAngle += CONFIG.ringRotationSpeed;

    for (const b of balls) {
      if (!b.alive) continue;
      b.x += b.vx;
      b.y += b.vy;
      if (b.hitFlash > 0) b.hitFlash -= 1;
    }

    resolveBallCollisions();
    resolveWallOrGap();
    enforceSpeedLimits();
  }

  function enforceSpeedLimits() {
    for (const b of balls) {
      if (!b.alive) continue;
      const speed = Math.hypot(b.vx, b.vy) || 0.0001;
      if (speed < CONFIG.speedMin) {
        const scale = CONFIG.speedMin / speed;
        b.vx *= scale;
        b.vy *= scale;
      } else if (speed > CONFIG.speedHardCap) {
        const scale = CONFIG.speedHardCap / speed;
        b.vx *= scale;
        b.vy *= scale;
      }
    }
  }

  function resolveBallCollisions() {
    const alive = balls.filter(b => b.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const minDist = a.r + b.r;
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2;
          const nx = dx / dist, ny = dy / dist;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;

          const relVx = b.vx - a.vx;
          const relVy = b.vy - a.vy;
          const velAlongNormal = relVx * nx + relVy * ny;
          if (velAlongNormal < 0) {
            const impulse = -(1 + CONFIG.restitution) * velAlongNormal / 2;
            a.vx -= impulse * nx;
            a.vy -= impulse * ny;
            b.vx += impulse * nx;
            b.vy += impulse * ny;
            a.hitFlash = 8;
            b.hitFlash = 8;
            playSound('collision');
          }
        }
      }
    }
  }

  function angleNormalized(a) {
    let x = a % (Math.PI * 2);
    if (x < 0) x += Math.PI * 2;
    return x;
  }

  function resolveWallOrGap() {
    for (const b of balls) {
      if (!b.alive) continue;
      const dx = b.x - CENTER.x;
      const dy = b.y - CENTER.y;
      const dist = Math.hypot(dx, dy);
      const limit = ARENA_RADIUS;

      if (dist + b.r >= limit) {
        const ballAngle = angleNormalized(Math.atan2(dy, dx));
        const gapCenter = angleNormalized(gapAngle);
        let diff = Math.abs(ballAngle - gapCenter);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        const inGap = diff < CONFIG.gapAngleWidth / 2;

        if (inGap && dist > limit * 0.4) {
          eliminateBall(b);
          continue;
        }

        // bounce
        const nx = dx / (dist || 0.0001);
        const ny = dy / (dist || 0.0001);
        const vDotN = b.vx * nx + b.vy * ny;
        b.vx -= 2 * vDotN * nx;
        b.vy -= 2 * vDotN * ny;
        b.vx *= CONFIG.restitution;
        b.vy *= CONFIG.restitution;

        const pushDist = limit - b.r;
        b.x = CENTER.x + nx * pushDist;
        b.y = CENTER.y + ny * pushDist;
        b.hitFlash = 8;
      }
    }
  }

  function eliminateBall(b) {
    b.alive = false;
    b.eliminatedAt = performance.now();
    eliminatedOrder.push(b);
    playSound('lose');
    checkRoundEnd();
  }

  // ---------- ROUND CONTROL ----------
  function checkRoundEnd() {
    const aliveBalls = balls.filter(b => b.alive);
    aliveCountEl.textContent = aliveBalls.length;

    if (aliveBalls.length === 1 && roundActive) {
      finishRound(aliveBalls[0]);
    } else if (aliveBalls.length === 0 && roundActive) {
      finishRound(null);
    }
  }

  function finishRound(winner) {
    roundActive = false;
    statusText.classList.remove("pulse");

    if (winner) {
      winnerFlagEl.textContent = winner.emoji;
      winnerNameEl.textContent = winner.nomi;
      winnerDisplay.classList.add("is-champion");
      statusText.textContent = `${winner.nomi} g'olib chiqdi! 🏆`;
      playSound('win');
      // save winner
      winners.push({ emoji: winner.emoji, nomi: winner.nomi });
      updateLeaderboard();
    } else {
      statusText.textContent = "Tur yakunlandi.";
    }

    startCountdownToNextRound();
  }

  function startCountdownToNextRound() {
    let remaining = CONFIG.respawnDelay;
    updateTimerLabel(remaining);
    statusText.textContent = `⏳ Yangi raund boshlanmoqda… ${(remaining/1000).toFixed(1)}s`;
    playSound('next_round');

    clearInterval(countdownHandle);
    countdownHandle = setInterval(() => {
      remaining -= 100;
      updateTimerLabel(remaining);
      statusText.textContent = `⏳ Yangi raund boshlanmoqda… ${(remaining/1000).toFixed(1)}s`;
      if (remaining <= 0) {
        clearInterval(countdownHandle);
        beginRound(); // cheksiz davom etadi
      }
    }, 100);
  }

  function updateTimerLabel(ms) {
    const s = Math.max(0, ms / 1000);
    nextRoundTimerEl.textContent = s.toFixed(1) + "s";
  }

  // ---------- ROUND LIFECYCLE ----------
  function beginRound() {
    roundCount++;
    roundDisplay.textContent = `ROUND ${roundCount}`;

    eliminatedOrder = [];
    balls = makeBalls(flagsPool);
    roundActive = true;
    gapAngle = -Math.PI / 2;

    winnerDisplay.classList.remove("is-champion");
    winnerFlagEl.textContent = "🏳️";
    winnerNameEl.textContent = "The game has started.…";
    nextRoundTimerEl.textContent = "—";
    aliveCountEl.textContent = balls.length;
    statusText.textContent = `⚔️ Jang boshlandi — ${balls.length} ta bayroq!`;
    statusText.classList.add("pulse");
    playSound('start');
  }

  // ---------- LEADERBOARD ----------
  function updateLeaderboard() {
    const counts = {};
    for (const w of winners) {
      const key = w.emoji + '|' + w.nomi;
      counts[key] = (counts[key] || 0) + 1;
    }
    const entries = Object.entries(counts).map(([key, count]) => {
      const [emoji, nomi] = key.split('|');
      return { emoji, nomi, wins: count };
    });
    entries.sort((a, b) => b.wins - a.wins || a.nomi.localeCompare(b.nomi));
    const top = entries.slice(0, 5);

    let html = '';
    for (let i = 0; i < 5; i++) {
      const row = top[i];
      if (row) {
        html += `
          <div class="leaderboard__row">
            <span class="rank">#${i+1}</span>
            <span class="country">${row.emoji} ${row.nomi}</span>
            <span class="wins">${row.wins} win${row.wins>1?'s':''}</span>
          </div>
        `;
      } else {
        html += `
          <div class="leaderboard__row" style="color:var(--text-lo); opacity:0.5;">
            <span class="rank">#${i+1}</span>
            <span class="country">—</span>
            <span class="wins">0 wins</span>
          </div>
        `;
      }
    }
    leaderboardBody.innerHTML = html;
  }

  // ---------- DRAW ----------
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawRing();
    for (const b of balls) {
      if (b.alive) drawBall(b);
    }
    drawEliminated();
  }

  function drawRing() {
    const r = ARENA_RADIUS + CONFIG.ballRadius + CONFIG.ringThickness / 2;
    const gapStart = gapAngle - CONFIG.gapAngleWidth / 2;
    const gapEnd = gapAngle + CONFIG.gapAngleWidth / 2;

    ctx.save();
    ctx.lineWidth = CONFIG.ringThickness;
    ctx.lineCap = "butt";
    ctx.strokeStyle = getCss("--ring-track");
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, r, gapEnd, gapStart + Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = getCss("--gap-glow");
    ctx.shadowColor = getCss("--gap-glow");
    ctx.shadowBlur = 16;
    drawGapEdge(r, gapStart);
    drawGapEdge(r, gapEnd);
    ctx.restore();
  }

  function drawGapEdge(r, angle) {
    const inner = r - CONFIG.ringThickness / 2;
    const outer = r + CONFIG.ringThickness / 2;
    ctx.beginPath();
    ctx.moveTo(CENTER.x + Math.cos(angle) * inner, CENTER.y + Math.sin(angle) * inner);
    ctx.lineTo(CENTER.x + Math.cos(angle) * outer, CENTER.y + Math.sin(angle) * outer);
    ctx.stroke();
  }

  function drawBall(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    if (b.hitFlash > 0) {
      ctx.shadowColor = getCss("--ice");
      ctx.shadowBlur = 18;
    }
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI * 2);
    ctx.fillStyle = "#182036";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#2c3757";
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.font = `${b.r * 1.6}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.emoji, 0, 1);
    ctx.restore();
  }

  // KATTA VA YORQIN ELIMINATED BAYROQLAR
  function drawEliminated() {
    const eliminated = eliminatedOrder.filter(b => !b.alive);
    if (eliminated.length === 0) return;

    const startY = CENTER.y + ARENA_RADIUS + 30;
    const spacing = 40;          // kengroq
    const maxPerRow = Math.floor((ARENA_RADIUS * 2) / spacing) - 1;
    const rows = Math.ceil(eliminated.length / maxPerRow);
    const totalWidth = Math.min(eliminated.length, maxPerRow) * spacing;
    const startX = CENTER.x - totalWidth / 2;

    ctx.save();
    ctx.font = `32px serif`;      // kattaroq
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,255,255,0.2)";
    ctx.shadowBlur = 10;
    for (let i = 0; i < eliminated.length; i++) {
      const col = i % maxPerRow;
      const row = Math.floor(i / maxPerRow);
      const x = startX + col * spacing + spacing/2;
      const y = startY + row * spacing;
      ctx.fillText(eliminated[i].emoji, x, y);
    }
    ctx.restore();
  }

  function getCss(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  // ---------- MAIN LOOP ----------
  function loop() {
    if (roundActive) step();
    draw();
    animHandle = requestAnimationFrame(loop);
  }

  // ---------- INIT ----------
  async function init() {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    flagsPool = await loadFlags();
    statusText.textContent = `${flagsPool.length} ta bayroq yuklandi. Boshlanmoqda…`;

    roundCount = 0;
    winners = [];
    updateLeaderboard();
    roundDisplay.textContent = `ROUND 0`;

    beginRound();
    loop();
  }

  init();
})();