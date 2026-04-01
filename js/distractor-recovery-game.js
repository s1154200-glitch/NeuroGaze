(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function showScreen(name) {
    ['intro','calibrating','game','gameover'].forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === name);
    });
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ── CONFIG ──────────────────────────────────────────────
  var HIT_RADIUS        = 160;    // px — gaze must be within this of reticle center
  var INIT_LOOK_AWAY_MS = 3000;   // starting allowable off-target time before game over
  var MIN_LOOK_AWAY_MS  = 800;    // minimum allowable (hardest)
  var LOOK_DECAY_RATE   = 40;     // ms tighter per second survived
  var INIT_DISTRACT_INT = 5000;   // ms between distractors initially
  var MIN_DISTRACT_INT  = 1200;   // fastest distractor rate
  var DISTRACT_DECAY    = 100;    // ms faster per second survived
  var FIRE_DECAY_RATE   = 3;      // fire % gained per second while off-target
  var FIRE_SPRAY_RATE   = 8;      // fire % extinguished per second while on-target
  var RETICLE_SPEED     = 25;     // px/s — how fast the reticle drifts

  // Window positions as fractions of building-wrap rect (SVG viewBox 0 0 320 520)
  // Column x centres: 77,160,243 → /320; Row y centres: 138,218,298 → /520
  var FIRE_SPOT_DEFS = [
    { px: 0.241, py: 0.265 },  { px: 0.500, py: 0.265 },  { px: 0.759, py: 0.265 },
    { px: 0.241, py: 0.419 },  { px: 0.500, py: 0.419 },  { px: 0.759, py: 0.419 },
    { px: 0.241, py: 0.573 },  { px: 0.500, py: 0.573 },  { px: 0.759, py: 0.573 },
  ];
  var FIRE_HIT_RADIUS = 55;    // px — reticle must be within this of a spot to extinguish it

  // ── STATE ───────────────────────────────────────────────
  var G = {
    active: false,
    gazeX: 0, gazeY: 0,
    onTarget: false,
    fireLevel: 100,          // 100% = fully burning, 0% = extinguished (never fully reaches 0 — always some fire)
    survivalMs: 0,
    lookAwayMs: 0,           // accumulated off-target time this penalty window
    maxLookAway: INIT_LOOK_AWAY_MS,
    distractorsResisted: 0,
    distractorTimer: null,
    distractorInterval: INIT_DISTRACT_INT,
    lastTick: 0,
    rafId: null,
    calDone: false,
    best: 0,

    // Reticle position (absolute px)
    retX: 0, retY: 0,
    retTargetX: 0, retTargetY: 0,
    fireSpots: [],
  };

  // ── Best score ──────────────────────────────────────────
  function loadBest() {
    try { G.best = parseFloat(localStorage.getItem('firefighter_best') || '0') || 0; } catch(e) {}
  }
  function saveBest() {
    try { localStorage.setItem('firefighter_best', String(G.best)); } catch(e) {}
  }

  // ── Building positioning ────────────────────────────────
  var BLDG_W = 320, BLDG_H = 520;

  function positionBuilding() {
    var bw = $('building-wrap');
    var scale = Math.min(window.innerHeight * 0.72 / BLDG_H, window.innerWidth * 0.4 / BLDG_W, 1);
    bw.style.width  = (BLDG_W * scale) + 'px';
    bw.style.height = (BLDG_H * scale) + 'px';
    var svg = $('building-svg');
    svg.style.width  = '100%';
    svg.style.height = '100%';
    return scale;
  }

  // ── Fire flame generation ───────────────────────────────
  function buildFire() {
    // Remove old fire spot elements from DOM
    (G.fireSpots || []).forEach(function(s) {
      clearTimeout(s.relight_timeout);
      if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    });
    G.fireSpots = [];

    var rect = $('building-wrap').getBoundingClientRect();
    var game = $('screen-game');

    FIRE_SPOT_DEFS.forEach(function(def) {
      var sx = rect.left + def.px * rect.width;
      var sy = rect.top  + def.py * rect.height;

      var el = document.createElement('div');
      el.className = 'fire-spot';
      el.style.left = sx + 'px';
      el.style.top  = sy + 'px';

      // 4 flames per window spot
      for (var j = 0; j < 4; j++) {
        var f = document.createElement('div');
        f.className = 'flame';
        var w = rand(14, 28), h = rand(28, 52);
        f.style.cssText = [
          'left:'    + rand(-12, 12).toFixed(0) + 'px',
          'bottom:0',
          'position:absolute',
          'width:'   + w + 'px',
          'height:'  + h + 'px',
          'background:radial-gradient(ellipse at 50% 80%,' +
            'rgba(255,255,100,0.92) 0%,' +
            'rgba(255,160,0,0.85) 30%,' +
            'rgba(255,80,0,0.65) 60%,' +
            'rgba(200,30,0,0.3) 100%)',
          '--dur:'   + rand(0.3, 0.65).toFixed(2) + 's',
          '--sx:'    + rand(-5, 5).toFixed(1) + 'px',
          '--oa:'    + rand(0.75, 0.95).toFixed(2),
          '--ob:1',
        ].join(';');
        el.appendChild(f);
      }

      // 3 embers per spot
      for (var k = 0; k < 3; k++) {
        var e = document.createElement('div');
        e.className = 'ember';
        e.style.cssText = [
          'left:'    + rand(-10, 10).toFixed(0) + 'px',
          'bottom:2px',
          'position:absolute',
          'width:'   + rand(2, 5).toFixed(0) + 'px',
          'height:'  + rand(2, 5).toFixed(0) + 'px',
          'background:' + pick(['#ff6600','#ff9900','#ffcc00','#ff4400']),
          '--dur:'   + rand(1.2, 2.8).toFixed(1) + 's',
          '--delay:' + rand(0, 2).toFixed(1) + 's',
          '--ex:'    + rand(-25, 25).toFixed(0) + 'px',
          '--ey:'    + rand(-55, -120).toFixed(0) + 'px',
        ].join(';');
        el.appendChild(e);
      }

      // Orange glow halo
      var glow = document.createElement('div');
      glow.style.cssText = [
        'position:absolute',
        'left:50%', 'top:50%',
        'transform:translate(-50%,-50%)',
        'width:80px', 'height:80px',
        'border-radius:50%',
        'background:radial-gradient(circle,rgba(255,130,0,0.45) 0%,transparent 72%)',
      ].join(';');
      el.appendChild(glow);

      game.appendChild(el);

      G.fireSpots.push({
        def: def,
        el: el,
        screenX: sx,
        screenY: sy,
        burning: true,
        relight_timeout: null,
      });
    });
  }

  // ── Ember particles ─────────────────────────────────────
  function buildEmbers() {
    // Embers are now embedded within individual fire spots (see buildFire)
    $('ember-container').innerHTML = '';
  }

  // ── Fire truck decoration positioning ───────────────────
  function positionFiretruck() {
    var rect = $('building-wrap').getBoundingClientRect();
    var ft = $('firetruck-wrap');
    var truckW = 240;
    var gap = 16;
    var leftPos = rect.right + gap;
    if (leftPos + truckW > window.innerWidth - 4) {
      leftPos = window.innerWidth - truckW - 4;
    }
    ft.style.left = leftPos + 'px';
  }

  // ── Water spray effect ───────────────────────────────────
  function buildWaterSpray() {
    var ws = $('water-spray');
    ws.innerHTML = '';
    ws.style.width  = '320px';
    ws.style.height = '240px';

    // Bright nozzle head
    var core = document.createElement('div');
    core.className = 'spray-core';
    ws.appendChild(core);

    // Fine spray drops – flat squares with rounded corners
    for (var i = 0; i < 42; i++) {
      var d = document.createElement('div');
      d.className = 'spray-drop';
      var angle = rand(-75, 75);
      var travel = rand(60, 200);
      var dx = travel * Math.sin(angle * Math.PI / 180);
      var dy = travel * Math.cos(angle * Math.PI / 180);
      var w = rand(4, 10);
      var h = rand(14, 38);
      d.style.cssText = [
        'left:50%',
        'top:10px',
        'transform:translateX(-50%)',
        'width:' + w + 'px',
        'height:' + h + 'px',
        '--dur:' + rand(0.18, 0.55).toFixed(2) + 's',
        '--delay:' + rand(0, 0.48).toFixed(2) + 's',
        '--dx:' + dx.toFixed(0) + 'px',
        '--fall:' + dy.toFixed(0) + 'px',
      ].join(';');
      ws.appendChild(d);
    }

    // Large splash globules – flat circles
    for (var j = 0; j < 12; j++) {
      var sp = document.createElement('div');
      sp.className = 'spray-splash';
      var sa = rand(-62, 62);
      var st = rand(100, 210);
      var size = rand(10, 22);
      sp.style.cssText = [
        'left:50%',
        'top:10px',
        'transform:translateX(-50%)',
        'width:' + size + 'px',
        'height:' + size + 'px',
        '--dur:' + rand(0.38, 0.78).toFixed(2) + 's',
        '--delay:' + rand(0, 0.58).toFixed(2) + 's',
        '--dx:' + (st * Math.sin(sa * Math.PI / 180)).toFixed(0) + 'px',
        '--fall:' + (st * Math.cos(sa * Math.PI / 180)).toFixed(0) + 'px',
      ].join(';');
      ws.appendChild(sp);
    }
  }

  // ── Reticle drift logic ─────────────────────────────────
  function pickReticleTarget() {
    // Target the nearest burning fire spot
    var nearest = null, nearestDist = Infinity;
    (G.fireSpots || []).forEach(function(spot) {
      if (!spot.burning) return;
      var dx = spot.screenX - G.retX;
      var dy = spot.screenY - G.retY;
      var d  = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) { nearestDist = d; nearest = spot; }
    });

    if (nearest) {
      G.retTargetX = nearest.screenX + rand(-18, 18);
      G.retTargetY = nearest.screenY + rand(-18, 18);
    } else {
      // All fires out — hover over building centre
      var rect = $('building-wrap').getBoundingClientRect();
      G.retTargetX = rect.left + rect.width  * 0.5;
      G.retTargetY = rect.top  + rect.height * 0.4;
    }
  }

  function initReticlePosition() {
    G.retX = window.innerWidth / 2;
    G.retY = window.innerHeight * 0.35;
    pickReticleTarget();
  }

  function updateReticlePosition(dtSec) {
    var dx = G.retTargetX - G.retX;
    var dy = G.retTargetY - G.retY;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 15) {
      pickReticleTarget();
      return;
    }

    var speed = RETICLE_SPEED * dtSec;
    G.retX += (dx / dist) * speed;
    G.retY += (dy / dist) * speed;

    // Keep within screen bounds
    G.retX = clamp(G.retX, 80, window.innerWidth - 80);
    G.retY = clamp(G.retY, 80, window.innerHeight - 80);

    var rw = $('reticle-wrap');
    rw.style.left = G.retX + 'px';
    rw.style.top  = G.retY + 'px';
    rw.style.transform = 'translate(-50%, -50%)';
  }

  // ── Fire spot helpers ────────────────────────────────────
  function computeFireSpotPositions() {
    var rect = $('building-wrap').getBoundingClientRect();
    (G.fireSpots || []).forEach(function(spot) {
      spot.screenX = rect.left + spot.def.px * rect.width;
      spot.screenY = rect.top  + spot.def.py * rect.height;
      if (spot.el) {
        spot.el.style.left = spot.screenX + 'px';
        spot.el.style.top  = spot.screenY + 'px';
      }
    });
  }

  function extinguishSpot(spot) {
    spot.burning = false;
    if (spot.el) {
      spot.el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      spot.el.style.opacity   = '0';
      spot.el.style.transform = 'translate(-50%, -60%) scale(0.2)';
    }
    clearTimeout(spot.relight_timeout);
    spot.relight_timeout = setTimeout(function() {
      if (!G.active) return;
      reigniteSpot(spot);
    }, rand(7000, 14000));
    updateFireLevel();
    pickReticleTarget();
  }

  function reigniteSpot(spot) {
    spot.burning = true;
    if (spot.el) {
      spot.el.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
      spot.el.style.opacity   = '1';
      spot.el.style.transform = 'translate(-50%, -50%) scale(1)';
    }
    updateFireLevel();
  }

  function updateFireLevel() {
    var n = 0;
    (G.fireSpots || []).forEach(function(s) { if (s.burning) n++; });
    var total = G.fireSpots ? G.fireSpots.length : 1;
    G.fireLevel = total > 0 ? Math.round(n / total * 100) : 0;
  }

  // ── Distractors ─────────────────────────────────────────
  var NEON_TEXTS = ['SALE!', 'WOW', 'LOOK!', 'FREE', 'HEY!', 'FLASH', 'NEW!', 'HOT!'];
  var NEON_CLASSES = ['neon-pink', 'neon-green', 'neon-blue'];

  function spawnDistractor() {
    if (!G.active) return;

    var type = pick(['heli', 'neon', 'debris', 'neon', 'debris']);
    var layer = $('distractor-layer');
    var el;

    if (type === 'heli') {
      el = document.createElement('div');
      el.className = 'distractor-heli';
      var fromLeft = Math.random() > 0.5;
      var y = rand(5, 35);
      el.style.top = y + '%';
      if (fromLeft) {
        el.style.left = '-160px';
        el.style.setProperty('--travel', (window.innerWidth + 320) + 'px');
      } else {
        el.style.right = '-160px';
        el.style.setProperty('--travel', '-' + (window.innerWidth + 320) + 'px');
      }
      el.style.setProperty('--dur', rand(3, 5).toFixed(1) + 's');
      el.innerHTML =
        '<div class="heli-body">' +
          '<div class="heli-tail"></div>' +
          '<div class="heli-rotor"></div>' +
          '<div class="heli-window"></div>' +
          '<div class="heli-light"></div>' +
        '</div>';
      layer.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.remove(); }, 6000);

    } else if (type === 'neon') {
      el = document.createElement('div');
      el.className = 'distractor-neon';
      var edge = pick(['left', 'right', 'top']);
      if (edge === 'left') {
        el.style.left = rand(2, 8) + '%';
        el.style.top  = rand(15, 75) + '%';
      } else if (edge === 'right') {
        el.style.right = rand(2, 8) + '%';
        el.style.top   = rand(15, 75) + '%';
      } else {
        el.style.left = rand(10, 80) + '%';
        el.style.top  = rand(3, 12) + '%';
      }
      var neonClass = pick(NEON_CLASSES);
      el.innerHTML = '<div class="neon-sign ' + neonClass + '">' + pick(NEON_TEXTS) + '</div>';
      layer.appendChild(el);
      setTimeout(function () {
        el.style.transition = 'opacity 0.4s';
        el.style.opacity = '0';
        setTimeout(function () { if (el.parentNode) el.remove(); }, 500);
      }, rand(1500, 3000));

    } else if (type === 'debris') {
      el = document.createElement('div');
      el.className = 'distractor-debris';
      el.style.left = rand(5, 90) + '%';
      el.style.top  = '-40px';
      var size = rand(16, 40);
      el.style.setProperty('--dur', rand(1.8, 3.5).toFixed(1) + 's');
      el.style.setProperty('--rot', rand(360, 1080).toFixed(0) + 'deg');
      el.innerHTML = '<div class="debris-chunk" style="--size:' + size.toFixed(0) + 'px"></div>';
      layer.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.remove(); }, 4000);
    }

    G.distractorsResisted++;
    scheduleNextDistractor();
  }

  function scheduleNextDistractor() {
    if (!G.active) return;
    var elapsed = G.survivalMs / 1000;
    G.distractorInterval = Math.max(MIN_DISTRACT_INT, INIT_DISTRACT_INT - elapsed * DISTRACT_DECAY);
    clearTimeout(G.distractorTimer);
    G.distractorTimer = setTimeout(spawnDistractor, G.distractorInterval * rand(0.7, 1.3));
  }

  // ── Game loop ──────────────────────────────────────────
  function startGame() {
    G.active            = true;
    G.fireLevel         = 100;
    G.survivalMs        = 0;
    G.lookAwayMs        = 0;
    G.maxLookAway       = INIT_LOOK_AWAY_MS;
    G.distractorsResisted = 0;
    G.onTarget          = false;
    G.distractorInterval = INIT_DISTRACT_INT;
    G.lastTick          = performance.now();

    // Clear old distractors
    $('distractor-layer').innerHTML = '';
    $('fire-spread').classList.remove('spreading');
    $('danger-vignette').classList.remove('active');

    positionBuilding();
    buildFire();
    buildWaterSpray();
    positionFiretruck();
    initReticlePosition();

    $('hud-time').textContent = '0s';
    $('hud-fire').textContent = '100%';
    $('hud-distractors').textContent = '0';
    $('hud-best').textContent = G.best.toFixed(1) + 's';
    $('gaze-hint').textContent = 'Lock your eyes on the reticle';
    $('gaze-hint').className = 'gaze-hint';
    $('water-spray').classList.remove('active');

    updateReticleVisual(false);

    scheduleNextDistractor();

    if (G.rafId) cancelAnimationFrame(G.rafId);
    G.rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!G.active) return;

    var dt = Math.min(now - G.lastTick, 100);
    G.lastTick = now;
    var dtSec = dt / 1000;

    G.survivalMs += dt;

    // Update adaptive difficulty
    var elapsed = G.survivalMs / 1000;
    G.maxLookAway = Math.max(MIN_LOOK_AWAY_MS, INIT_LOOK_AWAY_MS - elapsed * LOOK_DECAY_RATE);

    // Move reticle
    updateReticlePosition(dtSec);

    // Check gaze vs reticle
    var dx = G.gazeX - G.retX;
    var dy = G.gazeY - G.retY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var onTgt = dist <= HIT_RADIUS;

    if (onTgt !== G.onTarget) {
      G.onTarget = onTgt;
      updateReticleVisual(onTgt);

      if (onTgt) {
        G.lookAwayMs = 0;
        $('water-spray').classList.add('active');
        $('gaze-hint').textContent = 'Spraying water — keep it up!';
        $('gaze-hint').className = 'gaze-hint active';
        $('danger-vignette').classList.remove('active');
      } else {
        $('water-spray').classList.remove('active');
        $('gaze-hint').textContent = 'Eyes off reticle! Look back NOW!';
        $('gaze-hint').className = 'gaze-hint warning';
      }
    }

    // Position water spray at reticle (position:fixed via CSS, centred horizontally)
    var ws = $('water-spray');
    ws.style.left      = G.retX + 'px';
    ws.style.top       = (G.retY - 10) + 'px';
    ws.style.transform = 'translateX(-50%)';

    // Fire mechanics
    if (onTgt) {
      // Extinguish any burning fire spot the reticle is positioned over
      (G.fireSpots || []).forEach(function(spot) {
        if (!spot.burning) return;
        var sdx = G.retX - spot.screenX;
        var sdy = G.retY - spot.screenY;
        if (Math.sqrt(sdx * sdx + sdy * sdy) < FIRE_HIT_RADIUS) {
          extinguishSpot(spot);
        }
      });
    } else {
      // Accumulate look-away time
      G.lookAwayMs += dt;

      // Show danger vignette when getting close to limit
      if (G.lookAwayMs > G.maxLookAway * 0.5) {
        $('danger-vignette').classList.add('active');
      }

      // Game over check
      if (G.lookAwayMs >= G.maxLookAway) {
        gameOver();
        return;
      }
    }

    // HUD updates
    $('hud-time').textContent = (G.survivalMs / 1000).toFixed(1) + 's';
    $('hud-fire').textContent = Math.round(G.fireLevel) + '%';
    $('hud-fire').className = 'hud-value' + (G.fireLevel > 70 ? ' danger' : '');
    $('hud-distractors').textContent = G.distractorsResisted;

    G.rafId = requestAnimationFrame(tick);
  }

  function updateReticleVisual(on) {
    $('reticle-ring').className    = 'reticle-ring'    + (on ? ' on-target' : '');
    $('reticle-cross-h').className = 'reticle-cross-h' + (on ? ' on-target' : '');
    $('reticle-cross-v').className = 'reticle-cross-v' + (on ? ' on-target' : '');
    $('reticle-dot').className     = 'reticle-dot'     + (on ? ' on-target' : '');
  }

  function gameOver() {
    G.active = false;
    if (G.rafId) { cancelAnimationFrame(G.rafId); G.rafId = null; }
    clearTimeout(G.distractorTimer);
    (G.fireSpots || []).forEach(function(s) { clearTimeout(s.relight_timeout); });

    // Fire spreads animation
    $('fire-spread').classList.add('spreading');

    // Flash red
    var gs = $('screen-game');
    gs.style.animation = 'flashRed 0.6s ease-out 2';
    setTimeout(function () { gs.style.animation = ''; }, 1250);

    var survSec = G.survivalMs / 1000;
    if (survSec > G.best) {
      G.best = survSec;
      saveBest();
    }

    $('go-time').textContent         = survSec.toFixed(1) + 's';
    $('go-extinguished').textContent = Math.max(0, 100 - Math.round(G.fireLevel)) + '%';
    $('go-distractors').textContent  = G.distractorsResisted;
    $('go-best').textContent         = G.best.toFixed(1) + 's';
    $('go-sub').textContent          = survSec < 5
      ? 'You got distracted almost immediately — try to ignore the periphery!'
      : survSec < 15
        ? 'Not bad! Focus harder on the reticle next time.'
        : survSec < 30
          ? 'Good effort! The distractors are getting intense.'
          : 'Impressive endurance! You resisted ' + G.distractorsResisted + ' distractors!';

    var gc = $('gameover-card');
    gc.style.animation = 'none';
    void gc.offsetWidth;
    gc.style.animation = 'shake 0.5s cubic-bezier(0.36,0.07,0.19,0.97) both';

    setTimeout(function () { showScreen('gameover'); }, 400);
  }

  // ── WebGazer init ─────────────────────────────────────────
  async function initWebGazer() {
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

    var hide = ['webgazerVideoContainer','webgazerFaceOverlay','webgazerFaceFeedbackBox'];
    hide.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    if (typeof webgazer.removeMouseEventListeners === 'function') {
      webgazer.removeMouseEventListeners();
    }
  }

  // ── Start button ──────────────────────────────────────────
  $('btn-start').addEventListener('click', function () {
    showScreen('calibrating');
    $('cal-msg').textContent = 'Initialising eye tracker…';

    setTimeout(async function () {
      try {
        await initWebGazer();
        $('cal-msg').textContent = 'Calibrating… look around the screen edges';

        webgazer.setGazeListener(function (data) {
          if (!data) return;
          G.gazeX = data.x;
          G.gazeY = data.y;
          var dot = $('gaze-dot');
          if (dot.classList.contains('visible')) {
            dot.style.left = data.x + 'px';
            dot.style.top  = data.y + 'px';
          }
        });

        setTimeout(function () {
          // Apply stored calibration tol80 as the hit radius (80th-percentile gaze error)
          try {
            var storedTol80 = parseInt(localStorage.getItem('neurogaze_cal_tol80') || '0', 10);
            if (storedTol80 > 0) {
              HIT_RADIUS = Math.max(80, Math.min(250, storedTol80));
            }
          } catch (_) {}
          G.calDone = true;
          loadBest();
          showScreen('game');
          startGame();
        }, 1800);
      } catch (err) {
        $('cal-msg').textContent = 'Could not initialise camera: ' + err.message;
      }
    }, 100);
  });

  // ── Game-over buttons ─────────────────────────────────────
  $('btn-retry').addEventListener('click', function () {
    showScreen('game');
    startGame();
  });

  $('btn-menu').addEventListener('click', function () {
    G.active = false;
    clearTimeout(G.distractorTimer);
    showScreen('intro');
  });

  // ── Resize ────────────────────────────────────────────────
  window.addEventListener('resize', function () {
    if ($('screen-game').classList.contains('active') && G.active) {
      positionBuilding();
      buildFire();
      positionFiretruck();
    }
  });

  // ── Settings panel ──────────────────────────────────────
  SettingsPanel.init({
    alwaysVisible: true,
    panelLabel: 'Settings',
    sections: [
      { type: 'buttons', items: [
        { id: 'dashboard', label: '← Dashboard', onClick: function () { window.location.href = 'dashboard.html'; } },
      ]},
      { type: 'divider' },
      { type: 'toggle', id: 'gaze-dot', label: 'Gaze dot', initial: false,
        onChange: function (on) {
          var dot = $('gaze-dot');
          dot.classList.toggle('visible', on);
          if (!on) { dot.style.left = ''; dot.style.top = ''; }
        }
      },
      { type: 'toggle', id: 'camera', label: 'Camera preview', initial: false,
        onChange: function (on) {
          var el = document.getElementById('webgazerVideoContainer');
          if (el) el.style.display = on ? '' : 'none';
          if (typeof webgazer.showFaceOverlay === 'function') webgazer.showFaceOverlay(on);
        }
      },
    ],
  });

  // ── Initial setup ─────────────────────────────────────────
  loadBest();

})();
