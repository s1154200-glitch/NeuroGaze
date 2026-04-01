(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────
  //  CONFIG
  // ─────────────────────────────────────────────────────────
  var INIT_REACTION_MS   = 2400;   // starting reaction window (ms)
  var MIN_REACTION_MS    = 380;    // fastest possible window
  var WINDOW_DECAY_MS    = 70;     // shaved per successful block
  var INIT_INTER_ROUND   = 950;    // pause between rounds (ms)
  var MIN_INTER_ROUND    = 100;    // minimum pause
  var INTER_DECAY_MS     = 30;     // inter-round pause reduction per block
  var DWELL_CORRECT_MS   = 140;    // dwell on correct side → success
  var DWELL_WRONG_MS     = 150;    // dwell on threat side → reflex-saccade fail
  var HINT_DURATION_PCT  = 0.42;   // direction hint shows for this % of reaction window
  var HINT_MAX_MS        = 1000;   // …but never more than this
  var CRITICAL_PCT       = 0.30;   // orb turns critical below this fraction of time left
  var TIMER_CIRC         = 251.3;  // 2π × 40 (svg circle radius)
  var COMBO_MILESTONES   = [5, 10, 15, 20, 30, 50]; // show combo label at these streaks

  // Gaze zone thresholds (% of viewport width from each edge)
  var ZONE_EDGE_PCT = 0.30;

  // ─────────────────────────────────────────────────────────
  //  STATE
  // ─────────────────────────────────────────────────────────
  var G = {
    state: 'IDLE',      // IDLE | WAITING | THREAT | RESOLVING | OVER
    score: 0,
    streak: 0,
    bestStreak: 0,
    best: +localStorage.getItem('sdf_best') || 0,
    webgazerPaused: false,

    threatSide: null,   // 'left' | 'right'
    correctSide: null,  // opposite of threatSide

    gazeX: 0, gazeY: 0,
    gazeSide: null,     // 'left' | 'right' | 'center'

    correctDwellStart: 0,
    wrongDwellStart:   0,

    reactionMs:   INIT_REACTION_MS,
    interRoundMs: INIT_INTER_ROUND,

    roundStart: 0,
    timerRafId: null,
    scheduleTimer: null,
    roundEndTimer: null,

    webgazerReady: false,
  };

  // ─────────────────────────────────────────────────────────
  //  DOM HELPERS
  // ─────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  var elScreenIntro  = $('screen-intro');
  var elScreenCal    = $('screen-calibrating');
  var elScreenGame   = $('screen-game');
  var elScreenOver   = $('screen-gameover');
  var elCalMsg       = $('cal-msg');
  var elGazeDot      = $('gaze-dot');
  var elShieldLeft   = $('shield-left');
  var elShieldRight  = $('shield-right');
  var elOrbLeft      = $('orb-left');
  var elOrbRight     = $('orb-right');
  var elTimerRing    = $('timer-ring');
  var elStation      = $('center-station');
  var elStationCore  = $('station-core');
  var elDirLabel     = $('direction-label');
  var elFailFlash    = $('fail-flash');
  var elSuccFlash    = $('success-flash');
  var elComboLabel   = $('combo-label');
  var elSpeedLabel   = $('speedup-label');
  var elHudScore     = $('hud-score');
  var elHudStreak    = $('hud-streak');
  var elHudSpeed     = $('hud-speed');
  var elHudBest      = $('hud-best');
  var elGoIcon       = $('go-icon');
  var elGoScore      = $('go-score');
  var elGoStreak     = $('go-streak');
  var elGoBest       = $('go-best');
  var elGoReason     = $('go-reason');
  var elGoSub        = $('go-sub');

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.remove('active');
    });
    $(id).classList.add('active');
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

        // Register gaze listener after begin()
        webgazer.setGazeListener(gazeListener);

        // Hide video elements
        ['webgazerVideoContainer','webgazerFaceOverlay','webgazerFaceFeedbackBox'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
        if (typeof webgazer.removeMouseEventListeners === 'function') {
          webgazer.removeMouseEventListeners();
        }

        G.webgazerReady = true;
        elCalMsg.textContent = 'Eye tracker ready. Launching arena…';
        setTimeout(startGame, 1200);
      } catch (err) {
        elCalMsg.textContent = 'Camera error: ' + ((err && err.message) || String(err));
      }
    }, 80);
  }

  // ─────────────────────────────────────────────────────────
  //  GAZE LISTENER
  // ─────────────────────────────────────────────────────────
  function gazeListener(data) {
    if (!data) return;
    G.gazeX = data.x;
    G.gazeY = data.y;

    // Move optional debug dot
    if (elGazeDot.classList.contains('visible')) {
      elGazeDot.style.left = data.x + 'px';
      elGazeDot.style.top  = data.y + 'px';
    }

    // Determine which zone gaze is in
    var w = window.innerWidth;
    var leftEdge  = w * ZONE_EDGE_PCT;
    var rightEdge = w * (1 - ZONE_EDGE_PCT);
    var prevSide  = G.gazeSide;
    G.gazeSide    = data.x < leftEdge ? 'left' : data.x > rightEdge ? 'right' : 'center';

    // Visual: light up shield the gaze is on (except during animations)
    if (G.state !== 'RESOLVING' && G.state !== 'OVER') {
      elShieldLeft.classList.toggle('gaze-on',  G.gazeSide === 'left');
      elShieldRight.classList.toggle('gaze-on', G.gazeSide === 'right');
    }

    // Dwell logic only during THREAT
    if (G.state !== 'THREAT') {
      G.correctDwellStart = 0;
      G.wrongDwellStart   = 0;
      return;
    }

    var now = Date.now();

    // Correct side dwell → success
    if (G.gazeSide === G.correctSide) {
      if (G.correctDwellStart === 0) G.correctDwellStart = now;
      else if (now - G.correctDwellStart >= DWELL_CORRECT_MS) resolveSuccess();
    } else {
      G.correctDwellStart = 0;
    }

    // Wrong side dwell → reflexive saccade fail
    if (G.gazeSide === G.threatSide) {
      if (G.wrongDwellStart === 0) G.wrongDwellStart = now;
      else if (now - G.wrongDwellStart >= DWELL_WRONG_MS) {
        activeOrb().classList.add('locked-on');
        setTimeout(function () { resolveFail('reflex'); }, 180);
      }
    } else {
      G.wrongDwellStart = 0;
    }
  }

  function activeOrb() {
    return G.threatSide === 'left' ? elOrbLeft : elOrbRight;
  }

  // ─────────────────────────────────────────────────────────
  //  GAME FLOW
  // ─────────────────────────────────────────────────────────
  function startGame() {
    G.score     = 0;
    G.streak    = 0;
    G.bestStreak = 0;
    G.reactionMs   = INIT_REACTION_MS;
    G.interRoundMs = INIT_INTER_ROUND;
    G.state = 'IDLE';

    clearShieldStates();
    resetTimerRing();
    elDirLabel.classList.remove('visible');
    elOrbLeft.className  = 'zone-orb';
    elOrbRight.className = 'zone-orb';
    elStation.classList.remove('critical', 'exploding');

    updateHUD();
    showScreen('screen-game');
    SettingsPanel.show();

    scheduleNextRound(700);
  }

  function scheduleNextRound(delay) {
    G.state = 'WAITING';
    clearTimers();

    clearShieldStates();
    elOrbLeft.className  = 'zone-orb';
    elOrbRight.className = 'zone-orb';
    elDirLabel.classList.remove('visible');
    elStation.classList.remove('critical', 'exploding');
    resetTimerRing();

    G.scheduleTimer = setTimeout(spawnThreat, delay);
  }

  function spawnThreat() {
    G.threatSide = Math.random() < 0.5 ? 'left' : 'right';
    G.correctSide = G.threatSide === 'left' ? 'right' : 'left';
    G.correctDwellStart = 0;
    G.wrongDwellStart   = 0;
    G.state     = 'THREAT';
    G.roundStart = Date.now();

    // Mark threat shield
    if (G.threatSide === 'left') {
      elShieldLeft.classList.add('threatened');
      elShieldRight.classList.remove('threatened');
    } else {
      elShieldRight.classList.add('threatened');
      elShieldLeft.classList.remove('threatened');
    }

    // Spawn orb
    var orb = activeOrb();
    orb.className = 'zone-orb spawning';
    // After spawn burst, switch to charging
    setTimeout(function () {
      if (G.state === 'THREAT') orb.className = 'zone-orb charging';
    }, 300);

    // Direction hint
    var hintText = G.threatSide === 'left' ? 'LOOK RIGHT ▶' : '◀ LOOK LEFT';
    elDirLabel.textContent = hintText;
    elDirLabel.classList.add('visible');
    var hintMs = Math.min(HINT_MAX_MS, G.reactionMs * HINT_DURATION_PCT);
    setTimeout(function () { elDirLabel.classList.remove('visible'); }, hintMs);

    // Timer ring + critical orb at 30% remaining
    startTimerAnimation();

    // Hard timeout — orb fires at station
    G.roundEndTimer = setTimeout(function () {
      if (G.state === 'THREAT') resolveFail('timeout');
    }, G.reactionMs);
  }

  // ─────────────────────────────────────────────────────────
  //  RESOLVE SUCCESS
  // ─────────────────────────────────────────────────────────
  function resolveSuccess() {
    if (G.state !== 'THREAT') return;
    G.state = 'RESOLVING';
    clearTimers();
    cancelTimerAnimation();

    G.score++;
    G.streak++;
    if (G.streak > G.bestStreak) G.bestStreak = G.streak;
    if (G.score > G.best) {
      G.best = G.score;
      try { localStorage.setItem('sdf_best', String(G.best)); } catch(e) {}
    }

    // Speed up after each block
    var prevReaction = G.reactionMs;
    G.reactionMs   = Math.max(MIN_REACTION_MS,   G.reactionMs   - WINDOW_DECAY_MS);
    G.interRoundMs = Math.max(MIN_INTER_ROUND,    G.interRoundMs - INTER_DECAY_MS);

    updateHUD();

    // Deflect shield animation on CORRECT side
    var correctShield = G.correctSide === 'left' ? elShieldLeft : elShieldRight;
    clearShieldStates();
    correctShield.classList.add('deflecting');

    // Hide orb
    var orb = activeOrb();
    orb.className = 'zone-orb';

    // Particles from correct shield center
    spawnDeflectParticles(correctShield);

    // Screen flash
    triggerFlash(elSuccFlash);

    // Full timer ring (brief success highlight)
    elTimerRing.style.stroke = '#4cd964';
    elTimerRing.style.strokeDashoffset = '0';

    // Combo milestone
    var isMilestone = COMBO_MILESTONES.indexOf(G.streak) !== -1;
    if (isMilestone) showComboLabel(G.streak);

    // Speed-up visual every 5 blocks
    if (G.score > 0 && G.score % 5 === 0) showSpeedupLabel();

    var holdMs = 480;
    setTimeout(function () {
      correctShield.classList.remove('deflecting');
      scheduleNextRound(G.interRoundMs);
    }, holdMs);
  }

  // ─────────────────────────────────────────────────────────
  //  RESOLVE FAIL
  // ─────────────────────────────────────────────────────────
  function resolveFail(reason) {
    if (G.state !== 'THREAT' && G.state !== 'RESOLVING') return;
    G.state = 'OVER';
    clearTimers();
    cancelTimerAnimation();

    // Orb "fires" visual
    var orb = activeOrb();
    if (reason === 'timeout') {
      // Station explodes
      elStation.classList.remove('critical');
      elStation.classList.add('exploding');
      orb.className = 'zone-orb';
    } else {
      elShieldLeft.classList.remove('gaze-on', 'threatened');
      elShieldRight.classList.remove('gaze-on', 'threatened');
      if (G.threatSide === 'left') elShieldLeft.classList.add('breached');
      else elShieldRight.classList.add('breached');
    }

    triggerFlash(elFailFlash);

    setTimeout(function () {
      showGameOver(reason);
    }, 600);
  }

  // ─────────────────────────────────────────────────────────
  //  GAME OVER SCREEN
  // ─────────────────────────────────────────────────────────
  function showGameOver(reason) {
    var reasonTexts = {
      reflex:  '⚡ Reflex Saccade — you looked at the threat!',
      timeout: '⏳ Too slow — the orb slipped through!'
    };
    var subTexts = {
      reflex:  'Your eye was drawn to the threat. Train your inhibitory control to override the reflex.',
      timeout: 'The reaction window closed before you blocked. Stay focused and react faster next time.',
    };
    var icons = { reflex: '👁️', timeout: '💥' };

    elGoIcon.textContent   = icons[reason]    || '💥';
    elGoReason.textContent = reasonTexts[reason] || 'Shield failed!';
    elGoSub.textContent    = subTexts[reason]    || '';
    elGoScore.textContent  = String(G.score);
    elGoStreak.textContent = String(G.bestStreak);
    elGoBest.textContent   = String(G.best);

    clearShieldStates();
    elOrbLeft.className  = 'zone-orb';
    elOrbRight.className = 'zone-orb';
    elDirLabel.classList.remove('visible');
    elShieldLeft.classList.remove('gaze-on');
    elShieldRight.classList.remove('gaze-on');

    showScreen('screen-gameover');
  }

  // ─────────────────────────────────────────────────────────
  //  TIMER ANIMATION
  // ─────────────────────────────────────────────────────────
  function startTimerAnimation() {
    resetTimerRing();
    G.roundStart = Date.now();
    elStation.classList.remove('critical');

    function tick() {
      var elapsed  = Date.now() - G.roundStart;
      var fraction = Math.max(0, 1 - elapsed / G.reactionMs);
      var offset   = TIMER_CIRC * (1 - fraction);
      elTimerRing.style.strokeDashoffset = String(offset);

      // Color transition: cyan → orange → red
      if (fraction > 0.6) {
        elTimerRing.style.stroke = '#5ce0f0';
      } else if (fraction > 0.3) {
        elTimerRing.style.stroke = '#ffaa00';
      } else {
        elTimerRing.style.stroke = '#ff3b30';
      }

      // Critical state below 30%
      if (fraction < CRITICAL_PCT) {
        elStation.classList.add('critical');
        if (G.state === 'THREAT') {
          var orb = activeOrb();
          if (orb.className.indexOf('critical') === -1) {
            orb.className = 'zone-orb critical';
          }
        }
      }

      if (G.state === 'THREAT') {
        G.timerRafId = requestAnimationFrame(tick);
      }
    }
    G.timerRafId = requestAnimationFrame(tick);
  }

  function cancelTimerAnimation() {
    if (G.timerRafId) {
      cancelAnimationFrame(G.timerRafId);
      G.timerRafId = null;
    }
  }

  function resetTimerRing() {
    elTimerRing.style.strokeDashoffset = '0';
    elTimerRing.style.stroke = '#5ce0f0';
    elStation.classList.remove('critical');
  }

  // ─────────────────────────────────────────────────────────
  //  PARTICLE BURST
  // ─────────────────────────────────────────────────────────
  function spawnDeflectParticles(shieldEl) {
    var rect = shieldEl.getBoundingClientRect();
    var cx = rect.left + rect.width  * 0.5;
    var cy = rect.top  + rect.height * 0.5;
    var count = 18;
    var colors = ['#5ce0f0','#0ea5e9','#fff','#7ce8f5','#b0f0ff','#ffcc00'];

    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'burst-particle';
      var angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      var dist  = 55 + Math.random() * 80;
      var size  = 4 + Math.random() * 6;
      var dur   = 0.5 + Math.random() * 0.4;
      p.style.cssText =
        'left:' + cx + 'px;top:' + cy + 'px;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'background:' + colors[Math.floor(Math.random() * colors.length)] + ';' +
        'box-shadow: 0 0 6px currentColor;' +
        '--bx:' + Math.round(Math.cos(angle) * dist) + 'px;' +
        '--by:' + Math.round(Math.sin(angle) * dist) + 'px;' +
        '--dur:' + dur + 's;';
      document.body.appendChild(p);
      setTimeout(function (node) { node.parentNode && node.parentNode.removeChild(node); }, dur * 1000 + 50, p);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  VISUAL HELPERS
  // ─────────────────────────────────────────────────────────
  function clearShieldStates() {
    var classes = ['threatened','deflecting','breached'];
    classes.forEach(function (c) {
      elShieldLeft.classList.remove(c);
      elShieldRight.classList.remove(c);
    });
  }

  function triggerFlash(el) {
    el.classList.remove('show');
    void el.offsetWidth; // reflow
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 600);
  }

  function showComboLabel(streak) {
    elComboLabel.textContent = streak + '× STREAK!';
    elComboLabel.classList.remove('show');
    void elComboLabel.offsetWidth;
    elComboLabel.classList.add('show');
    setTimeout(function () { elComboLabel.classList.remove('show'); }, 900);
  }

  function showSpeedupLabel() {
    elSpeedLabel.classList.remove('show');
    void elSpeedLabel.offsetWidth;
    elSpeedLabel.classList.add('show');
    setTimeout(function () { elSpeedLabel.classList.remove('show'); }, 1500);
  }

  function updateHUD() {
    elHudScore.textContent  = String(G.score);
    elHudStreak.textContent = String(G.streak);
    elHudBest.textContent   = String(G.best);

    var speedMult = (INIT_REACTION_MS / G.reactionMs).toFixed(1);
    elHudSpeed.textContent = speedMult + '×';

    // streak color
    if (G.streak >= 10) {
      elHudStreak.className = 'hud-value streak-fire';
    } else {
      elHudStreak.className = 'hud-value';
    }
  }

  function clearTimers() {
    clearTimeout(G.scheduleTimer);
    clearTimeout(G.roundEndTimer);
    G.scheduleTimer = null;
    G.roundEndTimer = null;
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
            {
              id: 'dashboard',
              label: '← Dashboard',
              onClick: function () { window.location.href = 'dashboard.html'; }
            }
          ]
        },
        { type: 'divider' },
        {
          type: 'toggle',
          id: 'gaze-dot',
          label: 'Gaze dot',
          initial: false,
          onChange: function (on) {
            elGazeDot.classList.toggle('visible', on);
          }
        },
        {
          type: 'toggle',
          id: 'camera',
          label: 'Camera preview',
          initial: false,
          onChange: function (on) {
            var vid = document.getElementById('webgazerVideoContainer');
            if (vid) vid.style.display = on ? 'block' : 'none';
            if (typeof webgazer.showFaceOverlay === 'function') webgazer.showFaceOverlay(on);
          }
        },
        {
          type: 'toggle',
          id: 'hints',
          label: 'Direction hints',
          initial: true,
          onChange: function (on) {
            HINT_DURATION_PCT = on ? 0.42 : 0;
            HINT_MAX_MS       = on ? 1000 : 0;
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
