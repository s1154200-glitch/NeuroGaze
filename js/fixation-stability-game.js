(function () {
  'use strict';

  // ── helpers ─────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function showScreen(name) {
    ['intro','calibrating','game','levelup','gameover'].forEach(function (s) {
      $(('screen-' + s)).classList.toggle('active', s === name);
    });
  }

  // ── Game constants / balance ──────────────────────────────
  var BASE_FOCUS_MS   = 2000;   // level 1 required focus
  var MS_PER_LEVEL    = 1000;   // +1s per level

  var BASE_TIME_LIMIT = 14000;  // level 1 total round time
  var TIME_DECAY_MS   = 400;    // shrink per level
  var MIN_TIME_LIMIT  = 7000;

  var BASE_RADIUS_PX  = 110;    // gaze hit radius px

  var RESET_ON_LEVEL  = 5;      // levels ≥ this reset progress on gaze-off

  // ── Game state ────────────────────────────────────────────
  var G = {
    level: 1,
    best: 1,
    session: 0,         // total levels cracked this play session
    gameActive: false,
    onTarget: false,
    lastTick: 0,
    focusAccum: 0,      // ms accumulated on target this round
    roundTimeLeft: 0,
    roundTimerId: null,
    spinAngle: 0,
    spinVelocity: 0,    // deg/s (accelerates on target, decays off)
    gazeX: window.innerWidth  / 2,
    gazeY: window.innerHeight / 2,
    calDone: false,
    progFrac: 0,
  };

  function focusRequired()   { return BASE_FOCUS_MS + (G.level - 1) * MS_PER_LEVEL; }
  function roundTimeLimit()  { return Math.max(MIN_TIME_LIMIT, BASE_TIME_LIMIT - (G.level - 1) * TIME_DECAY_MS); }
  function hitRadius()       { return BASE_RADIUS_PX; }   // ← FIXED SIZE (no longer shrinks)

  // ── Best score (localStorage) ─────────────────────────────
  function loadBest() {
    try { G.best = parseInt(localStorage.getItem('safeCracker_best') || '1', 10) || 1; } catch(e) {}
  }
  function saveBest() {
    try { localStorage.setItem('safeCracker_best', String(G.best)); } catch(e) {}
  }

  // ── Vault SVG sizing ──────────────────────────────────────
  var DIAL_R   = 0;   // radius of the outer SVG rings
  var DIAL_CX  = 0;
  var DIAL_CY  = 0;

  function computeSizes() {
    var available = Math.min(window.innerWidth * 0.72, window.innerHeight * 0.72, 540);
    var outerSize = Math.floor(available / 2) * 2;   // keep even

    DIAL_R  = outerSize / 2;
    DIAL_CX = DIAL_R;
    DIAL_CY = DIAL_R;

    // SVG layers
    var svgStyle = 'width:' + outerSize + 'px;height:' + outerSize + 'px;position:absolute;';
    $('svg-countdown').setAttribute('style', svgStyle);
    $('svg-countdown').setAttribute('viewBox', '0 0 ' + outerSize + ' ' + outerSize);
    $('svg-gazezone').setAttribute('style', svgStyle);
    $('svg-gazezone').setAttribute('viewBox', '0 0 ' + outerSize + ' ' + outerSize);
    $('svg-progress').setAttribute('style', svgStyle);
    $('svg-progress').setAttribute('viewBox', '0 0 ' + outerSize + ' ' + outerSize);
    $('svg-dial-face').setAttribute('style', svgStyle);
    $('svg-dial-face').setAttribute('viewBox', '0 0 ' + outerSize + ' ' + outerSize);

    // Dial container (inner 64% of outerSize)
    var dialSize = Math.round(outerSize * 0.64);
    var dc = $('dial-container');
    dc.style.width  = dialSize + 'px';
    dc.style.height = dialSize + 'px';
    dc.style.zIndex = '2';

    // Canvas for combo ring
    var cc = $('canvas-combo');
    cc.width  = dialSize;
    cc.height = dialSize;
    cc.style.width  = dialSize + 'px';
    cc.style.height = dialSize + 'px';
    cc.style.position = 'absolute';
    cc.style.top = '0';
    cc.style.left = '0';
    cc.style.borderRadius = '50%';

    $('vault-wrapper').style.width  = outerSize + 'px';
    $('vault-wrapper').style.height = outerSize + 'px';
    $('vault-wrapper').style.position = 'relative';

    buildDialFace();
    buildCountdownRing();
    buildGazeZone();
    buildProgressArc();
    drawComboRing(G.spinAngle, false);
  }

  // ── Build static dial face (tick marks + numbers) ─────────
  function buildDialFace() {
    var svg = $('svg-dial-face');
    svg.innerHTML = '';
    var size  = DIAL_R * 2;
    var cx    = DIAL_CX;
    var cy    = DIAL_CY;
    var inner = DIAL_R * 0.72;  // tick inner edge (just outside progress arc)
    var TICKS = 40;

    for (var i = 0; i < TICKS; i++) {
      var angle = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
      var major = (i % 5 === 0);
      var tickLen = major ? DIAL_R * 0.052 : DIAL_R * 0.028;
      var r1 = inner - tickLen;
      var r2 = inner;
      var x1 = cx + Math.cos(angle) * r1;
      var y1 = cy + Math.sin(angle) * r1;
      var x2 = cx + Math.cos(angle) * r2;
      var y2 = cy + Math.sin(angle) * r2;
      var line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', major ? 'rgba(167,139,250,0.55)' : 'rgba(167,139,250,0.22)');
      line.setAttribute('stroke-width', major ? '2' : '1');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    }
  }

  // ── Countdown ring (outer stripe, drains clockwise) ───────
  var countdownCircumference = 0;
  var countdownArc = null;

  function buildCountdownRing() {
    var svg = $('svg-countdown');
    svg.innerHTML = '';
    var r  = DIAL_R * 0.94;
    var circ = 2 * Math.PI * r;
    countdownCircumference = circ;

    var track = document.createElementNS('http://www.w3.org/2000/svg','circle');
    track.setAttribute('cx', DIAL_CX); track.setAttribute('cy', DIAL_CY);
    track.setAttribute('r', r);
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'rgba(255,59,48,0.10)');
    track.setAttribute('stroke-width', DIAL_R * 0.038);
    svg.appendChild(track);

    countdownArc = document.createElementNS('http://www.w3.org/2000/svg','circle');
    countdownArc.setAttribute('cx', DIAL_CX); countdownArc.setAttribute('cy', DIAL_CY);
    countdownArc.setAttribute('r', r);
    countdownArc.setAttribute('fill', 'none');
    countdownArc.setAttribute('stroke', '#ff3b30');
    countdownArc.setAttribute('stroke-width', DIAL_R * 0.038);
    countdownArc.setAttribute('stroke-linecap', 'round');
    countdownArc.setAttribute('transform', 'rotate(-90 ' + DIAL_CX + ' ' + DIAL_CY + ')');
    countdownArc.setAttribute('stroke-dasharray', circ);
    countdownArc.setAttribute('stroke-dashoffset', '0');
    svg.appendChild(countdownArc);
  }

  function updateCountdownRing(fraction) {
    if (!countdownArc) return;
    var offset = countdownCircumference * (1 - fraction);
    countdownArc.setAttribute('stroke-dashoffset', offset);
    var col = fraction > 0.5 ? 'rgba(76,217,100,0.7)' : (fraction > 0.25 ? '#ff9500' : '#ff3b30');
    countdownArc.setAttribute('stroke', col);
  }

  // ── Gaze zone indicator (dashed ring showing hit radius) ──
  var gazeZoneCircle = null;

  function buildGazeZone() {
    var svg = $('svg-gazezone');
    svg.innerHTML = '';
    var r = hitRadius() / DIAL_R * DIAL_R * 0.62;   // scale to SVG space
    gazeZoneCircle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    gazeZoneCircle.setAttribute('cx', DIAL_CX);
    gazeZoneCircle.setAttribute('cy', DIAL_CY);
    gazeZoneCircle.setAttribute('r', r);
    gazeZoneCircle.setAttribute('fill', 'none');
    gazeZoneCircle.setAttribute('stroke', 'rgba(124,92,252,0.22)');
    gazeZoneCircle.setAttribute('stroke-width', '1.5');
    gazeZoneCircle.setAttribute('stroke-dasharray', '6,5');
    svg.appendChild(gazeZoneCircle);
  }

  function updateGazeZoneColor(onTarget) {
    if (!gazeZoneCircle) return;
    gazeZoneCircle.setAttribute('stroke', onTarget ? 'rgba(124,92,252,0.58)' : 'rgba(124,92,252,0.22)');
  }

  // ── Progress arc (fills as gaze held) ─────────────────────
  var progressCircumference = 0;
  var progressArc = null;
  var progressGlow = null;

  function buildProgressArc() {
    var svg = $('svg-progress');
    svg.innerHTML = '';
    var r    = DIAL_R * 0.73;
    var circ = 2 * Math.PI * r;
    progressCircumference = circ;

    // track
    var track = document.createElementNS('http://www.w3.org/2000/svg','circle');
    track.setAttribute('cx', DIAL_CX); track.setAttribute('cy', DIAL_CY);
    track.setAttribute('r', r);
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'rgba(124,92,252,0.12)');
    track.setAttribute('stroke-width', DIAL_R * 0.055);
    svg.appendChild(track);

    // glow (slightly larger, blurred via filter)
    var defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    var filt = document.createElementNS('http://www.w3.org/2000/svg','filter');
    filt.setAttribute('id','arcGlow'); filt.setAttribute('x','-30%'); filt.setAttribute('y','-30%');
    filt.setAttribute('width','160%'); filt.setAttribute('height','160%');
    var blur = document.createElementNS('http://www.w3.org/2000/svg','feGaussianBlur');
    blur.setAttribute('stdDeviation','5'); blur.setAttribute('result','blur');
    filt.appendChild(blur);
    defs.appendChild(filt);
    svg.appendChild(defs);

    progressGlow = document.createElementNS('http://www.w3.org/2000/svg','circle');
    progressGlow.setAttribute('cx', DIAL_CX); progressGlow.setAttribute('cy', DIAL_CY);
    progressGlow.setAttribute('r', r);
    progressGlow.setAttribute('fill', 'none');
    progressGlow.setAttribute('stroke', 'rgba(124,92,252,0.25)');
    progressGlow.setAttribute('stroke-width', DIAL_R * 0.075);
    progressGlow.setAttribute('filter', 'url(#arcGlow)');
    progressGlow.setAttribute('stroke-linecap', 'round');
    progressGlow.setAttribute('transform', 'rotate(-90 ' + DIAL_CX + ' ' + DIAL_CY + ')');
    progressGlow.setAttribute('stroke-dasharray', circ);
    progressGlow.setAttribute('stroke-dashoffset', circ);
    svg.appendChild(progressGlow);

    progressArc = document.createElementNS('http://www.w3.org/2000/svg','circle');
    progressArc.setAttribute('cx', DIAL_CX); progressArc.setAttribute('cy', DIAL_CY);
    progressArc.setAttribute('r', r);
    progressArc.setAttribute('fill', 'none');
    progressArc.setAttribute('stroke', 'url(#pGrad)');
    progressArc.setAttribute('stroke-width', DIAL_R * 0.055);
    progressArc.setAttribute('stroke-linecap', 'round');
    progressArc.setAttribute('transform', 'rotate(-90 ' + DIAL_CX + ' ' + DIAL_CY + ')');
    progressArc.setAttribute('stroke-dasharray', circ);
    progressArc.setAttribute('stroke-dashoffset', circ);
    // gradient
    var lg = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    lg.setAttribute('id','pGrad'); lg.setAttribute('x1','0%'); lg.setAttribute('y1','0%');
    lg.setAttribute('x2','100%'); lg.setAttribute('y2','0%');
    var s1 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s1.setAttribute('offset','0%'); s1.setAttribute('stop-color','#a78bfa');
    var s2 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s2.setAttribute('offset','100%'); s2.setAttribute('stop-color','#4cd964');
    lg.appendChild(s1); lg.appendChild(s2);
    defs.appendChild(lg);
    svg.appendChild(progressArc);
  }

  function updateProgressArc(fraction) {
    if (!progressArc) return;
    var offset = progressCircumference * (1 - fraction);
    progressArc.setAttribute('stroke-dashoffset', offset);
    progressGlow.setAttribute('stroke-dashoffset', offset);
  }

  // ── Combo ring (canvas, ticks that spin) ──────────────────
  function drawComboRing(angleDeg, onTarget) {
    var cc  = $('canvas-combo');
    var ctx = cc.getContext('2d');
    var W   = cc.width;
    var H   = cc.height;
    var cx  = W / 2;
    var cy  = H / 2;
    var r   = W / 2 * 0.9;
    ctx.clearRect(0, 0, W, H);

    var pf = G.progFrac || 0;
    var ringColor, notchHi, notchLo, pointerColor;
    if (pf < 0.33) {
      ringColor = 'rgba(124,92,252,0.32)'; notchHi = 'rgba(167,139,250,0.82)'; notchLo = 'rgba(124,92,252,0.46)'; pointerColor = onTarget ? '#a78bfa' : 'rgba(124,92,252,0.5)';
    } else if (pf < 0.66) {
      ringColor = 'rgba(90,155,255,0.42)'; notchHi = 'rgba(130,190,255,0.90)'; notchLo = 'rgba(90,155,255,0.52)'; pointerColor = '#82beff';
    } else if (pf < 0.9) {
      ringColor = 'rgba(76,217,150,0.52)'; notchHi = 'rgba(100,245,185,0.95)'; notchLo = 'rgba(76,217,150,0.58)'; pointerColor = '#4cd996';
    } else {
      ringColor = 'rgba(76,217,100,0.72)'; notchHi = 'rgba(160,255,140,1)';    notchLo = 'rgba(76,217,100,0.72)'; pointerColor = '#7dff90';
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleDeg * Math.PI / 180);

    if (pf > 0.5) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 10;
      ctx.globalAlpha = 0.28;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = pf > 0.9 ? 4 : 3;
    ctx.stroke();

    var NOTCHES = 20;
    for (var i = 0; i < NOTCHES; i++) {
      var a = (i / NOTCHES) * Math.PI * 2;
      var major = (i % 5 === 0);
      var len   = major ? r * 0.14 : r * 0.08;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - len), Math.sin(a) * (r - len));
      ctx.lineTo(Math.cos(a) * r,          Math.sin(a) * r);
      ctx.strokeStyle = major ? notchHi : notchLo;
      ctx.lineWidth   = major ? 2.5 : 1.5;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(0, -(r + 2));
    ctx.lineTo(-5, -(r - 10));
    ctx.lineTo(5,  -(r - 10));
    ctx.closePath();
    ctx.fillStyle = pointerColor;
    if (pf > 0.9) { ctx.shadowColor = '#4cd964'; ctx.shadowBlur = 12; }
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  // ── Screen helper: Game Over flash ────────────────────────
  function flashGameOver() {
    var gs = $('screen-game');
    gs.style.animation = 'flashRed 0.6s ease-out 2';
    setTimeout(function () { gs.style.animation = ''; }, 1250);
  }

  // ── Particles ─────────────────────────────────────────────
  function spawnParticles(cx, cy, count, palette) {
    var types = ['', 'particle-star', 'particle-diamond', 'particle-streak'];
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      var type = types[Math.floor(Math.random() * types.length)];
      p.className = 'particle' + (type ? ' ' + type : '');
      var angle    = Math.random() * Math.PI * 2;
      var dist     = 90 + Math.random() * 240;
      var tx       = Math.cos(angle) * dist;
      var ty       = Math.sin(angle) * dist;
      var isStreak = type === 'particle-streak';
      var w        = isStreak ? (2 + Math.random() * 3) : (5 + Math.random() * 11);
      var h        = isStreak ? (14 + Math.random() * 24) : w;
      var color    = palette[Math.floor(Math.random() * palette.length)];
      var rot      = Math.floor(Math.random() * 720);
      p.style.cssText = [
        'left:'   + cx  + 'px',
        'top:'    + cy  + 'px',
        'width:'  + w   + 'px',
        'height:' + h   + 'px',
        'background:' + color,
        '--tx:' + tx + 'px',
        '--ty:' + ty + 'px',
        '--rot:' + rot + 'deg',
        'animation-duration:' + (0.55 + Math.random() * 0.85) + 's',
        'z-index:1000',
        'transform-origin:center',
      ].join(';');
      document.body.appendChild(p);
      setTimeout(function (el) { el.remove(); }, 1700, p);
    }
  }

  // ── Round loop ────────────────────────────────────────────
  var rafId = null;

  function startRound() {
    G.focusAccum    = 0;
    G.roundTimeLeft = roundTimeLimit();
    G.onTarget      = false;
    G.spinAngle     = 0;
    G.spinVelocity  = 0;
    G.lastTick      = performance.now();
    G.gameActive    = true;

    $('hud-level').textContent   = G.level;
    $('hud-best').textContent    = G.best;
    $('hud-needed').textContent  = (focusRequired() / 1000).toFixed(1) + 's';

    computeSizes();   // rebuild SVGs (gaze zone now stays fixed size)

    updateProgressArc(0);
    updateCountdownRing(1);
    $('gaze-hint').textContent = 'Look at the center of the dial';
    $('gaze-hint').classList.remove('active');
    $('dial-container').classList.remove('on-target','charge-low','charge-mid','charge-high','charge-max');
    $('dial-knob').classList.remove('pulse','charge-high','charge-max');
    $('game-crosshair').classList.remove('on-target');
    $('screen-game').classList.remove('on-target-active');
    G.progFrac = 0;
    var vgReset = document.getElementById('vault-glow');
    if (vgReset) { vgReset.className = ''; }

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!G.gameActive) return;

    var dt = Math.min(now - G.lastTick, 100);
    G.lastTick = now;

    G.roundTimeLeft -= dt;
    if (G.roundTimeLeft <= 0) {
      G.roundTimeLeft = 0;
      endRound(false);
      return;
    }
    var timeFrac = G.roundTimeLeft / roundTimeLimit();
    updateCountdownRing(timeFrac);
    var tsec = G.roundTimeLeft / 1000;
    $('hud-time').textContent = tsec.toFixed(1) + 's';
    var hudTime = $('hud-time');
    if (tsec < 4) hudTime.classList.add('danger'); else hudTime.classList.remove('danger');

    var hr = hitRadius();
    var cx = window.innerWidth  / 2;
    var cy = window.innerHeight / 2;
    var dx = G.gazeX - cx;
    var dy = G.gazeY - cy;
    var dist   = Math.sqrt(dx * dx + dy * dy);
    var onTgt  = dist <= hr;

    if (onTgt !== G.onTarget) {
      G.onTarget = onTgt;
      $('dial-container').classList.toggle('on-target', onTgt);
      $('dial-knob').classList.toggle('pulse', onTgt);
      $('game-crosshair').classList.toggle('on-target', onTgt);
      updateGazeZoneColor(onTgt);
      $('gaze-hint').classList.toggle('active', onTgt);
      if (onTgt) {
        $('gaze-hint').textContent = 'Keep it there…';
      } else {
        $('gaze-hint').textContent = 'Look at the center of the dial';
        if (G.level >= RESET_ON_LEVEL && !onTgt) {
          G.focusAccum = 0;
        }
      }
    }

    if (onTgt) {
      G.focusAccum += dt;
      G.spinVelocity = Math.min(G.spinVelocity + dt * 0.18, 120);
    } else {
      G.spinVelocity = Math.max(G.spinVelocity - dt * 0.25, 0);
    }
    G.spinAngle += G.spinVelocity * (dt / 1000);

    var fr = focusRequired();
    var progFrac = Math.min(G.focusAccum / fr, 1);
    G.progFrac = progFrac;
    updateProgressArc(progFrac);
    drawComboRing(G.spinAngle, onTgt);

    var dc2 = $('dial-container');
    dc2.classList.remove('charge-low','charge-mid','charge-high','charge-max');
    $('dial-knob').classList.remove('charge-high','charge-max');
    $('screen-game').classList.toggle('on-target-active', onTgt);
    if (onTgt && progFrac > 0) {
      var cl = progFrac < 0.33 ? 'charge-low' : progFrac < 0.66 ? 'charge-mid' : progFrac < 0.9 ? 'charge-high' : 'charge-max';
      dc2.classList.add(cl);
      if (progFrac >= 0.66) $('dial-knob').classList.add(progFrac >= 0.9 ? 'charge-max' : 'charge-high');
    }

    var vg2 = document.getElementById('vault-glow');
    if (vg2) {
      if (onTgt && progFrac > 0) {
        var glowCls = progFrac < 0.33 ? 'vault-glow-low' : progFrac < 0.66 ? 'vault-glow-mid' : progFrac < 0.9 ? 'vault-glow-high' : 'vault-glow-max';
        vg2.className = glowCls;
        var gs = 380 + progFrac * 380;
        vg2.style.width  = gs + 'px';
        vg2.style.height = gs + 'px';
      } else if (!onTgt) {
        vg2.className = '';
      }
    }

    if (G.focusAccum >= fr) {
      endRound(true);
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function clearGameFx() {
    $('dial-container').classList.remove('on-target','charge-low','charge-mid','charge-high','charge-max');
    $('dial-knob').classList.remove('pulse','charge-high','charge-max');
    $('game-crosshair').classList.remove('on-target');
    $('screen-game').classList.remove('on-target-active');
    var vg = document.getElementById('vault-glow');
    if (vg) { vg.className = ''; vg.style.width = ''; vg.style.height = ''; }
  }

  function endRound(success) {
    G.gameActive = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    clearGameFx();

    if (success) {
      var vw = $('vault-wrapper');
      var rect = vw.getBoundingClientRect();
      var svx = rect.left + rect.width  / 2;
      var svy = rect.top  + rect.height / 2;

      var flash2 = document.createElement('div');
      flash2.className = 'flash-overlay';
      document.body.appendChild(flash2);
      setTimeout(function () { flash2.remove(); }, 850);

      var swClasses = ['shockwave shockwave-green','shockwave shockwave-purple','shockwave shockwave-white'];
      swClasses.forEach(function (cls, idx) {
        setTimeout(function () {
          var sw = document.createElement('div');
          sw.className = cls;
          var sz = rect.width * (0.55 + idx * 0.15);
          sw.style.cssText = 'left:'+svx+'px;top:'+svy+'px;width:'+sz+'px;height:'+sz+'px;';
          document.body.appendChild(sw);
          setTimeout(function () { sw.remove(); }, 950);
        }, idx * 85);
      });

      var hud = document.querySelector('.hud');
      if (hud) {
        hud.classList.remove('flash-green');
        void hud.offsetWidth;
        hud.classList.add('flash-green');
        setTimeout(function () { hud.classList.remove('flash-green'); }, 800);
      }

      spawnParticles(svx, svy, 62,
        ['#a78bfa','#7c5cfc','#4cd964','#34c759','#fff','#c4b5fd','#86efac','#fcd34d','#f9a8d4']
      );

      var thisLevel  = G.level;
      G.level++;
      G.session++;
      if (G.level > G.best) { G.best = G.level; saveBest(); }

      $('lu-level').textContent       = thisLevel;
      $('lu-needed').textContent      = (focusRequired() / 1000 - 1).toFixed(0) + 's';
      $('lu-nextneeded').textContent  = (focusRequired() / 1000).toFixed(0) + 's';
      $('levelup-sub').textContent    = 'Level ' + thisLevel + ' complete! Get ready for level ' + G.level + '.';

      var lc = $('levelup-card');
      lc.style.animation = 'none';
      void lc.offsetWidth;
      lc.style.animation = '';

      showScreen('levelup');
    } else {
      flashGameOver();
      $('go-reached').textContent = G.session;
      $('go-best').textContent    = (G.best - 1);
      $('go-sub').textContent     = 'You held focus for ' + (G.focusAccum / 1000).toFixed(1) + 's — almost there!';

      var gc = $('gameover-card');
      gc.style.animation = 'none';
      void gc.offsetWidth;
      gc.style.animation = 'shake 0.5s cubic-bezier(0.36,0.07,0.19,0.97) both';

      setTimeout(function () { showScreen('gameover'); }, 350);
    }
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
              BASE_RADIUS_PX = Math.max(60, Math.min(200, storedTol80));
            }
          } catch (_) {}
          G.calDone = true;
          loadBest();
          G.level   = 1;
          G.session = 0;
          showScreen('game');
          startRound();
        }, 1800);
      } catch (err) {
        $('cal-msg').textContent = 'Could not initialise camera: ' + err.message;
      }
    }, 100);
  });

  // ── Level-up continue ─────────────────────────────────────
  $('btn-nextlevel').addEventListener('click', function () {
    showScreen('game');
    startRound();
  });

  // ── Game-over buttons ──────────────────────────────────────
  $('btn-retry').addEventListener('click', function () {
    G.level   = 1;
    G.session = 0;
    showScreen('game');
    startRound();
  });

  $('btn-menu').addEventListener('click', function () {
    G.gameActive = false;
    showScreen('intro');
  });

  // ── Resize ────────────────────────────────────────────────
  window.addEventListener('resize', function () {
    if ($('screen-game').classList.contains('active')) computeSizes();
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

  // Vault ambient glow element
  (function () {
    var vg = document.createElement('div');
    vg.id = 'vault-glow';
    document.body.appendChild(vg);
  }());

  // Animated star field
  (function () {
    var sf = document.createElement('div');
    sf.className = 'star-field';
    document.body.appendChild(sf);
    for (var i = 0; i < 88; i++) {
      var s = document.createElement('div');
      s.className = 'star';
      var sz = 1 + Math.random() * 2.2;
      s.style.cssText = [
        'width:'    + sz + 'px',
        'height:'   + sz + 'px',
        'left:'     + (Math.random() * 100) + '%',
        'top:'      + (Math.random() * 100) + '%',
        '--dur:'    + (2 + Math.random() * 4.5) + 's',
        '--delay:-' + (Math.random() * 4.5) + 's',
        '--peak:'   + (0.15 + Math.random() * 0.55),
      ].join(';');
      sf.appendChild(s);
    }
  }());

})();