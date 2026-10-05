/* =========================================================
   BAYROQLAR JANGI — Flag Battle Royale (cheksiz)
   Optimallashtirilgan versiya: ko'p bayroq bo'lsa ham
   siliq (60fps) ishlaydi, qotib qolmaydi.
   ========================================================= */

(function () {
  "use strict";

  // ---------- DOM ----------
  const canvas = document.getElementById("arena");
  const ctx = canvas.getContext("2d");
  const statusText = document.getElementById("statusText");
  const aliveCountEl = document.getElementById("aliveCount");
  const nextRoundTimerEl = document.getElementById("nextRoundTimer");
  const winnerCircleEl = document.getElementById("winnerCircle");
  const winnerFlagEl = document.getElementById("winnerFlag");
  const winnerNameEl = document.getElementById("winnerName");
  const roundDisplay = document.getElementById("roundDisplay");
  const roundHistoryEl = document.getElementById("roundHistory");

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
    maxFlags: 180,
    speechLang: "en-US",         // g'olib nomi shu tilda ovoz bilan aytiladi
    maxHistoryChips: 60          // banner'dagi raundlar tarixida ko'rinadigan eng ko'p yozuv
  };

  let ARENA_RADIUS = 0;
  let CENTER = { x: 0, y: 0 };
  let gapAngle = -Math.PI / 2;
  let dpr = window.devicePixelRatio || 1;

  let flagsPool = [];
  let balls = [];       // barcha sharlar (o'lik + tirik) — statistika/leaderboard uchun
  let aliveList = [];   // faqat tirik sharlar — simulyatsiya/chizish shu massivda ishlaydi
  let eliminatedOrder = [];
  let roundActive = false;
  let countdownHandle = null;
  let animHandle = null;

  // Round & g'oliblar tarixi
  let roundCount = 0;
  let winners = [];            // har raund g'olibi: { round, emoji, nomi }
  let hideAliveBalls = false;  // g'olib ko'rsatilayotganda arenadagi qolgan shar chizilmaydi
  let winnerCircleSize = 180;

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
        playTone(523, 0.15, 'square', 0.22);
        setTimeout(() => playTone(659, 0.15, 'square', 0.22), 150);
        break;
      case 'win':
        playTone(880, 0.1, 'sine', 0.28);
        setTimeout(() => playTone(1100, 0.1, 'sine', 0.28), 120);
        setTimeout(() => playTone(1320, 0.2, 'sine', 0.32), 240);
        break;
      case 'lose':
        playTone(300, 0.3, 'sawtooth', 0.16);
        setTimeout(() => playTone(200, 0.4, 'sawtooth', 0.16), 250);
        break;
      case 'next_round':
        playTone(440, 0.1, 'sine', 0.15);
        setTimeout(() => playTone(554, 0.1, 'sine', 0.15), 150);
        setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 300);
        break;
      default: break;
    }
  }

  // ---------- OVOZLI HABAR (g'olib nomi) ----------
  function speakWinner(name) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(name + " wins!");
      u.lang = CONFIG.speechLang;
      u.rate = 0.95;
      u.pitch = 1;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  function stopSpeech() {
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    } catch (_) {}
  }

  // Telefonlarda ovozli habar birinchi tegishdan keyingina ishlaydi —
  // shuning uchun birinchi tegishda bo'sh gap bilan "uyg'otib" qo'yamiz.
  function primeSpeechOnce() {
    try {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch (_) {}
    window.removeEventListener("pointerdown", primeSpeechOnce);
    window.removeEventListener("touchstart", primeSpeechOnce);
    window.removeEventListener("click", primeSpeechOnce);
  }
  window.addEventListener("pointerdown", primeSpeechOnce);
  window.addEventListener("touchstart", primeSpeechOnce);
  window.addEventListener("click", primeSpeechOnce);

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
      const res = await fetch("https://xakimovazizbek.github.io/Flag-Battle/bayroq.txt", { cache: "no-store" });
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
    dpr = window.devicePixelRatio || 1;

    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ARENA_RADIUS = size / 2 - CONFIG.ringThickness - CONFIG.ballRadius - 2;
    CENTER = { x: size / 2, y: size / 2 };

    winnerCircleSize = size * 0.5;
    winnerCircleEl.style.setProperty("--wc-size", winnerCircleSize + "px");
    fitWinnerText();

    syncEliminatedCanvas(size);
    redrawEliminatedOffscreen(); // o'lcham o'zgarsa, keshni qayta chizish
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

    const n = aliveList.length;
    for (let i = 0; i < n; i++) {
      const b = aliveList[i];
      b.x += b.vx;
      b.y += b.vy;
      if (b.hitFlash > 0) b.hitFlash -= 1;
    }

    resolveBallCollisions();
    resolveWallOrGap();
    enforceSpeedLimits();
  }

  function enforceSpeedLimits() {
    const n = aliveList.length;
    for (let i = 0; i < n; i++) {
      const b = aliveList[i];
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

  // ---------- COLLISION (spatial grid — O(n) ga yaqin, ko'p bayroqda ham siliq) ----------
  // Arenani kataklarga (grid) bo'lib, faqat yaqin kataklardagi sharlarni
  // bir-biri bilan solishtiramiz. Bayroqlar soni ko'paysa ham tezlik
  // deyarli chiziqli o'sadi — "qotib qolish" shu orqali yo'qoladi.
  const gridMap = new Map();
  const neighborOffsets = [[0, 0], [1, 0], [0, 1], [1, 1], [1, -1]];

  function resolveBallCollisions() {
    gridMap.clear();
    const cellSize = CONFIG.ballRadius * 2.5;

    for (let i = 0; i < aliveList.length; i++) {
      const b = aliveList[i];
      const cx = Math.floor(b.x / cellSize);
      const cy = Math.floor(b.y / cellSize);
      const key = cx + "," + cy;
      let arr = gridMap.get(key);
      if (!arr) {
        arr = [];
        gridMap.set(key, arr);
      }
      arr.push(b);
    }

    for (const [key, cellBalls] of gridMap) {
      const commaIdx = key.indexOf(",");
      const cx = parseInt(key.slice(0, commaIdx), 10);
      const cy = parseInt(key.slice(commaIdx + 1), 10);

      for (let k = 0; k < neighborOffsets.length; k++) {
        const ox = neighborOffsets[k][0];
        const oy = neighborOffsets[k][1];
        const nKey = (cx + ox) + "," + (cy + oy);
        const neighborBalls = gridMap.get(nKey);
        if (!neighborBalls) continue;

        if (ox === 0 && oy === 0) {
          for (let i = 0; i < cellBalls.length; i++) {
            for (let j = i + 1; j < cellBalls.length; j++) {
              resolvePair(cellBalls[i], cellBalls[j]);
            }
          }
        } else {
          for (let i = 0; i < cellBalls.length; i++) {
            for (let j = 0; j < neighborBalls.length; j++) {
              resolvePair(cellBalls[i], neighborBalls[j]);
            }
          }
        }
      }
    }
  }

  function resolvePair(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const minDist = a.r + b.r;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist || distSq === 0) return;

    const dist = Math.sqrt(distSq);
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
    }
  }

  function angleNormalized(a) {
    let x = a % (Math.PI * 2);
    if (x < 0) x += Math.PI * 2;
    return x;
  }

  function resolveWallOrGap() {
    const gapCenter = angleNormalized(gapAngle);
    const half = CONFIG.gapAngleWidth / 2;

    // orqadan oldinga o'tamiz — eliminateBall ichida aliveList dan
    // swap-pop qilinganda indekslar siljib ketmasligi uchun
    for (let i = aliveList.length - 1; i >= 0; i--) {
      const b = aliveList[i];
      const dx = b.x - CENTER.x;
      const dy = b.y - CENTER.y;
      const dist = Math.hypot(dx, dy);
      const limit = ARENA_RADIUS;

      if (dist + b.r >= limit) {
        const ballAngle = angleNormalized(Math.atan2(dy, dx));
        let diff = Math.abs(ballAngle - gapCenter);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;

        const inGap = diff < half;

        if (inGap && dist > limit * 0.4) {
          eliminateBall(b, i);
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

  function eliminateBall(b, indexInAliveList) {
    b.alive = false;
    b.eliminatedAt = performance.now();
    eliminatedOrder.push(b);

    // aliveList dan tez o'chirish (swap-pop — tartib muhim emas)
    const lastIdx = aliveList.length - 1;
    if (indexInAliveList !== lastIdx) {
      aliveList[indexInAliveList] = aliveList[lastIdx];
    }
    aliveList.pop();

    appendEliminatedToOffscreen(b);
    playSound('lose');
    checkRoundEnd();
  }

  // ---------- ROUND CONTROL ----------
  function checkRoundEnd() {
    aliveCountEl.textContent = aliveList.length;

    if (aliveList.length === 1 && roundActive) {
      finishRound(aliveList[0]);
    } else if (aliveList.length === 0 && roundActive) {
      finishRound(null);
    }
  }

  function finishRound(winner) {
    roundActive = false;
    statusText.classList.remove("pulse");

    if (winner) {
      showWinnerCircle(winner);
      statusText.textContent = `${winner.nomi} g'olib chiqdi! 🏆`;
      playSound('win');
      speakWinner(winner.nomi);
      const rec = { round: roundCount, emoji: winner.emoji, nomi: winner.nomi };
      winners.push(rec);
      addRoundChip(rec);
    } else {
      statusText.textContent = "Tur yakunlandi.";
    }

    startCountdownToNextRound();
  }

  function startCountdownToNextRound() {
    let remaining = CONFIG.respawnDelay;
    updateTimerLabel(remaining);
    statusText.textContent = `⏳ Yangi raund boshlanmoqda… ${(remaining / 1000).toFixed(1)}s`;
    playSound('next_round');

    clearInterval(countdownHandle);
    countdownHandle = setInterval(() => {
      remaining -= 100;
      updateTimerLabel(remaining);
      statusText.textContent = `⏳ Yangi raund boshlanmoqda… ${(remaining / 1000).toFixed(1)}s`;
      if (remaining <= 0) {
        clearInterval(countdownHandle);
        beginRound();
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
    aliveList = balls.slice(); // boshida hammasi tirik
    roundActive = true;
    gapAngle = -Math.PI / 2;

    clearEliminatedOffscreen();

    hideWinnerCircle();
    stopSpeech();
    nextRoundTimerEl.textContent = "—";
    aliveCountEl.textContent = balls.length;
    statusText.textContent = `⚔️ The battle has begun — ${balls.length} flags!`;
    statusText.classList.add("pulse");
    playSound('start');
  }

  // ---------- G'OLIB MARKAZDA + RAUNDLAR TARIXI ----------
  function fitWinnerText() {
    const len = (winnerNameEl.textContent || "").length;
    const k = len <= 10 ? 0.13 : len <= 16 ? 0.105 : len <= 20 ? 0.088 : 0.075;
    winnerNameEl.style.fontSize = (winnerCircleSize * k) + "px";
  }

  function showWinnerCircle(w) {
    winnerFlagEl.textContent = w.emoji;
    winnerNameEl.textContent = w.nomi;
    fitWinnerText();
    hideAliveBalls = true;
    winnerCircleEl.classList.remove("show");
    void winnerCircleEl.offsetWidth; // animatsiya qayta ishlashi uchun
    winnerCircleEl.classList.add("show");
  }

  function hideWinnerCircle() {
    winnerCircleEl.classList.remove("show");
    hideAliveBalls = false;
  }

  function addRoundChip(rec) {
    const empty = roundHistoryEl.querySelector(".rounds__empty");
    if (empty) roundHistoryEl.removeChild(empty);

    const prev = roundHistoryEl.querySelector(".round-chip.is-new");
    if (prev) prev.classList.remove("is-new");

    const chip = document.createElement("span");
    chip.className = "round-chip is-new";

    const r = document.createElement("b");
    r.textContent = "R" + rec.round;
    const f = document.createElement("span");
    f.className = "round-chip__flag";
    f.textContent = rec.emoji;
    const n = document.createElement("span");
    n.className = "round-chip__name";
    n.textContent = rec.nomi;

    chip.append(r, f, n);
    roundHistoryEl.appendChild(chip);

    while (roundHistoryEl.children.length > CONFIG.maxHistoryChips) {
      roundHistoryEl.removeChild(roundHistoryEl.firstChild);
    }
    roundHistoryEl.scrollLeft = roundHistoryEl.scrollWidth;
  }

  // ---------- ELIMINATED FLAGS — OFFSCREEN CACHE ----------
  // Muammo: avval har frame barcha yutqazgan bayroqlar matn sifatida
  // qayta chizilardi (ctx.fillText juda qimmat amal). Ko'p bayroqda bu
  // asosiy sabablardan biri bo'lib, o'yinni "qotirardi". Endi har bir
  // elimatsiyada FAQAT bitta yangi bayroq alohida offscreen canvas'ga
  // bir marta chiziladi va keyin har frame oddiy drawImage orqali
  // ko'chiriladi — bu amal juda arzon va 60fps'ni hech qachon
  // pasaytirmaydi.
  let eliminatedCanvas = document.createElement("canvas");
  let eliminatedCtx = eliminatedCanvas.getContext("2d");
  let eliminatedLayoutCache = { spacing: 40, maxPerRow: 1 };

  function syncEliminatedCanvas(size) {
    eliminatedCanvas.width = size * dpr;
    eliminatedCanvas.height = size * dpr;
    eliminatedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const spacing = 40;
    const maxPerRow = Math.max(1, Math.floor((ARENA_RADIUS * 2) / spacing) - 1);
    eliminatedLayoutCache = { spacing, maxPerRow };
  }

  function clearEliminatedOffscreen() {
    eliminatedCtx.save();
    eliminatedCtx.setTransform(1, 0, 0, 1, 0, 0);
    eliminatedCtx.clearRect(0, 0, eliminatedCanvas.width, eliminatedCanvas.height);
    eliminatedCtx.restore();
  }

  function appendEliminatedToOffscreen(b) {
    const { spacing, maxPerRow } = eliminatedLayoutCache;
    const idx = eliminatedOrder.length - 1;
    const col = idx % maxPerRow;
    const row = Math.floor(idx / maxPerRow);

    const startY = CENTER.y + ARENA_RADIUS + 30;
    const totalWidth = Math.min(eliminatedOrder.length, maxPerRow) * spacing;
    const startX = CENTER.x - totalWidth / 2;

    const x = startX + col * spacing + spacing / 2;
    const y = startY + row * spacing;

    eliminatedCtx.save();
    eliminatedCtx.font = `32px serif`;
    eliminatedCtx.textAlign = "center";
    eliminatedCtx.textBaseline = "middle";
    eliminatedCtx.shadowColor = "rgba(255,255,255,0.2)";
    eliminatedCtx.shadowBlur = 10;
    eliminatedCtx.fillText(b.emoji, x, y);
    eliminatedCtx.restore();
  }

  function redrawEliminatedOffscreen() {
    clearEliminatedOffscreen();
    if (!eliminatedOrder.length) return;
    const saved = eliminatedOrder.slice();
    eliminatedOrder = [];
    for (const b of saved) {
      eliminatedOrder.push(b);
      appendEliminatedToOffscreen(b);
    }
  }

  // ---------- DRAW ----------
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawRing();

    // eliminatsiya qilingan bayroqlar — keshdan tez ko'chirish (arzon amal)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(eliminatedCanvas, 0, 0);
    ctx.restore();

    const n = hideAliveBalls ? 0 : aliveList.length;
    for (let i = 0; i < n; i++) {
      drawBall(aliveList[i]);
    }
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

  // Shar chizish: avvalgi versiyada har bir urilgan sharda ctx.shadowBlur
  // ishlatilgan edi — canvas'da shadow effekt juda qimmat amal, va
  // bir vaqtda 50-100+ shar "yongan" holatda bo'lsa, frame vaqti keskin
  // oshib, o'yin qotib qolardi. Endi shadow o'rniga arzon alternativ:
  // yorqinroq qalin chiziq (stroke) — vizual effekt deyarli bir xil,
  // lekin amal o'nlab marta arzonroq va 300+ bayroqda ham siliq ishlaydi.
  function drawBall(b) {
    const hit = b.hitFlash > 0;

    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = "#182036";
    ctx.fill();

    ctx.lineWidth = hit ? 3 : 2;
    ctx.strokeStyle = hit ? "#9fe8f7" : "#2c3757";
    ctx.stroke();

    ctx.font = `${b.r * 1.6}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.emoji, b.x, b.y + 1);
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
    roundDisplay.textContent = `ROUND 0`;

    beginRound();
    requestAnimationFrame(loop);
  }

  init();
})();
