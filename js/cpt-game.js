(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────
  //  CONFIG
  // ─────────────────────────────────────────────────────────
  var INIT_WINDOW_MS   = 2200;    // starting reaction window
  var MIN_WINDOW_MS    = 500;     // fastest possible
  var WINDOW_DECAY_MS  = 55;      // shave per success
  var INIT_INTER_MS    = 1100;    // pause between spawns
  var MIN_INTER_MS     = 250;     // minimum pause
  var INTER_DECAY_MS   = 25;      // inter-spawn decay
  var NOGO_CHANCE      = 0.20;    // 20% chance of lotus leaf
  var TIMER_CIRC       = 816.8;   // 2π × 130
  var COMBO_MILESTONES = [5, 10, 15, 20, 30, 50, 75, 100];

  // Koi colour palettes: body = white base, two patch colours (orange + dark), fin tint
  var KOI_PALETTES = [
    { body: '#f5f0e8', patch1: '#e87530', patch2: '#2a2a50', fin: '#e8d8c4' },
    { body: '#f8f2ea', patch1: '#e05020', patch2: '#333355', fin: '#e0d0bc' },
    { body: '#f5f0e8', patch1: '#cc3333', patch2: '#2a2a50', fin: '#e8d0c0' },
    { body: '#f8f2ea', patch1: '#ff8c00', patch2: '#3a3a5a', fin: '#ece0cc' },
    { body: '#f5f0e8', patch1: '#e87530', patch2: '#1e1e40', fin: '#e4d4c0' },
    { body: '#faf4ec', patch1: '#d04818', patch2: '#2e2e52', fin: '#e8dac8' },
  ];

  // ─────────────────────────────────────────────────────────
  //  STATE
  // ─────────────────────────────────────────────────────────
  var G = {
    state: 'IDLE',       // IDLE | WAITING | ACTIVE | RESOLVING | OVER
    score: 0,
    streak: 0,
    bestStreak: 0,
    best: +localStorage.getItem('gf_best') || 0,

    isNoGo: false,       // current item: true = lotus leaf
    windowMs: INIT_WINDOW_MS,
    interMs:  INIT_INTER_MS,

    roundStart:   0,
    timerRafId:   null,
    scheduleTimer: null,
    windowTimer:   null,

    gazeX: 0, gazeY: 0,
    webgazerReady: false,
    webgazerPaused: false,
    pressed: false,     // space pressed this round
    lives: 3,
  };

  // ─────────────────────────────────────────────────────────
  //  DOM HELPERS
  // ─────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  var elGazeDot     = $('gaze-dot');
  var elCalMsg      = $('cal-msg');
  var elSpawnZone   = $('spawn-zone');
  var elNet         = $('net-container');
  var elTimerRing   = $('timer-ring');
  var elFeedback    = $('feedback-label');
  var elCombo       = $('combo-label');
  var elSpeed       = $('speed-label');
  var elFailFlash   = $('fail-flash');
  var elSuccFlash   = $('success-flash');
  var elHudScore    = $('hud-score');
  var elHudStreak   = $('hud-streak');
  var elHudSpeed    = $('hud-speed');
  var elHudBest     = $('hud-best');

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.remove('active');
    });
    $(id).classList.add('active');
  }

  // ─────────────────────────────────────────────────────────
  //  KOI FISH SVG GENERATOR
  // ─────────────────────────────────────────────────────────
  function makeKoiSVG(svgW, svgH) {
    svgW = svgW || 240;
    svgH = svgH || 110;
    var p = KOI_PALETTES[Math.floor(Math.random() * KOI_PALETTES.length)];
    var id = 'koi' + Date.now() + Math.floor(Math.random() * 9999);

    // Patches adjusted for narrower body
    var p1_1 = smoothBlob(65, 48, 24 + Math.random() * 5);
    var p1_2 = smoothBlob(105, 46, 22 + Math.random() * 5);
    var p1_3 = smoothBlob(55, 62, 18 + Math.random() * 4);
    var p1_4 = smoothBlob(128, 60, 20 + Math.random() * 4);

    var p2_1 = smoothBlob(85, 55, 12 + Math.random() * 3);
    var p2_2 = smoothBlob(112, 50, 10 + Math.random() * 3);
    var p2_3 = smoothBlob(60, 53, 9 + Math.random() * 3);

    var c1 = p.patch1, c2 = p.patch2;
    if (Math.random() > 0.5) { c1 = p.patch2; c2 = p.patch1; }

    // Elongated body with longer rear, narrow spear-like nose (no gap)
    var bodyPath = 'M 8 55 C 6 49, 8 45, 12 42 C 30 30, 64 28, 105 30 C 148 33, 183 43, 192 55 C 183 67, 148 77, 105 80 C 64 82, 30 78, 12 66 C 8 62, 6 59, 8 55 Z';

    var svg =
    '<svg viewBox="0 0 240 110" width="' + svgW + '" height="' + svgH + '" xmlns="http://www.w3.org/2000/svg">' +

    '<defs>' +
      '<clipPath id="' + id + '-body">' +
        '<path d="' + bodyPath + '"/>' +
      '</clipPath>' +
    '</defs>' +

    // ──── Subtle shadow ────────────────────────────────────────────────
    '<ellipse cx="105" cy="60" rx="72" ry="18" fill="rgba(0,0,0,0.08)" transform="translate(4,4)"/>' +

    // ──── Body ────────────────────────────────────────────────────────
    '<path d="' + bodyPath + '" fill="' + p.body + '"/>' +

    // ──── Patches (clipped to body) ────────────────────────────────────
    '<g clip-path="url(#' + id + '-body)">' +
      '<path d="' + p1_1 + '" fill="' + c1 + '" opacity="0.9"/>' +
      '<path d="' + p1_2 + '" fill="' + c1 + '" opacity="0.85"/>' +
      '<path d="' + p1_3 + '" fill="' + c1 + '" opacity="0.8"/>' +
      '<path d="' + p1_4 + '" fill="' + c1 + '" opacity="0.75"/>' +
      '<path d="' + p2_1 + '" fill="' + c2 + '" opacity="0.85"/>' +
      '<path d="' + p2_2 + '" fill="' + c2 + '" opacity="0.8"/>' +
      '<path d="' + p2_3 + '" fill="' + c2 + '" opacity="0.75"/>' +
    '</g>' +

    //      Bottom pectoral fin
    '<path d="M 62 79 L 96 108 L 90 80 Z" fill="' + p.fin + '" opacity="0.7"/>' +
    //      Top pectoral fin (mirrored)
    '<path d="M 62 30 L 96 2 L 90 30.5 Z" fill="' + p.fin + '" opacity="0.7"/>' +

    //      Bottom rear fin
    '<path d="M 136 76 L 156 90 L 150 74 Z" fill="' + p.fin + '" opacity="0.55"/>' +
    //      Top rear fin (mirrored)
    '<path d="M 136 36 L 156 20 L 150 36 Z" fill="' + p.fin + '" opacity="0.55"/>' +

    // ──── Midline ─────────────────────────────────────────────────────
    '<line x1="14" y1="55" x2="194" y2="55" stroke="rgba(0,0,0,0.04)" stroke-width="0.8"/>' +

    // ──── Gill arc ────────────────────────────────────────────────────
    '<path d="M 46 38 C 40 44, 40 66, 46 72" fill="none" stroke="rgba(0,0,0,0.1)" stroke-width="1.2"/>' +

    // ──── Eyes ─ oval, slightly adjusted per request
    '<ellipse cx="27" cy="38" rx="2.8" ry="4.2" fill="#1a1a1a" transform="rotate(70, 28, 39)"/>' +
    '<ellipse cx="28" cy="70" rx="2.8" ry="4.2" fill="#1a1a1a" transform="rotate(-70, 28, 70)"/>' +

    // ──── Barbels ─────────────────────────────────────────────────────
    '<path d="M 6 60 C 8 62, 9 66, 10 70" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1" stroke-linecap="round"/>' +
    // Top barbel (mirrored over the fish midline y = 55)
    '<path d="M 4 47 C 8 45, 9 41, 10 37" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1" stroke-linecap="round"/>' +
    // ──── Snout cover — adjusted downward by 1px
    '<ellipse cx="15" cy="52" rx="13" ry="10" fill="' + p.body + '" transform="rotate(-4, 15, 52)"/>' +

    // ──── Head highlight (very subtle) ────────────────────────────────
    '<ellipse cx="36" cy="55" rx="14" ry="9" fill="white" opacity="0.05"/>' +

    // ──── Tail (drawn on top to guarantee full white coverage) ──────────
     '<path d="M 180 48 C 193 40, 205 30, 219 20 C 211 36, 203 46, 197 52" fill="' + p.body + '" stroke="' + p.body + '" stroke-width="0.1"/>' +
    '<path d="M 180 62 C 193 70, 205 80, 219 90 C 211 74, 203 64, 197 58" fill="' + p.body + '" stroke="' + p.body + '" stroke-width="0.1"/>' +
    '<path d="M 185 50 C 197 42, 207 32, 215 22 C 211 40, 211 70, 215 88 C 207 78, 197 68, 185 60 Z" fill="' + p.body + '" opacity="1"/>' +
    // ──── Fin & tail stripes (decorative lines) ────────────────────────
    // Pectoral fin stripes (bottom)
    '<line x1="68" y1="83" x2="88" y2="95" stroke="rgba(0,0,0,0.15)" stroke-width="0.8" stroke-linecap="round"/>' +
    '<line x1="74" y1="79" x2="90" y2="88" stroke="rgba(0,0,0,0.1)" stroke-width="0.7" stroke-linecap="round"/>' +
    // Pectoral fin stripes (top)
    '<line x1="68" y1="27" x2="88" y2="15" stroke="rgba(0,0,0,0.15)" stroke-width="0.8" stroke-linecap="round"/>' +
    '<line x1="74" y1="31" x2="90" y2="22" stroke="rgba(0,0,0,0.1)" stroke-width="0.7" stroke-linecap="round"/>' +
    // Rear fin stripes (bottom)
    '<line x1="141" y1="79" x2="154" y2="87" stroke="rgba(0,0,0,0.12)" stroke-width="0.7" stroke-linecap="round"/>' +
    // Rear fin stripes (top)
    '<line x1="141" y1="31" x2="154" y2="23" stroke="rgba(0,0,0,0.12)" stroke-width="0.7" stroke-linecap="round"/>' +
    // Tail stripes (radiating fan pattern, straight lines)
    '<line x1="187" y1="48" x2="218" y2="28" stroke="rgba(0,0,0,0.15)" stroke-width="0.8" stroke-linecap="round"/>' +
    '<line x1="189" y1="47" x2="220" y2="32" stroke="rgba(0,0,0,0.12)" stroke-width="0.75" stroke-linecap="round"/>' +
    '<line x1="192" y1="46" x2="222" y2="36" stroke="rgba(0,0,0,0.1)" stroke-width="0.7" stroke-linecap="round"/>' +
    '<line x1="194" y1="52" x2="222" y2="48" stroke="rgba(0,0,0,0.08)" stroke-width="0.65" stroke-linecap="round"/>' +
    '<line x1="194" y1="58" x2="222" y2="62" stroke="rgba(0,0,0,0.08)" stroke-width="0.65" stroke-linecap="round"/>' +
    '<line x1="192" y1="64" x2="222" y2="74" stroke="rgba(0,0,0,0.1)" stroke-width="0.7" stroke-linecap="round"/>' +
    '<line x1="189" y1="63" x2="220" y2="78" stroke="rgba(0,0,0,0.12)" stroke-width="0.75" stroke-linecap="round"/>' +
    '<line x1="186" y1="62" x2="218" y2="82" stroke="rgba(0,0,0,0.15)" stroke-width="0.8" stroke-linecap="round"/>' +
    

    '</svg>';

    return svg;
  }

  // Generate a smooth organic blob using cubic bezier curves
  function smoothBlob(cx, cy, r) {
    var n = 6 + Math.floor(Math.random() * 3);
    var pts = [];
    for (var i = 0; i < n; i++) {
      var angle = (i / n) * Math.PI * 2;
      var rr = r * (0.65 + Math.random() * 0.55);
      pts.push({ x: cx + Math.cos(angle) * rr, y: cy + Math.sin(angle) * rr });
    }
    // Build smooth closed path with cubic bezier
    var d = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    for (var i = 0; i < n; i++) {
      var curr = pts[i];
      var next = pts[(i + 1) % n];
      var cpx1 = curr.x + (next.x - pts[(i - 1 + n) % n].x) * 0.2;
      var cpy1 = curr.y + (next.y - pts[(i - 1 + n) % n].y) * 0.2;
      var cpx2 = next.x - (pts[(i + 2) % n].x - curr.x) * 0.2;
      var cpy2 = next.y - (pts[(i + 2) % n].y - curr.y) * 0.2;
      d += ' C ' + cpx1.toFixed(1) + ' ' + cpy1.toFixed(1) + ', ' +
           cpx2.toFixed(1) + ' ' + cpy2.toFixed(1) + ', ' +
           next.x.toFixed(1) + ' ' + next.y.toFixed(1);
    }
    d += ' Z';
    return d;
  }

  // ─────────────────────────────────────────────────────────
  //  LOTUS LEAF SVG GENERATOR
  // ─────────────────────────────────────────────────────────
  function makeLotusLeafSVG() {
    var lid = 'lotus' + Date.now() + Math.floor(Math.random() * 9999);
    var cx = 60, cy = 60, r = 48;
    // Compute the angles of the two notch edges (lines from center to original notch points)
    var a0 = Math.atan2(8 - cy, 52 - cx); // left notch edge  ≈ -98.7°
    var a1 = Math.atan2(8 - cy, 68 - cx); // right notch edge ≈ -81.3°
    // Polygon: start at center, trace the large arc clockwise from right-notch to left-notch, close
    var span = (a0 + 2 * Math.PI) - a1;   // ≈342° — the leaf portion
    var d = 'M ' + cx + ' ' + cy;
    for (var i = 0; i <= 64; i++) {
      var a = a1 + (i / 64) * span;
      d += ' L ' + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1);
    }
    d += ' Z';
    return '<svg viewBox="0 0 120 120" width="180" height="180" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><clipPath id="' + lid + '-c"><path d="' + d + '"/></clipPath></defs>' +
      '<circle cx="64" cy="64" r="48" fill="rgba(0,0,0,0.1)"/>' +
      '<path d="' + d + '" fill="#3a9d50" stroke="#2e8040" stroke-width="1"/>' +
      '<circle cx="60" cy="60" r="40" fill="none" stroke="rgba(120,220,120,0.15)" stroke-width="1" clip-path="url(#' + lid + '-c)"/>' +
      '<g clip-path="url(#' + lid + '-c)" opacity="0.35">' +
        '<line x1="60" y1="60" x2="60" y2="14" stroke="#6abf6a" stroke-width="1"/>' +
        '<line x1="60" y1="60" x2="26" y2="32" stroke="#6abf6a" stroke-width="0.8"/>' +
        '<line x1="60" y1="60" x2="94" y2="32" stroke="#6abf6a" stroke-width="0.8"/>' +
        '<line x1="60" y1="60" x2="14" y2="56" stroke="#6abf6a" stroke-width="0.7"/>' +
        '<line x1="60" y1="60" x2="106" y2="56" stroke="#6abf6a" stroke-width="0.7"/>' +
        '<line x1="60" y1="60" x2="30" y2="90" stroke="#6abf6a" stroke-width="0.7"/>' +
        '<line x1="60" y1="60" x2="90" y2="90" stroke="#6abf6a" stroke-width="0.7"/>' +
        '<line x1="60" y1="60" x2="60" y2="106" stroke="#6abf6a" stroke-width="0.7"/>' +
      '</g>' +
      '<circle cx="60" cy="60" r="3" fill="rgba(120,200,120,0.3)"/>' +
    '</svg>';
  }

  // ─────────────────────────────────────────────────────────
  //  WEBGAZER
  // ─────────────────────────────────────────────────────────
  var _settingsInited = false;
  function startWebgazer() {
    showScreen('screen-calibrating');
    elCalMsg.textContent = 'Initialising eye tracker…';
    if (!_settingsInited) { initSettings(); _settingsInited = true; }

    setTimeout(async function () {
      try {
        if (typeof webgazer === 'undefined') throw new Error('webgazer.js not loaded');
        if (webgazer.params && typeof webgazer.params === 'object') {
          webgazer.params.faceMeshSolutionPath =
            'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';
        }
        if (typeof webgazer.setRegression          === 'function') webgazer.setRegression('ridge');
        if (typeof webgazer.setTracker             === 'function') webgazer.setTracker('TFFacemesh');
        if (typeof webgazer.applyKalmanFilter      === 'function') webgazer.applyKalmanFilter(true);
        if (typeof webgazer.saveDataAcrossSessions === 'function') webgazer.saveDataAcrossSessions(true);
        if (typeof webgazer.showPredictionPoints   === 'function') webgazer.showPredictionPoints(false);
        if (typeof webgazer.showVideoPreview       === 'function') webgazer.showVideoPreview(true);
        if (typeof webgazer.showFaceOverlay        === 'function') webgazer.showFaceOverlay(false);
        if (typeof webgazer.showFaceFeedbackBox    === 'function') webgazer.showFaceFeedbackBox(false);

        await webgazer.begin();
        webgazer.setGazeListener(gazeListener);

        ['webgazerVideoContainer','webgazerFaceOverlay','webgazerFaceFeedbackBox'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
        if (typeof webgazer.removeMouseEventListeners === 'function') {
          webgazer.removeMouseEventListeners();
        }

        G.webgazerReady = true;
        elCalMsg.textContent = 'Eye tracker ready. Launching pond…';
        setTimeout(startGame, 1200);
      } catch (err) {
        elCalMsg.textContent = 'Camera error: ' + ((err && err.message) || String(err));
      }
    }, 80);
  }

  function gazeListener(data) {
    if (!data) return;
    G.gazeX = data.x;
    G.gazeY = data.y;
    if (elGazeDot.classList.contains('visible')) {
      elGazeDot.style.left = data.x + 'px';
      elGazeDot.style.top  = data.y + 'px';
    }
  }

  // ─────────────────────────────────────────────────────────
  //  GAME FLOW
  // ─────────────────────────────────────────────────────────
  function startGame() {
    G.score      = 0;
    G.streak     = 0;
    G.bestStreak = 0;
    G.windowMs   = INIT_WINDOW_MS;
    G.interMs    = INIT_INTER_MS;
    G.state      = 'IDLE';
    G.pressed    = false;
    G.lives      = 3;

    clearSpawnZone();
    resetTimerRing();
    renderLives();
    updateHUD();
    showScreen('screen-game');
    SettingsPanel.show();

    scheduleNext(700);
  }

  function scheduleNext(delay) {
    G.state   = 'WAITING';
    G.pressed = false;
    clearTimers();
    clearSpawnZone();
    resetTimerRing();

    G.scheduleTimer = setTimeout(spawnItem, delay);
  }

  // ─────────────────────────────────────────────────────────
  //  SPAWN ITEM
  // ─────────────────────────────────────────────────────────
  function spawnItem() {
    G.isNoGo   = Math.random() < NOGO_CHANCE;
    G.pressed  = false;
    G.state    = 'ACTIVE';
    G.roundStart = Date.now();

    clearSpawnZone();

    var sprite;
    if (G.isNoGo) {
      // Lotus leaf
      sprite = document.createElement('div');
      sprite.className = 'lotus-sprite spawning';
      sprite.innerHTML = makeLotusLeafSVG();
      sprite.id = 'active-item';
    } else {
      // Koi fish
      sprite = document.createElement('div');
      sprite.className = 'koi-sprite spawning';
      sprite.innerHTML = makeKoiSVG();
      sprite.id = 'active-item';
    }

    elSpawnZone.appendChild(sprite);

    // After spawn animation → idle wiggle
    setTimeout(function () {
      if (G.state === 'ACTIVE' && sprite.parentNode) {
        sprite.className = (G.isNoGo ? 'lotus-sprite' : 'koi-sprite') + ' idle';
      }
    }, G.isNoGo ? 400 : 350);

    // Timer ring animation
    startTimerAnimation();

    // Timeout — window expired
    G.windowTimer = setTimeout(function () {
      if (G.state !== 'ACTIVE') return;

      if (G.isNoGo) {
        // Correctly ignored lotus leaf
        resolveCorrectIgnore();
      } else {
        // Failed to catch fish (omission)
        resolveFail('omission');
      }
    }, G.windowMs);
  }

  // ─────────────────────────────────────────────────────────
  //  SPACEBAR HANDLER
  // ─────────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    e.preventDefault();

    if (G.state !== 'ACTIVE' || G.pressed) return;
    G.pressed = true;

    if (G.isNoGo) {
      resolveFail('commission');
    } else {
      resolveCatch();
    }
  });

  // Tap anywhere on the game screen to scoop (mobile & desktop)
  var elScreenGame = document.getElementById('screen-game');
  if (elScreenGame) {
    elScreenGame.addEventListener('pointerdown', function(e) {
      if (G.state !== 'ACTIVE' || G.pressed) return;
      G.pressed = true;
      if (G.isNoGo) { resolveFail('commission'); } else { resolveCatch(); }
    });
  }

  // ─────────────────────────────────────────────────────────
  //  RESOLVE: SUCCESSFUL CATCH
  // ─────────────────────────────────────────────────────────
  function resolveCatch() {
    if (G.state !== 'ACTIVE') return;
    G.state = 'RESOLVING';
    clearTimers();
    cancelTimerAnimation();

    G.score++;
    G.streak++;
    if (G.streak > G.bestStreak) G.bestStreak = G.streak;
    if (G.score > G.best) {
      G.best = G.score;
      try { localStorage.setItem('gf_best', String(G.best)); } catch(e) {}
    }

    // Speed up
    G.windowMs = Math.max(MIN_WINDOW_MS, G.windowMs - WINDOW_DECAY_MS);
    G.interMs  = Math.max(MIN_INTER_MS,  G.interMs  - INTER_DECAY_MS);

    updateHUD();

    // Net scoop animation
    elNet.classList.remove('scooping', 'miss-shake');
    void elNet.offsetWidth;
    elNet.classList.add('scooping');

    // Fish caught animation
    var item = $('active-item');
    if (item) item.className = 'koi-sprite caught';

    // Water splash + droplets
    spawnSplash();
    spawnDroplets();

    // Screen flash
    triggerFlash(elSuccFlash);

    // Timer ring turns green
    elTimerRing.style.stroke = '#4cd964';
    elTimerRing.style.strokeDashoffset = '0';

    // Feedback label
    showFeedback('🐟 Scooped!', 'catch');

    // Combo milestone
    if (COMBO_MILESTONES.indexOf(G.streak) !== -1) showCombo(G.streak);

    // Speed label every 5
    if (G.score > 0 && G.score % 5 === 0) showSpeedLabel();

    // Particles
    spawnCatchParticles();

    setTimeout(function () {
      elNet.classList.remove('scooping');
      scheduleNext(G.interMs);
    }, 500);
  }

  // ─────────────────────────────────────────────────────────
  //  RESOLVE: CORRECT IGNORE (lotus drifted away)
  // ─────────────────────────────────────────────────────────
  function resolveCorrectIgnore() {
    if (G.state !== 'ACTIVE') return;
    G.state = 'RESOLVING';
    clearTimers();
    cancelTimerAnimation();

    G.score++;
    G.streak++;
    if (G.streak > G.bestStreak) G.bestStreak = G.streak;
    if (G.score > G.best) {
      G.best = G.score;
      try { localStorage.setItem('gf_best', String(G.best)); } catch(e) {}
    }

    // Speed up
    G.windowMs = Math.max(MIN_WINDOW_MS, G.windowMs - WINDOW_DECAY_MS);
    G.interMs  = Math.max(MIN_INTER_MS,  G.interMs  - INTER_DECAY_MS);

    updateHUD();

    // Leaf drifts away
    var item = $('active-item');
    if (item) item.className = 'lotus-sprite drifted';

    elTimerRing.style.stroke = '#34d399';
    elTimerRing.style.strokeDashoffset = '0';

    showFeedback('🍃 Good eye!', 'ignore');

    if (COMBO_MILESTONES.indexOf(G.streak) !== -1) showCombo(G.streak);
    if (G.score > 0 && G.score % 5 === 0) showSpeedLabel();

    setTimeout(function () {
      scheduleNext(G.interMs);
    }, 500);
  }

  // ─────────────────────────────────────────────────────────
  //  RESOLVE: FAIL
  // ─────────────────────────────────────────────────────────
  function resolveFail(reason) {
    if (G.state !== 'ACTIVE') return;
    G.state = 'RESOLVING';
    clearTimers();
    cancelTimerAnimation();

    G.streak = 0;
    G.lives--;
    renderLives();
    updateHUD();

    var item = $('active-item');

    if (reason === 'commission') {
      elNet.classList.remove('scooping', 'miss-shake');
      void elNet.offsetWidth;
      elNet.classList.add('scooping');
      if (item) item.className = 'lotus-sprite scooped-fail';
      showFeedback('🍃 Oops! -1 life', 'fail');
    } else {
      elNet.classList.remove('scooping', 'miss-shake');
      void elNet.offsetWidth;
      elNet.classList.add('miss-shake');
      if (item) item.className = 'koi-sprite escaped';
      showFeedback('💨 Too slow! -1 life', 'fail');
    }

    triggerFlash(elFailFlash);

    if (G.lives <= 0) {
      G.state = 'OVER';
      setTimeout(function () {
        elNet.classList.remove('scooping', 'miss-shake');
        showGameOver(reason);
      }, 700);
    } else {
      setTimeout(function () {
        elNet.classList.remove('scooping', 'miss-shake');
        scheduleNext(G.interMs);
      }, 700);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  GAME OVER
  // ─────────────────────────────────────────────────────────
  function showGameOver(reason) {
    var reasons = {
      commission: '🍃 You scooped too many lotus leaves!',
      omission:   '🐟 Too many fish escaped — stay focused!',
    };
    var subs = {
      commission: 'Train your impulse control — only press Space for koi fish, never for lotus leaves!',
      omission:   'The reaction window closed too many times. React faster before time runs out!',
    };
    var icons = { commission: '🍃', omission: '🐟' };

    var goTitle = $('go-title');
    if (goTitle) goTitle.textContent = 'Out of Lives!';

    var goIconEl = $('go-icon');
    if (reason === 'omission') {
      goIconEl.innerHTML = makeKoiSVG(200, 92);
    } else {
      goIconEl.textContent = icons[reason] || '🐟';
    }
    $('go-reason').textContent = reasons[reason]  || '';
    $('go-sub').textContent    = subs[reason]     || '';
    $('go-score').textContent  = String(G.score);
    $('go-streak').textContent = String(G.bestStreak);
    $('go-best').textContent   = String(G.best);

    clearSpawnZone();
    showScreen('screen-gameover');
  }

  // ─────────────────────────────────────────────────────────
  //  TIMER ANIMATION
  // ─────────────────────────────────────────────────────────
  function startTimerAnimation() {
    resetTimerRing();
    G.roundStart = Date.now();

    function tick() {
      var elapsed  = Date.now() - G.roundStart;
      var fraction = Math.max(0, 1 - elapsed / G.windowMs);
      var offset   = TIMER_CIRC * (1 - fraction);
      elTimerRing.style.strokeDashoffset = String(offset);

      if (fraction > 0.55) {
        elTimerRing.style.stroke = '#34d399';
      } else if (fraction > 0.25) {
        elTimerRing.style.stroke = '#ffaa00';
      } else {
        elTimerRing.style.stroke = '#ff3b30';
      }

      if (G.state === 'ACTIVE') {
        G.timerRafId = requestAnimationFrame(tick);
      }
    }
    G.timerRafId = requestAnimationFrame(tick);
  }

  function cancelTimerAnimation() {
    if (G.timerRafId) { cancelAnimationFrame(G.timerRafId); G.timerRafId = null; }
  }

  function resetTimerRing() {
    elTimerRing.style.strokeDashoffset = '0';
    elTimerRing.style.stroke = '#34d399';
  }

  // ─────────────────────────────────────────────────────────
  //  VISUAL FX
  // ─────────────────────────────────────────────────────────
  function spawnSplash() {
    var netRect = elNet.getBoundingClientRect();
    var cx = netRect.left + netRect.width * 0.5;
    var cy = netRect.top  + netRect.height * 0.35;
    for (var i = 0; i < 2; i++) {
      var ring = document.createElement('div');
      ring.className = 'splash-ring';
      ring.style.cssText = 'left:' + cx + 'px;top:' + cy + 'px;width:60px;height:30px;';
      if (i === 1) ring.style.animationDelay = '0.1s';
      document.body.appendChild(ring);
      setTimeout(function (r) { r.parentNode && r.parentNode.removeChild(r); }, 600, ring);
    }
  }

  function spawnDroplets() {
    var netRect = elNet.getBoundingClientRect();
    var cx = netRect.left + netRect.width * 0.5;
    var cy = netRect.top  + netRect.height * 0.3;
    for (var i = 0; i < 8; i++) {
      var d = document.createElement('div');
      d.className = 'droplet';
      var ox = (Math.random() - 0.5) * 80;
      var dur = 0.35 + Math.random() * 0.3;
      var dy = 30 + Math.random() * 50;
      d.style.cssText = 'left:' + (cx + ox) + 'px;top:' + cy + 'px;--dur:' + dur + 's;--dy:' + dy + 'px;';
      document.body.appendChild(d);
      setTimeout(function (e) { e.parentNode && e.parentNode.removeChild(e); }, dur * 1000 + 50, d);
    }
  }

  function spawnCatchParticles() {
    var netRect = elNet.getBoundingClientRect();
    var cx = netRect.left + netRect.width * 0.5;
    var cy = netRect.top  + netRect.height * 0.35;
    var colors = ['#34d399','#059669','#fff','#4cd964','#ffcc00','#ff9500'];
    for (var i = 0; i < 14; i++) {
      var p = document.createElement('div');
      p.className = 'burst-p';
      var angle = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      var dist  = 40 + Math.random() * 60;
      var size  = 3 + Math.random() * 5;
      var dur   = 0.45 + Math.random() * 0.35;
      p.style.cssText =
        'left:' + cx + 'px;top:' + cy + 'px;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'background:' + colors[Math.floor(Math.random() * colors.length)] + ';' +
        '--bx:' + Math.round(Math.cos(angle) * dist) + 'px;' +
        '--by:' + Math.round(Math.sin(angle) * dist) + 'px;' +
        '--dur:' + dur + 's;';
      document.body.appendChild(p);
      setTimeout(function (e) { e.parentNode && e.parentNode.removeChild(e); }, dur * 1000 + 50, p);
    }
  }

  function clearSpawnZone() {
    elSpawnZone.innerHTML = '';
  }

  function triggerFlash(el) {
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 600);
  }

  function showFeedback(text, type) {
    elFeedback.textContent = text;
    elFeedback.className = '';
    void elFeedback.offsetWidth;
    elFeedback.classList.add('show-' + type);
    setTimeout(function () { elFeedback.className = ''; }, 800);
  }

  function showCombo(n) {
    elCombo.textContent = n + '× COMBO!';
    elCombo.classList.remove('show');
    void elCombo.offsetWidth;
    elCombo.classList.add('show');
    setTimeout(function () { elCombo.classList.remove('show'); }, 950);
  }

  function showSpeedLabel() {
    elSpeed.classList.remove('show');
    void elSpeed.offsetWidth;
    elSpeed.classList.add('show');
    setTimeout(function () { elSpeed.classList.remove('show'); }, 1500);
  }

  function updateHUD() {
    elHudScore.textContent  = String(G.score);
    elHudStreak.textContent = String(G.streak);
    elHudBest.textContent   = String(G.best);
    var speed = (INIT_WINDOW_MS / G.windowMs).toFixed(1);
    elHudSpeed.textContent  = speed + '×';

    if (G.streak >= 10) {
      elHudStreak.className = 'hud-value combo-fire';
    } else {
      elHudStreak.className = 'hud-value';
    }
  }

  function renderLives() {
    for (var i = 0; i < 3; i++) {
      var icon = $('life-' + i);
      if (icon) icon.classList.toggle('lost', i >= G.lives);
    }
  }

  function clearTimers() {
    clearTimeout(G.scheduleTimer);
    clearTimeout(G.windowTimer);
    G.scheduleTimer = null;
    G.windowTimer   = null;
  }

  // ─────────────────────────────────────────────────────────
  //  SETTINGS PANEL
  // ─────────────────────────────────────────────────────────
  function initSettings() {
    SettingsPanel.init({
      alwaysVisible: false,
      panelLabel: 'Settings',
      sections: [
        {
          type: 'buttons',
          items: [
            { id: 'dashboard', label: '← Dashboard', onClick: function () { window.location.href = 'dashboard.html'; } }
          ]
        },
        { type: 'divider' },
        {
          type: 'toggle', id: 'gaze-dot', label: 'Gaze dot', initial: false,
          onChange: function (on) { elGazeDot.classList.toggle('visible', on); }
        },
        {
          type: 'toggle', id: 'camera', label: 'Camera preview', initial: false,
          onChange: function (on) {
            var vid = document.getElementById('webgazerVideoContainer');
            if (vid) vid.style.display = on ? 'block' : 'none';
            if (typeof webgazer.showFaceOverlay === 'function') webgazer.showFaceOverlay(on);
          }
        }
      ]
    });
  }

  // ─────────────────────────────────────────────────────────
  //  BUTTON BINDINGS
  // ─────────────────────────────────────────────────────────
  $('btn-start').addEventListener('click', function () {
    startWebgazer();
  });

  $('btn-retry').addEventListener('click', function () {
    if (!G.webgazerReady) { startWebgazer(); return; }
    if (G.webgazerPaused && typeof webgazer.resume === 'function') {
      webgazer.resume();
      G.webgazerPaused = false;
    }
    startGame();
  });

  $('btn-menu').addEventListener('click', function () {
    showScreen('screen-intro');
    SettingsPanel.hide();
    clearTimers();
    cancelTimerAnimation();
    G.state = 'IDLE';
    if (G.webgazerReady) { webgazer.pause(); G.webgazerPaused = true; }
  });

  // ─────────────────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────────────────
  updateHUD();

})();
