/* Gesture Deck: control a slide presentation with your hand.
   Vanilla JS + MediaPipe Hands, no build step. */
(() => {
  'use strict';

  const DEFAULT_MD = `# Gesture Deck
Present with your hands, not a clicker

---

## How it works
- Open palm, swipe left: next slide
- Open palm, swipe right: previous slide
- Point with your index finger: laser pointer
- Pinch and hold: zoom into that spot
- Closed fist for one second: lock or unlock

---

## Why build this?
- Hands-free presenting feels more natural
- Runs entirely in your browser
- No uploads: video never leaves your device

---

## Try it
Press **C** for the calibration view, **L** to load your own .md slides, and use the arrow keys if the camera gives up.`;

  const $ = (s) => document.querySelector(s);
  const slideEl = $('#slide'), wrap = $('#wrap'), laser = $('#laser');
  const statusEl = $('#status'), counter = $('#counter'), progress = $('#progress');
  const toastEl = $('#toast'), video = $('#video'), overlay = $('#overlay');
  const startScreen = $('#startScreen'), fileInput = $('#fileInput');

  /* ---------- Markdown -> slides ---------- */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  function mdToSlides(md) {
    return md.replace(/\r/g, '').split(/\n-{3,}\s*\n/).map((b) => b.trim()).filter(Boolean).map((block) => {
      const out = [];
      let inList = false;
      for (const raw of block.split('\n')) {
        const line = raw.trim();
        const li = line.match(/^[-*]\s+(.*)/);
        if (li) {
          if (!inList) { out.push('<ul>'); inList = true; }
          out.push(`<li>${inline(li[1])}</li>`);
          continue;
        }
        if (inList) { out.push('</ul>'); inList = false; }
        if (!line) continue;
        const h = line.match(/^(#{1,2})\s+(.*)/);
        out.push(h ? `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>` : `<p>${inline(line)}</p>`);
      }
      if (inList) out.push('</ul>');
      return out.join('');
    });
  }

  /* ---------- Slide navigation ---------- */
  let slides = mdToSlides(DEFAULT_MD);
  let index = 0;

  function show(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    slideEl.classList.remove('in');
    void slideEl.offsetWidth; // restart the fade animation
    slideEl.innerHTML = slides[index];
    slideEl.classList.add('in');
    counter.textContent = `${index + 1} / ${slides.length}`;
    progress.style.width = `${((index + 1) / slides.length) * 100}%`;
  }
  const next = () => show(index + 1);
  const prev = () => show(index - 1);

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
  }

  /* ---------- Gesture helpers ---------- */
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  // Mirror x (the preview is mirrored) and use the central 80% of the frame so edges are reachable.
  const toScreen = (p) => ({
    x: clamp01(((1 - p.x) - 0.1) / 0.8) * innerWidth,
    y: clamp01((p.y - 0.1) / 0.8) * innerHeight,
  });

  function classify(lm) {
    const size = dist(lm[0], lm[9]);
    const ext = (tip, pip) => dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.15;
    const f = { index: ext(8, 6), middle: ext(12, 10), ring: ext(16, 14), pinky: ext(20, 18) };
    const count = Object.values(f).filter(Boolean).length;
    if (dist(lm[4], lm[8]) / size < 0.35) return 'pinch';
    if (f.index && !f.middle && !f.ring && !f.pinky) return 'point';
    if (count === 0) return 'fist';
    if (count >= 4) return 'open';
    return 'none';
  }

  /* ---------- Debounced gesture state ---------- */
  let cand = 'none', candN = 0, stable = 'none';
  function settle(g) {
    if (g === cand) candN++; else { cand = g; candN = 1; }
    if (candN >= 3) stable = g; // must hold a pose for 3 frames before it counts
  }

  let locked = false, fistSince = 0, fistLatched = false;
  let zooming = false;
  let lx = 0, ly = 0, laserOn = false;
  const swipeTrail = [];
  let cooldownUntil = 0;

  const LABELS = { point: 'Pointing', pinch: 'Pinching', open: 'Open palm', fist: 'Fist', none: 'Hand detected' };
  function setStatus(text) {
    statusEl.textContent = locked ? `Locked (${text})` : text;
    statusEl.classList.toggle('locked', locked);
  }

  function hideLaser() { laser.hidden = true; laserOn = false; }
  function moveLaser(p) {
    if (!laserOn) { lx = p.x; ly = p.y; laserOn = true; }
    lx += (p.x - lx) * 0.35;
    ly += (p.y - ly) * 0.35;
    laser.style.left = `${lx}px`;
    laser.style.top = `${ly}px`;
    laser.hidden = false;
  }

  function startZoom(lm) {
    const mid = toScreen({ x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 });
    const r = wrap.getBoundingClientRect();
    wrap.style.transformOrigin = `${clamp01((mid.x - r.left) / r.width) * 100}% ${clamp01((mid.y - r.top) / r.height) * 100}%`;
    wrap.classList.add('zoomed');
    zooming = true;
  }
  function endZoom() {
    if (!zooming) return;
    wrap.classList.remove('zoomed');
    zooming = false;
  }

  function trackSwipe(p, now) {
    swipeTrail.push({ t: now, x: 1 - p.x });
    while (swipeTrail.length && now - swipeTrail[0].t > 350) swipeTrail.shift();
    if (now < cooldownUntil || swipeTrail.length < 4) return;
    const dx = swipeTrail[swipeTrail.length - 1].x - swipeTrail[0].x;
    if (Math.abs(dx) > 0.25) {
      if (dx < 0) { next(); toast('Next \u2192'); } else { prev(); toast('\u2190 Back'); }
      cooldownUntil = now + 900; // cooldown stops one swipe from firing twice
      swipeTrail.length = 0;
    }
  }

  function toggleLock() {
    locked = !locked;
    toast(locked ? 'Gestures locked' : 'Gestures unlocked');
  }

  function handLost() {
    settle('none');
    stable = 'none';
    swipeTrail.length = 0;
    fistSince = 0; fistLatched = false;
    hideLaser(); endZoom();
    setStatus('No hand');
  }

  /* ---------- MediaPipe results ---------- */
  function drawSkeleton(lm) {
    const w = overlay.width = video.videoWidth || 640;
    const h = overlay.height = video.videoHeight || 480;
    const c = overlay.getContext('2d');
    c.clearRect(0, 0, w, h);
    if (!lm) return;
    c.strokeStyle = '#ff4d5a'; c.lineWidth = 3;
    (window.HAND_CONNECTIONS || []).forEach(([a, b]) => {
      c.beginPath(); c.moveTo(lm[a].x * w, lm[a].y * h); c.lineTo(lm[b].x * w, lm[b].y * h); c.stroke();
    });
    c.fillStyle = '#fff';
    lm.forEach((p) => { c.beginPath(); c.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2); c.fill(); });
  }

  function onResults(res) {
    const lm = res.multiHandLandmarks && res.multiHandLandmarks[0];
    drawSkeleton(lm);
    if (!lm) { handLost(); return; }

    settle(classify(lm));
    setStatus(LABELS[stable]);
    const now = performance.now();

    // Fist held ~1s toggles the lock. It must be released before it can toggle again.
    if (stable === 'fist') {
      if (!fistSince) fistSince = now;
      if (!fistLatched && now - fistSince > 1000) { toggleLock(); fistLatched = true; }
    } else { fistSince = 0; fistLatched = false; }

    if (locked) { hideLaser(); endZoom(); return; }

    if (stable === 'point') moveLaser(toScreen(lm[8])); else hideLaser();

    if (stable === 'pinch') { if (!zooming) startZoom(lm); } else endZoom();

    if (stable === 'open') trackSwipe(lm[9], now); else swipeTrail.length = 0;
  }

  /* ---------- Camera ---------- */
  async function startCamera() {
    if (typeof Hands === 'undefined' || typeof Camera === 'undefined') {
      toast('Could not load MediaPipe. Check your internet connection.');
      return;
    }
    const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.6 });
    hands.onResults(onResults);
    const cam = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 640, height: 480,
    });
    try {
      setStatus('Starting camera...');
      await cam.start();
      startScreen.classList.add('hidden');
      setStatus('No hand');
      toast('Camera ready. Show your hand!');
    } catch (err) {
      setStatus('Camera off');
      toast('Camera blocked. Allow access and try again.');
      console.error(err);
    }
  }

  /* ---------- UI wiring ---------- */
  $('#startBtn').addEventListener('click', startCamera);

  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'c' || e.key === 'C') document.body.classList.toggle('calibrate');
    else if (e.key === 'l' || e.key === 'L') fileInput.click();
    else if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = mdToSlides(String(reader.result));
      if (!parsed.length) { toast('No slides found in that file'); return; }
      slides = parsed;
      show(0);
      toast(`Loaded ${slides.length} slides`);
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  show(0);
})();
