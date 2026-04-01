/* ============================================================
   ADHD Fixation Stability Test — WebGazer-based
   Biomarkers: BCEA, Variance Drift, Square Wave Jerks, Quiet Eye
   ============================================================ */
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

var ADHD = {
  // Test timing
  TASK_DURATION_MS:     30000, // 30 seconds
  COUNTDOWN_DURATION_S: 3,

  // BCEA thresholds adjusted for webcam-based tracking noise (degrees²)
  // Clinical values (1.5 / 3.0) assume a precision eye tracker; WebGazer
  // adds ~2–4° of scatter even at stable fixation, so thresholds are widened.
  BCEA_TD_THRESHOLD:   3.5,
  BCEA_ADHD_THRESHOLD: 5.0,

  // Variance drift: % increase after first 10s
  DRIFT_ADHD_THRESHOLD: 0.25,   // 25%

  // Square Wave Jerk detection
  // SWJ: rapid outward saccade ≥ SWJ_MIN_AMP_DEG followed by return within SWJ_RETURN_MS
  SWJ_MIN_VELOCITY_PX_S: 400,   // minimum velocity to qualify as a saccade
  SWJ_MIN_AMP_PX:        30,    // minimum amplitude
  SWJ_RETURN_WINDOW_MS:  500,   // return must occur within this window
  SWJ_TD_THRESHOLD:      3,     // TD: < 3 SWJs per 30s
  SWJ_ADHD_THRESHOLD:    8,     // ADHD: > 8 SWJs per 30s

  // Quiet Eye: samples within QE_RADIUS_PX of target treated as "on-target"
  QE_RADIUS_PX:          50,
  QE_TD_THRESHOLD:       0.60,  // TD: > 60% on-target
  QE_ADHD_THRESHOLD:     0.35,  // ADHD: < 35% on-target

  // Pixels-per-degree approximation (57 cm viewing dist, ~110 dpi typical laptop)
  // ~55 px/deg at typical laptop distance — tunable
  PX_PER_DEG: 55,

  // Rolling BCEA window for live HUD (last N samples)
  LIVE_BCEA_WINDOW: 60,

  // Temporal bucketing for variance chart
  TEMPORAL_BUCKETS: 30,         // one bucket per second
};

// ── State ─────────────────────────────────────────────────────────────────

var AT = {
  gazeData:        [],    // { x, y, t } — raw collected samples
  taskStartTime:   0,
  taskTimer:       null,
  hudTimer:        null,
  finishTimer:     null,   // setTimeout ID for finishTask
  remainingSecs:   0,      // current countdown value (for pause/resume)
  paused:          false,
  pauseStartTime:  0,
  swjCount:        0,
  pendingSaccade:  null,  // { x, y, t, velPx } after outward jump
  prevGaze:        null,  // { x, y, t }
  scatterCtx:      null,
  targetX:         0,
  targetY:         0,
  gazeListener:    null,

  // Blink detection state
  blinkCount:      0,
  blinkNullCount:  0,
  lastBlinkTime:   0,

  // Debug settings panel state (all off by default)
  debugSettings: {
    gazeDot:          false,
    camera:           false,
    offsetCorrection: false,
    rangeCheck:       false,
    facePositioning:  false,
    accData:          false,
  },
};

// Tracks the most-recently-installed task gaze listener so it can be
// restored after CalApp.performAccuracyRecheck completes.
var AT_activeGazeListener = null;

// ── DOM ────────────────────────────────────────────────────────────────────

var Adom = {};

function $(id) { return document.getElementById(id); }

function initDom() {
  Adom.introScreen    = $('adhd-intro-screen');
  Adom.taskScreen     = $('adhd-task-screen');
  Adom.resultsScreen  = $('adhd-results-screen');
  Adom.loadingOvl     = $('adhd-loading-overlay');
  Adom.errorOvl       = $('adhd-error-overlay');
  Adom.errorTitle     = $('adhd-error-title');
  Adom.errorMsg       = $('adhd-error-message');
  Adom.errorBtn       = $('adhd-error-btn');
  Adom.startBtn       = $('adhd-start-btn');
  Adom.retestBtn      = $('adhd-retest-btn');
  Adom.countdown      = $('adhd-countdown');
  Adom.countdownNum   = $('countdown-num');
  Adom.countdownArc   = $('countdown-arc');
  Adom.target         = $('adhd-target');
  Adom.liveHud        = $('adhd-live-hud');
  Adom.timerText      = $('adhd-timer-text');
  Adom.hudTimerArc    = $('hud-timer-arc');
  Adom.hudBcea        = $('hud-bcea');
  Adom.hudSamples     = $('hud-samples');
  Adom.hudSwj         = $('hud-swj');
  Adom.hudStability   = $('hud-stability');
  Adom.hudBlinks      = $('hud-blinks');
  Adom.swjAlert       = $('adhd-swj-alert');
  Adom.scatterCanvas  = $('adhd-scatter-canvas');
  Adom.resultsGaugeArc    = $('results-gauge-arc');
  Adom.gaugePctText       = $('gauge-pct-text');
  Adom.gaugeLabel         = $('gauge-label');
  Adom.gaugeNeedle        = $('gauge-needle');
  Adom.resultsScatter     = $('results-scatter-canvas');
  Adom.resultsTemporal    = $('results-temporal-canvas');
  Adom.rcBceaBadge  = $('rc-bcea-badge');
  Adom.rcBceaVal    = $('rc-bcea-val');
  Adom.rcBceaBar    = $('rc-bcea-bar');
  Adom.rcBceaDesc   = $('rc-bcea-desc');
  Adom.rcDriftBadge = $('rc-drift-badge');
  Adom.rcDriftVal   = $('rc-drift-val');
  Adom.rcDriftBar   = $('rc-drift-bar');
  Adom.rcDriftDesc  = $('rc-drift-desc');
  Adom.rcSwjBadge   = $('rc-swj-badge');
  Adom.rcSwjVal     = $('rc-swj-val');
  Adom.rcSwjBar     = $('rc-swj-bar');
  Adom.rcSwjDesc    = $('rc-swj-desc');
  Adom.rcQeBadge    = $('rc-qe-badge');
  Adom.rcQeVal      = $('rc-qe-val');
  Adom.rcQeBar      = $('rc-qe-bar');
  Adom.rcQeDesc     = $('rc-qe-desc');
  Adom.summaryIcon  = $('results-summary-icon');
  Adom.summaryTitle = $('results-summary-title');
  Adom.summaryBody  = $('results-summary-body');

  // Gaze-dot element for debug overlay
  Adom.gazeDot = $('gaze-dot');

  // CalApp.dom wiring for face-tracking.js
  CalApp.dom.faceBoundaryBox     = $('face-boundary-box');
  CalApp.dom.faceInfoBadge       = $('face-info-badge');
  CalApp.dom.fiOffset            = $('fi-offset');
  CalApp.dom.fiDepth             = $('fi-depth');
  CalApp.dom.fiStatus            = $('fi-status');
  CalApp.dom.positionWarning     = $('position-warning');
  CalApp.dom.positionWarningText = $('position-warning-text');
  CalApp.dom.gazeDot             = $('gaze-dot');

  // Recalibrate overlay DOM (mirrors calibration.html)
  CalApp.dom.recalibrateOvl      = $('recalibrate-overlay');
  CalApp.dom.recalibrateTitle    = $('recalibrate-title');
  CalApp.dom.recalibrateMsg      = $('recalibrate-message');
  CalApp.dom.recalibrateAccuracy = $('recalibrate-accuracy');
  CalApp.dom.recheckBtn          = $('recheck-btn');
  // stat-accuracy doesn't exist on this page; provide a stub so evaluateRecheck won't crash
  CalApp.dom.statAcc = { textContent: '' };

  // After recheck completes, restore the active task gaze listener and
  // resume face monitoring (replaces startGazeDemo which is calibration-only)
  var _originalTriggerAT = CalApp.triggerAccuracyRecheck;
  CalApp.triggerAccuracyRecheck = function () {
    atPauseTask();
    _originalTriggerAT.call(CalApp);
  };

  CalApp.startGazeDemo = function () {
    if (typeof AT_activeGazeListener === 'function') {
      webgazer.setGazeListener(AT_activeGazeListener);
    }
    CalApp.startFaceMonitoring();
    atResumeTask();
  };

  // After recheck, apply tol80 (80th-percentile gaze distance) as the
  // Quiet Eye radius, then run the default evaluateRecheck logic.
  var _originalEvalAT = CalApp.evaluateRecheck;
  CalApp.evaluateRecheck = function () {
    var s  = CalApp.state;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var raw = s.recheckSamples || [];
    if (raw.length > 10) {
      var trimmed = raw.slice(Math.floor(raw.length * 0.4));
      var dists = trimmed.map(function (pt) {
        return Math.sqrt(Math.pow(pt.x - cx, 2) + Math.pow(pt.y - cy, 2));
      }).sort(function (a, b) { return a - b; });
      var tol80 = Math.round(dists[Math.floor(dists.length * 0.8)] || 0);
      if (tol80 > 0) ADHD.QE_RADIUS_PX = Math.max(20, Math.min(300, tol80));
    }
    _originalEvalAT.call(CalApp);
  };
}

// ── Screen helpers ─────────────────────────────────────────────────────────

function showScreen(name) {
  var screens = {
    intro:   Adom.introScreen,
    task:    Adom.taskScreen,
    results: Adom.resultsScreen,
  };
  Object.values(screens).forEach(function (s) { s.classList.remove('active'); });
  screens[name].classList.add('active');
}

function showLoading() { Adom.loadingOvl.classList.add('active'); }
function hideLoading() { Adom.loadingOvl.classList.remove('active'); }
// 'accuracy' → retry accuracy check; 'init' → back to intro
var ADHD_retryAction = null;

function showError(title, msg, retryAction) {
  hideLoading();
  ADHD_retryAction = retryAction || 'intro';
  Adom.errorTitle.textContent = title;
  Adom.errorMsg.textContent   = msg;
  Adom.errorOvl.classList.add('active');
}

// ── WebGazer bootstrap ────────────────────────────────────────────────────

async function initWebGazer() {
  if (typeof webgazer === 'undefined') {
    throw new Error('webgazer.js is not loaded.');
  }
  if (webgazer.params && typeof webgazer.params === 'object') {
    webgazer.params.faceMeshSolutionPath =
      'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';
  }
  if (typeof webgazer.setRegression          === 'function') webgazer.setRegression('ridge');
  if (typeof webgazer.setTracker             === 'function') webgazer.setTracker('TFFacemesh');
  if (typeof webgazer.applyKalmanFilter      === 'function') webgazer.applyKalmanFilter(true);
  if (typeof webgazer.saveDataAcrossSessions === 'function') webgazer.saveDataAcrossSessions(true);
  if (typeof webgazer.showPredictionPoints   === 'function') webgazer.showPredictionPoints(false);
  // Must stay true during begin() so WebGazer creates the video feed element correctly.
  // We hide the camera preview via CSS after initialization completes.
  if (typeof webgazer.showVideoPreview       === 'function') webgazer.showVideoPreview(true);
  if (typeof webgazer.showFaceOverlay        === 'function') webgazer.showFaceOverlay(false);
  if (typeof webgazer.showFaceFeedbackBox    === 'function') webgazer.showFaceFeedbackBox(false);

  await webgazer.begin();

  // Hide camera preview after a successful begin — keeps it out of the task UI
  // without preventing WebGazer from creating its internal DOM nodes.
  var hide = ['webgazerVideoContainer', 'webgazerFaceOverlay', 'webgazerFaceFeedbackBox'];
  hide.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; }
  });

  if (typeof webgazer.removeMouseEventListeners === 'function') {
    webgazer.removeMouseEventListeners();
  }
}

// ── Stats helpers ─────────────────────────────────────────────────────────

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  var m = mean(arr);
  return arr.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (arr.length - 1);
}

function stdDev(arr) { return Math.sqrt(variance(arr)); }

function pearsonR(xs, ys) {
  if (xs.length < 2) return 0;
  var mx = mean(xs), my = mean(ys);
  var num = 0, dx2 = 0, dy2 = 0;
  for (var i = 0; i < xs.length; i++) {
    var dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  var denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

/**
 * Bivariate Contour Ellipse Area
 * BCEA = 2π · σx · σy · √(1 − ρ²)
 * Returns value in degrees²
 */
function computeBCEA(xArr, yArr) {
  if (xArr.length < 3) return 0;
  var sigmaX = stdDev(xArr) / ADHD.PX_PER_DEG;
  var sigmaY = stdDev(yArr) / ADHD.PX_PER_DEG;
  var rho    = pearsonR(xArr, yArr);
  var rhoSq  = Math.min(rho * rho, 0.9999);
  return 2 * Math.PI * sigmaX * sigmaY * Math.sqrt(1 - rhoSq);
}

// ── Square Wave Jerk detection ────────────────────────────────────────────

/**
 * Called on every new gaze sample.
 * SWJ pattern: large fast saccade away → rapid return toward origin within SWJ_RETURN_WINDOW_MS.
 */
function detectSWJ(newPt) {
  var prev = AT.prevGaze;
  if (!prev) { AT.prevGaze = newPt; return; }

  var dt = newPt.t - prev.t;
  if (dt <= 0) return;

  var dx = newPt.x - prev.x;
  var dy = newPt.y - prev.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var vel  = dist / (dt / 1000); // px/s

  // Detect outward saccade
  if (vel >= ADHD.SWJ_MIN_VELOCITY_PX_S && dist >= ADHD.SWJ_MIN_AMP_PX) {
    if (!AT.pendingSaccade) {
      AT.pendingSaccade = {
        originX: prev.x,
        originY: prev.y,
        peakX:   newPt.x,
        peakY:   newPt.y,
        t:       newPt.t,
        vel:     vel,
      };
    } else {
      // Second fast saccade — check if it's a return
      var sac = AT.pendingSaccade;
      var elapsed = newPt.t - sac.t;
      if (elapsed <= ADHD.SWJ_RETURN_WINDOW_MS) {
        // Return vector: from peak back toward origin?
        var returnDx = newPt.x - sac.peakX;
        var returnDy = newPt.y - sac.peakY;
        var originDx = sac.originX - sac.peakX;
        var originDy = sac.originY - sac.peakY;
        // Dot product > 0 means return is toward origin
        var dot = returnDx * originDx + returnDy * originDy;
        if (dot > 0) {
          AT.swjCount++;
          flashSwjAlert();
          AT.pendingSaccade = null;
          Adom.hudSwj.textContent = AT.swjCount;
        } else {
          // New outward saccade, reset pending
          AT.pendingSaccade = {
            originX: prev.x,
            originY: prev.y,
            peakX:   newPt.x,
            peakY:   newPt.y,
            t:       newPt.t,
            vel:     vel,
          };
        }
      } else {
        // Expired, reset
        AT.pendingSaccade = {
          originX: prev.x,
          originY: prev.y,
          peakX:   newPt.x,
          peakY:   newPt.y,
          t:       newPt.t,
          vel:     vel,
        };
      }
    }
  } else {
    // Slow movement — if pending saccade exists check if it expired
    if (AT.pendingSaccade && (newPt.t - AT.pendingSaccade.t) > ADHD.SWJ_RETURN_WINDOW_MS) {
      AT.pendingSaccade = null;
    }
  }

  AT.prevGaze = newPt;
}

var swjAlertTimeout = null;
function flashSwjAlert() {
  Adom.swjAlert.textContent = '⚡ Saccadic Intrusion';
  Adom.swjAlert.classList.add('active');
  if (swjAlertTimeout) clearTimeout(swjAlertTimeout);
  swjAlertTimeout = setTimeout(function () {
    Adom.swjAlert.classList.remove('active');
  }, 700);
}

// ── Live scatter canvas ───────────────────────────────────────────────────

function initScatterCanvas() {
  var canvas = Adom.scatterCanvas;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  AT.scatterCtx = canvas.getContext('2d');
}

function plotLiveDot(x, y) {
  var ctx = AT.scatterCtx;
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(124,92,252,0.35)';
  ctx.fill();
}

// ── Live HUD updates ──────────────────────────────────────────────────────

function updateLiveHud() {
  var data = AT.gazeData;
  var n    = data.length;
  Adom.hudSamples.textContent = n;

  // Rolling BCEA over last N samples
  var window = data.slice(-ADHD.LIVE_BCEA_WINDOW);
  if (window.length >= 5) {
    var xs = window.map(function (p) { return p.x; });
    var ys = window.map(function (p) { return p.y; });
    var bcea = computeBCEA(xs, ys);
    Adom.hudBcea.textContent = bcea.toFixed(2) + '°²';

    // Stability label
    if (bcea < ADHD.BCEA_TD_THRESHOLD) {
      Adom.hudStability.textContent = 'Stable';
      Adom.hudStability.className   = 'hud-metric-val stability-good';
    } else if (bcea < ADHD.BCEA_ADHD_THRESHOLD) {
      Adom.hudStability.textContent = 'Moderate';
      Adom.hudStability.className   = 'hud-metric-val stability-warn';
    } else {
      Adom.hudStability.textContent = 'Unstable';
      Adom.hudStability.className   = 'hud-metric-val stability-bad';
    }
  }
}

// ── Countdown ─────────────────────────────────────────────────────────────

function runCountdown(callback) {
  Adom.countdown.style.display = 'flex';
  Adom.target.style.display    = 'none';
  Adom.liveHud.style.display   = 'none';

  var n   = ADHD.COUNTDOWN_DURATION_S;
  var arc = Adom.countdownArc;
  var FULL_DASH = 276.46;

  function tick() {
    Adom.countdownNum.textContent = n;
    arc.style.strokeDashoffset = (FULL_DASH * (1 - n / ADHD.COUNTDOWN_DURATION_S)).toFixed(2);
    if (n <= 0) {
      Adom.countdown.style.display = 'none';
      callback();
      return;
    }
    n--;
    setTimeout(tick, 1000);
  }
  tick();
}

// ── Accuracy Test (before task begins) ────────────────────────────────────

/**
 * Phase 1 — show an advance warning card for 2.5 s, then hand off to the
 * gold-dot measurement phase.  Mirrors the approach in calibration.html.
 */
function startAccuracyTest() {
  showScreen('task');

  // Keep task UI hidden while the accuracy flow runs
  Adom.target.style.display    = 'none';
  Adom.liveHud.style.display   = 'none';
  Adom.countdown.style.display = 'none';

  // ── Warning card ─────────────────────────────────────────────────────────
  var warningCard = document.createElement('div');
  warningCard.className = 'acc-warning-card';
  warningCard.innerHTML =
    '<div class="acc-warning-icon">&#127919;</div>' +
    '<h3>Accuracy Check</h3>' +
    '<p>A gold dot will appear at the centre of the screen.<br>' +
    'Stare <strong>directly at it</strong> for 3 seconds — don\u2019t move your eyes.</p>';
  Adom.taskScreen.appendChild(warningCard);
  requestAnimationFrame(function () { warningCard.classList.add('visible'); });

  setTimeout(function () {
    warningCard.style.opacity = '0';
    setTimeout(function () {
      warningCard.remove();
      startAccuracyDotPhase();
    }, 400);
  }, 2500);
}

/**
 * Phase 2 — display the animated gold dot (reuses .acc-dot from styles.css
 * just like calibration.html), collect gaze samples, compute accuracy.
 */
function startAccuracyDotPhase() {
  // Gold dot — uses the shared .acc-dot class (acc-pulse animation in styles.css)
  var accDot = document.createElement('div');
  accDot.className = 'acc-dot';
  Adom.taskScreen.appendChild(accDot);
  requestAnimationFrame(function () { accDot.classList.add('visible'); });

  // Instruction banner at top (mirrors calibration.html instruction banner)
  var instrBanner = document.createElement('div');
  instrBanner.className = 'acc-instr-banner';
  Adom.taskScreen.appendChild(instrBanner);

  // Collect gaze samples
  var accSamples = [];
  AT_activeGazeListener = function (data) {
    if (!data) return;
    accSamples.push({ x: data.x, y: data.y });
    if (AT.debugSettings.gazeDot && Adom.gazeDot) {
      Adom.gazeDot.style.left = data.x + 'px';
      Adom.gazeDot.style.top  = data.y + 'px';
    }
  };
  webgazer.setGazeListener(AT_activeGazeListener);

  var remaining = 3;
  function countdownTick() {
    instrBanner.textContent =
      'Look at the gold dot \u2014 measuring accuracy\u2026 ' + remaining + 's';
    remaining--;
    if (remaining < 0) {
      accDot.classList.remove('visible');
      setTimeout(function () {
        accDot.remove();
        instrBanner.remove();

        // Stop gaze listener
        if (typeof webgazer.clearGazeListener === 'function') {
          webgazer.clearGazeListener();
        } else {
          webgazer.setGazeListener(null);
        }

        // Calculate accuracy
        var cx = window.innerWidth  / 2;
        var cy = window.innerHeight / 2;

        // Discard first 40 % of samples (model settling time)
        if (accSamples.length > 10) {
          accSamples = accSamples.slice(Math.floor(accSamples.length * 0.4));
        }

        var accuracy = 0;
        if (accSamples.length > 0) {
          var avgErr = accSamples.reduce(function (sum, pt) {
            var dx = pt.x - cx, dy = pt.y - cy;
            return sum + Math.sqrt(dx * dx + dy * dy);
          }, 0) / accSamples.length;
          var maxDist = Math.sqrt(
            window.innerWidth  * window.innerWidth +
            window.innerHeight * window.innerHeight
          );
          accuracy = Math.max(0, Math.min(100, 100 - (avgErr / maxDist) * 190));
        }

        if (accuracy >= 80) {
          startTask();
        } else {
          showError(
            'Accuracy Below Threshold',
            'Your gaze accuracy is ' + accuracy.toFixed(1) + '%, below the required 80%. ' +
            'Please look at the centre dot again and retry.',
            'accuracy'
          );
        }
      }, 350);
      return;
    }
    setTimeout(countdownTick, 1000);
  }
  countdownTick();
}

// ── Task execution ────────────────────────────────────────────────────────

function startTask() {
  AT.gazeData       = [];
  AT.swjCount       = 0;
  AT.pendingSaccade = null;
  AT.prevGaze       = null;
  AT.taskStartTime  = 0;
  AT.remainingSecs  = 0;
  AT.paused         = false;
  AT.pauseStartTime = 0;
  AT.blinkCount     = 0;
  AT.blinkNullCount = 0;
  AT.lastBlinkTime  = 0;

  // Reset HUD
  Adom.hudBcea.textContent      = '—';
  Adom.hudSamples.textContent   = '0';
  Adom.hudSwj.textContent       = '0';
  Adom.hudStability.textContent = '—';
  Adom.hudStability.className   = 'hud-metric-val';
  if (Adom.hudBlinks) Adom.hudBlinks.textContent = '0';

  AT.targetX = window.innerWidth  / 2;
  AT.targetY = window.innerHeight / 2;

  initScatterCanvas();
  AT.scatterCtx.clearRect(0, 0, Adom.scatterCanvas.width, Adom.scatterCanvas.height);

  showScreen('task');
  runCountdown(function () {
    Adom.target.style.display  = 'flex';
    Adom.liveHud.style.display = 'flex';
    runFixationWindow();
  });
}

// ---------- Pause / Resume (triggered by CalApp.triggerAccuracyRecheck) ----------
function atPauseTask() {
  if (!AT.taskStartTime || AT.paused) return;
  AT.paused         = true;
  AT.pauseStartTime = Date.now();
  clearInterval(AT.hudTimer);
  clearTimeout(AT.taskTimer);
  clearTimeout(AT.finishTimer);
  try {
    if (typeof webgazer.clearGazeListener === 'function') webgazer.clearGazeListener();
    else webgazer.setGazeListener(null);
  } catch (_) {}
  if (Adom.timerText) Adom.timerText.textContent = '⏸';
}

function atResumeTask() {
  if (!AT.paused) return;
  var pauseDuration = Date.now() - AT.pauseStartTime;
  AT.paused         = false;
  AT.taskStartTime += pauseDuration;   // shift anchor so gaze timestamps remain valid

  // Re-install gaze listener
  if (typeof AT_activeGazeListener === 'function') {
    webgazer.setGazeListener(AT_activeGazeListener);
  }

  // Restart HUD
  AT.hudTimer = setInterval(updateLiveHud, 200);

  // Restart countdown from remaining time
  atStartClockTick();

  // Re-arm the finish timer for only the time remaining
  AT.finishTimer = setTimeout(finishTask, AT.remainingSecs * 1000);
}
// ---------------------------------------------------------------------------------

function runFixationWindow() {
  AT.taskStartTime   = Date.now();
  AT.remainingSecs   = ADHD.TASK_DURATION_MS / 1000;
  AT.paused          = false;

  // Blink detection thresholds
  var AT_BLINK_NULL_THRESHOLD = 4;   // consecutive null frames = tracking loss
  var AT_BLINK_DROP_THRESHOLD = 90;  // px downward jump = eyelid artifact
  var AT_BLINK_COOLDOWN       = 600; // ms between blink events

  // Install high-frequency gaze listener
  AT_activeGazeListener = function (data) {
    if (!data) {
      // Tracking lost — count consecutive null frames as a blink
      AT.blinkNullCount++;
      if (AT.blinkNullCount === AT_BLINK_NULL_THRESHOLD) {
        var nowB = Date.now();
        if (nowB - AT.lastBlinkTime > AT_BLINK_COOLDOWN) {
          AT.blinkCount++;
          AT.lastBlinkTime = nowB;
          if (Adom.hudBlinks) Adom.hudBlinks.textContent = AT.blinkCount;
        }
        // Reset prevGaze so SWJ detector doesn't register a ghost jump on resume
        AT.prevGaze = null;
      }
      return;
    }
    // Skip first valid frame after a tracking-loss blink (artifact position)
    if (AT.blinkNullCount >= AT_BLINK_NULL_THRESHOLD) {
      AT.blinkNullCount = 0;
      return;
    }
    // Detect sudden large downward jump (eyelid closing artifact)
    if (AT.blinkNullCount === 0 && AT.prevGaze) {
      var dyB = data.y - AT.prevGaze.y;
      if (dyB > AT_BLINK_DROP_THRESHOLD) {
        var nowB2 = Date.now();
        if (nowB2 - AT.lastBlinkTime > AT_BLINK_COOLDOWN) {
          AT.blinkCount++;
          AT.lastBlinkTime = nowB2;
          if (Adom.hudBlinks) Adom.hudBlinks.textContent = AT.blinkCount;
        }
        // Discard this artifact frame — exclude from BCEA, QE, and SWJ analysis
        AT.prevGaze = null;
        return;
      }
    }
    AT.blinkNullCount = 0;
    var t   = Date.now() - AT.taskStartTime;
    var pt  = { x: data.x, y: data.y, t: t };
    AT.gazeData.push(pt);
    plotLiveDot(data.x, data.y);
    detectSWJ(pt);
    if (AT.debugSettings.gazeDot && Adom.gazeDot) {
      Adom.gazeDot.style.left = data.x + 'px';
      Adom.gazeDot.style.top  = data.y + 'px';
    }
  };
  webgazer.setGazeListener(AT_activeGazeListener);

  // HUD refresh (every 200ms)
  AT.hudTimer = setInterval(updateLiveHud, 200);

  atStartClockTick();

  // End task after full duration
  AT.finishTimer = setTimeout(finishTask, ADHD.TASK_DURATION_MS);
}

var FULL_DASH_HUD = 100;

function atStartClockTick() {
  var totalSecs = ADHD.TASK_DURATION_MS / 1000;
  (function clockTick() {
    if (AT.paused) return;  // stop firing while paused
    Adom.timerText.textContent = AT.remainingSecs;
    var progress = 1 - (AT.remainingSecs / totalSecs);
    Adom.hudTimerArc.style.strokeDashoffset =
      (FULL_DASH_HUD * (1 - progress)).toFixed(2);
    if (AT.remainingSecs <= 0) return;
    AT.remainingSecs--;
    AT.taskTimer = setTimeout(clockTick, 1000);
  })();
}

function finishTask() {
  clearInterval(AT.hudTimer);
  clearTimeout(AT.taskTimer);
  AT_activeGazeListener = null;

  // Remove gaze listener
  try {
    if (typeof webgazer.clearGazeListener === 'function') {
      webgazer.clearGazeListener();
    } else {
      webgazer.setGazeListener(null);
    }
  } catch (_) {}

  CalApp.stopFaceMonitoring();

  computeAndDisplayResults();
}

// ── Result computation ────────────────────────────────────────────────────

function computeAndDisplayResults() {
  var data = AT.gazeData;

  if (data.length < 10) {
    showError('Insufficient Data',
      'Too few gaze samples were collected. Ensure the camera has a clear view of your eyes and try again.');
    return;
  }

  var xs = data.map(function (p) { return p.x; });
  var ys = data.map(function (p) { return p.y; });

  // ── 1. Full-window BCEA ───────────────────────────────────────────────
  var bcea = computeBCEA(xs, ys);

  // ── 2. Variance drift: compare first 10s vs last 10s ─────────────────
  var cutoff10 = 10000;
  var cutoff20 = 20000;
  var first10  = data.filter(function (p) { return p.t <  cutoff10; });
  var last10   = data.filter(function (p) { return p.t >= cutoff20; });

  var earlyVar = 0, lateVar = 0, driftPct = 0;
  if (first10.length >= 3 && last10.length >= 3) {
    var fx = first10.map(function (p) { return p.x; });
    var fy = first10.map(function (p) { return p.y; });
    var lx = last10.map(function (p)  { return p.x; });
    var ly = last10.map(function (p)  { return p.y; });

    earlyVar = variance(fx) + variance(fy);
    lateVar  = variance(lx) + variance(ly);
    if (earlyVar > 0) {
      driftPct = (lateVar - earlyVar) / earlyVar;
    }
  }

  // ── 3. SWJ count ──────────────────────────────────────────────────────
  var swj = AT.swjCount;

  // ── 4. Quiet Eye percentage ───────────────────────────────────────────
  var onTarget = data.filter(function (p) {
    var dx = p.x - AT.targetX;
    var dy = p.y - AT.targetY;
    return Math.sqrt(dx * dx + dy * dy) <= ADHD.QE_RADIUS_PX;
  });
  var qePct = data.length > 0 ? onTarget.length / data.length : 0;

  // ── 5. Probability score ──────────────────────────────────────────────
  var prob = computeAdhdProbability(bcea, driftPct, swj, qePct);

  // ── 6. Temporal variance ─────────────────────────────────────────────
  var temporalBuckets = computeTemporalBuckets(data);

  // Persist to localStorage history for dashboard
  try {
    var history = [];
    var raw = localStorage.getItem('neurogaze_test_history');
    if (raw) history = JSON.parse(raw);
    // Downsample gaze points to max 300 for storage efficiency
    var xsSampled = [], ysSampled = [];
    var dsStep = Math.max(1, Math.floor(xs.length / 300));
    for (var dsi = 0; dsi < xs.length; dsi += dsStep) {
      xsSampled.push(Math.round(xs[dsi] * 100) / 100);
      ysSampled.push(Math.round(ys[dsi] * 100) / 100);
    }
    history.push({
      name: 'Fixation Stability Test',
      time: Date.now(),
      bcea: bcea,
      prob: prob,
      swj:  swj,
      qePct: qePct,
      driftPct: driftPct,
      temporalBuckets: temporalBuckets,
      xs: xsSampled,
      ys: ysSampled,
    });
    localStorage.setItem('neurogaze_test_history', JSON.stringify(history));
  } catch (_) {}

  // Render
  showScreen('results');
  renderResultsUI({
    bcea:            bcea,
    driftPct:        driftPct,
    earlyVar:        earlyVar,
    lateVar:         lateVar,
    swj:             swj,
    qePct:           qePct,
    prob:            prob,
    xs:              xs,
    ys:              ys,
    temporalBuckets: temporalBuckets,
    sampleCount:     data.length,
  });
}

// ── ADHD probability computation ─────────────────────────────────────────

/**
 * Evidence-based scoring across four biomarkers.
 * Each contributes a weighted sub-score (0–1) combining smoothly
 * above/below the clinical thresholds.
 */
function computeAdhdProbability(bcea, driftPct, swj, qePct) {
  // BCEA score: 0 at TD threshold, 1 at 2× ADHD threshold
  var bceaScore = sigmoidScore(
    bcea,
    ADHD.BCEA_TD_THRESHOLD,
    ADHD.BCEA_ADHD_THRESHOLD * 2
  );

  // Drift score: 0 at 0%, 1 at 75% increase
  var driftScore = sigmoidScore(
    Math.max(0, driftPct),
    0,
    0.75
  );

  // SWJ score: 0 at TD threshold, 1 at 2× ADHD threshold
  var swjScore = sigmoidScore(
    swj,
    ADHD.SWJ_TD_THRESHOLD,
    ADHD.SWJ_ADHD_THRESHOLD * 2
  );

  // QE score: low QE = higher ADHD signal
  var qeScore = sigmoidScore(
    1 - qePct,        // invert: low QE → high score
    1 - ADHD.QE_TD_THRESHOLD,
    1 - (ADHD.QE_ADHD_THRESHOLD / 2)
  );

  // Weighted combination (BCEA is primary biomarker)
  var weights = { bcea: 0.40, drift: 0.20, swj: 0.25, qe: 0.15 };
  var combined = (
    bceaScore  * weights.bcea  +
    driftScore * weights.drift +
    swjScore   * weights.swj   +
    qeScore    * weights.qe
  );

  return Math.min(1, Math.max(0, combined));
}

/**
 * Smooth mapping from [low, high] → [0, 1] using a logistic-like curve.
 * Values below `low` return ~0; values above `high` return ~1.
 */
function sigmoidScore(value, low, high) {
  if (high <= low) return value >= high ? 1 : 0;
  var normalized = (value - low) / (high - low);
  // Clamp raw then apply soft sigmoid
  var clamped = Math.max(0, Math.min(1, normalized));
  // Soften: S-curve emphasis in mid-range
  return clamped * clamped * (3 - 2 * clamped);
}

// ── Temporal bucketing ────────────────────────────────────────────────────

function computeTemporalBuckets(data) {
  var buckets = [];
  var bucketSize = ADHD.TASK_DURATION_MS / ADHD.TEMPORAL_BUCKETS;
  for (var i = 0; i < ADHD.TEMPORAL_BUCKETS; i++) {
    var tStart = i * bucketSize;
    var tEnd   = tStart + bucketSize;
    var slice  = data.filter(function (p) { return p.t >= tStart && p.t < tEnd; });
    if (slice.length >= 2) {
      var bx = slice.map(function (p) { return p.x; });
      var by = slice.map(function (p) { return p.y; });
      buckets.push(computeBCEA(bx, by));
    } else {
      buckets.push(0);
    }
  }
  return buckets;
}

// ── Results UI rendering ──────────────────────────────────────────────────

function renderResultsUI(r) {
  var prob    = r.prob;
  var probPct = Math.round(prob * 100);

  // ── Gauge animation ───────────────────────────────────────────────────
  animateGauge(prob, probPct);

  // ── BCEA card ─────────────────────────────────────────────────────────
  var bceaStatus = r.bcea < ADHD.BCEA_TD_THRESHOLD   ? 'td'
                 : r.bcea < ADHD.BCEA_ADHD_THRESHOLD  ? 'borderline'
                 : 'adhd';
  setBadge(Adom.rcBceaBadge, bceaStatus);
  Adom.rcBceaVal.textContent  = r.bcea.toFixed(3) + ' °²';
  var bceaBarPct = Math.min(100, (r.bcea / (ADHD.BCEA_ADHD_THRESHOLD * 2)) * 100);
  Adom.rcBceaBar.style.width  = bceaBarPct.toFixed(1) + '%';
  Adom.rcBceaBar.className    = 'rc-bar ' + bceaStatus;
  Adom.rcBceaDesc.textContent = describeBcea(r.bcea);

  // ── Drift card ────────────────────────────────────────────────────────
  var driftPct    = r.driftPct;
  var driftStatus = driftPct < ADHD.DRIFT_ADHD_THRESHOLD ? 'td' : 'adhd';
  setBadge(Adom.rcDriftBadge, driftStatus);
  Adom.rcDriftVal.textContent  = (driftPct >= 0 ? '+' : '') + (driftPct * 100).toFixed(1) + '%';
  var driftBarPct = Math.min(100, Math.max(0, (driftPct / 0.75) * 100));
  Adom.rcDriftBar.style.width  = driftBarPct.toFixed(1) + '%';
  Adom.rcDriftBar.className    = 'rc-bar ' + driftStatus;
  Adom.rcDriftDesc.textContent = describeDrift(driftPct);

  // ── SWJ card ──────────────────────────────────────────────────────────
  var swjStatus = r.swj < ADHD.SWJ_TD_THRESHOLD   ? 'td'
                : r.swj < ADHD.SWJ_ADHD_THRESHOLD  ? 'borderline'
                : 'adhd';
  setBadge(Adom.rcSwjBadge, swjStatus);
  Adom.rcSwjVal.textContent  = r.swj + ' events';
  var swjBarPct = Math.min(100, (r.swj / (ADHD.SWJ_ADHD_THRESHOLD * 2)) * 100);
  Adom.rcSwjBar.style.width  = swjBarPct.toFixed(1) + '%';
  Adom.rcSwjBar.className    = 'rc-bar ' + swjStatus;
  Adom.rcSwjDesc.textContent = describeSwj(r.swj);

  // ── QE card ───────────────────────────────────────────────────────────
  var qeStatus = r.qePct > ADHD.QE_TD_THRESHOLD   ? 'td'
               : r.qePct > ADHD.QE_ADHD_THRESHOLD  ? 'borderline'
               : 'adhd';
  setBadge(Adom.rcQeBadge, qeStatus);
  Adom.rcQeVal.textContent  = (r.qePct * 100).toFixed(1) + '%';
  var qeBarPct = Math.min(100, r.qePct * 100);
  Adom.rcQeBar.style.width  = qeBarPct.toFixed(1) + '%';
  Adom.rcQeBar.className    = 'rc-bar qe-' + qeStatus;
  Adom.rcQeDesc.textContent = describeQe(r.qePct);

  // ── Scatter plot ──────────────────────────────────────────────────────
  renderScatterPlot(r.xs, r.ys, r.bcea);

  // ── Temporal chart ────────────────────────────────────────────────────
  renderTemporalChart(r.temporalBuckets);

  // ── Summary ───────────────────────────────────────────────────────────
  renderSummary(probPct, r.bcea, r.driftPct, r.swj, r.qePct);
}

function animateGauge(prob, probPct) {
  // Arc: 283 = full semicircle dasharray
  var ARC_FULL = 283;
  var color = prob < 0.35 ? '#4cd964'
            : prob < 0.60 ? '#ffcc00'
            : prob < 0.80 ? '#ff9500'
            :               '#ff3b30';

  var arc = Adom.resultsGaugeArc;
  arc.style.stroke = color;

  // Animate from 0 to target
  var start   = performance.now();
  var duration = 1200;
  (function frame(ts) {
    var t = Math.min(1, (ts - start) / duration);
    // Ease-out cubic
    var eased = 1 - Math.pow(1 - t, 3);
    var offset = ARC_FULL * (1 - eased * prob);
    arc.style.strokeDashoffset = offset.toFixed(2);

    // Needle: rotate from -90 to (-90 + 180*prob) degrees
    var deg = -90 + 180 * eased * prob;
    Adom.gaugeNeedle.setAttribute('transform', 'rotate(' + deg.toFixed(1) + ' 100 100)');

    Adom.gaugePctText.textContent = Math.round(eased * probPct) + '%';

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      Adom.gaugePctText.textContent = probPct + '%';
      Adom.gaugePctText.style.color = color;
    }
  })(start);

  // Label
  Adom.gaugeLabel.textContent =
    prob < 0.35 ? 'Neurotypical Pattern' :
    prob < 0.60 ? 'Mild Attention Markers' :
    prob < 0.80 ? 'Elevated ADHD Indicators' :
                  'Strong ADHD Biomarkers';
  Adom.gaugeLabel.style.color = color;
}

function setBadge(el, status) {
  el.className = 'rc-badge badge-' + status;
  el.textContent = status === 'td'         ? 'Neurotypical'
                 : status === 'borderline' ? 'Borderline'
                 :                          'ADHD Marker';
}

function describeBcea(bcea) {
  if (bcea < ADHD.BCEA_TD_THRESHOLD)  return 'Gaze is tightly clustered. Fixation stability is within neurotypical norms.';
  if (bcea < ADHD.BCEA_ADHD_THRESHOLD) return 'Gaze dispersion is moderately elevated. Attention stability shows some instability.';
  return 'High gaze dispersion detected. Gaze instability significantly exceeds neurotypical baselines, consistent with inhibitory control deficits observed in ADHD.';
}

function describeDrift(drift) {
  if (drift < 0) return 'Gaze variance actually decreased over time — attention appears to have improved.';
  if (drift < ADHD.DRIFT_ADHD_THRESHOLD) return 'Attention stability was maintained throughout the task. No significant variance drift.';
  return 'Gaze variance increased by ' + (drift * 100).toFixed(0) + '% from the first 10s to the last 10s, indicating attention fatigue consistent with ADHD.';
}

function describeSwj(swj) {
  if (swj < ADHD.SWJ_TD_THRESHOLD)  return 'Very few saccadic intrusions. Fixation was maintained with minimal involuntary eye movements.';
  if (swj < ADHD.SWJ_ADHD_THRESHOLD) return 'Moderate saccadic intrusions detected. Some involuntary eye movement during fixation.';
  return swj + ' Square Wave Jerks detected. Frequent involuntary saccades and returns indicate impaired fixation stability, a strong ADHD biomarker.';
}

function describeQe(qe) {
  if (qe > ADHD.QE_TD_THRESHOLD)  return 'Extended Quiet Eye maintained. Sustained on-target fixation is consistent with strong inhibitory control.';
  if (qe > ADHD.QE_ADHD_THRESHOLD) return 'Moderate Quiet Eye duration. Some difficulty maintaining on-target fixation.';
  return 'Short Quiet Eye phase (' + (qe * 100).toFixed(0) + '%). Reduced ability to sustain on-target gaze is a marker of inhibitory control deficits.';
}

// ── Scatter plot ──────────────────────────────────────────────────────────

function renderScatterPlot(xs, ys, bcea) {
  var canvas = Adom.resultsScatter;
  var dpr    = window.devicePixelRatio || 1;
  var cssW   = canvas.offsetWidth  || canvas.width;
  var cssH   = canvas.offsetHeight || canvas.height;
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);

  if (xs.length === 0) return;

  var mx = mean(xs), my = mean(ys);
  var sx = stdDev(xs), sy = stdDev(ys);
  var rho = pearsonR(xs, ys);

  // Map world coords to canvas: center at (W/2, H/2), scale by 3σ
  // Use the smaller axis as the reference so gaze coords and ellipses stay square
  var ref   = Math.min(W, H);
  var range = Math.max(sx, sy, 20) * 4;
  function mapX(x) { return W / 2 + ((x - mx) / range) * (ref * 0.42); }
  function mapY(y) { return H / 2 + ((y - my) / range) * (ref * 0.42); }

  // Background
  ctx.fillStyle = 'rgba(10,10,26,0.95)';
  ctx.fillRect(0, 0, W, H);

  // TD ellipse (1.5°²)
  var tdR = (ADHD.BCEA_TD_THRESHOLD   / (2 * Math.PI) / Math.max(1 - rho * rho, 0.01)) * 0.5 * (ref * 0.35) / range * ADHD.PX_PER_DEG;
  drawEllipse(ctx, W / 2, H / 2, tdR, tdR,
    'rgba(76, 217, 100, 0.18)', 'rgba(76, 217, 100, 0.45)', 1.5);

  // ADHD ellipse (3.0°²)
  var adhdR = (ADHD.BCEA_ADHD_THRESHOLD / (2 * Math.PI) / Math.max(1 - rho * rho, 0.01)) * 0.5 * (ref * 0.35) / range * ADHD.PX_PER_DEG;
  drawEllipse(ctx, W / 2, H / 2, adhdR, adhdR,
    'rgba(255, 59, 48, 0.10)', 'rgba(255, 59, 48, 0.35)', 1.5);

  // Gaze points
  var maxPts = Math.min(xs.length, 800);
  var step   = Math.max(1, Math.floor(xs.length / maxPts));
  for (var i = 0; i < xs.length; i += step) {
    ctx.beginPath();
    ctx.arc(mapX(xs[i]), mapY(ys[i]), 2, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(124, 92, 252, 0.55)';
    ctx.fill();
  }

  // Centroid
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 5, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // Crosshair at centroid
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(W / 2, 0);     ctx.lineTo(W / 2, H);     ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, H / 2);     ctx.lineTo(W, H / 2);     ctx.stroke();
  ctx.setLineDash([]);
}

function drawEllipse(ctx, cx, cy, rx, ry, fill, stroke, lw) {
  rx = Math.max(rx, 4);
  ry = Math.max(ry, 4);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
  ctx.fillStyle   = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth   = lw;
  ctx.stroke();
}

// ── Temporal chart ────────────────────────────────────────────────────────

function renderTemporalChart(buckets) {
  var canvas = Adom.resultsTemporal;
  var dpr    = window.devicePixelRatio || 1;
  var cssW   = canvas.offsetWidth  || canvas.width;
  var cssH   = canvas.offsetHeight || canvas.height;
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  var W = cssW, H = cssH;
  ctx.clearRect(0, 0, W, H);

  if (buckets.length === 0) return;

  var maxVal = Math.max.apply(null, buckets);
  maxVal     = Math.max(maxVal, ADHD.BCEA_ADHD_THRESHOLD * 1.5);

  var padL = 38, padR = 14, padT = 12, padB = 28;
  var chartW = W - padL - padR;
  var chartH = H - padT - padB;

  function xPos(i) { return padL + (i / (buckets.length - 1)) * chartW; }
  function yPos(v) { return padT + chartH - (v / maxVal) * chartH; }

  // Background
  ctx.fillStyle = 'rgba(10,10,26,0.95)';
  ctx.fillRect(0, 0, W, H);

  // Threshold lines
  function threshLine(val, color, label) {
    var y = yPos(val);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.font = '10px sans-serif';
    ctx.fillText(label, padL + 4, y - 3);
  }
  threshLine(ADHD.BCEA_TD_THRESHOLD,   'rgba(76,217,100,0.7)',  'TD 1.5°²');
  threshLine(ADHD.BCEA_ADHD_THRESHOLD, 'rgba(255,59,48,0.7)',   'ADHD 3.0°²');

  // Fill area
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(buckets[0]));
  for (var i = 1; i < buckets.length; i++) {
    ctx.lineTo(xPos(i), yPos(buckets[i]));
  }
  ctx.lineTo(xPos(buckets.length - 1), padT + chartH);
  ctx.lineTo(xPos(0), padT + chartH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(124,92,252,0.15)';
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(xPos(0), yPos(buckets[0]));
  for (var j = 1; j < buckets.length; j++) {
    ctx.lineTo(xPos(j), yPos(buckets[j]));
  }
  ctx.strokeStyle = '#7c5cfc';
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  // X-axis labels
  ctx.fillStyle = '#555'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  [0, 10, 20, 30].forEach(function (sec) {
    var i = Math.round((sec / 30) * (buckets.length - 1));
    ctx.fillText(sec + 's', xPos(i), H - 6);
  });

  // Y-axis labels
  ctx.textAlign = 'right';
  [0, maxVal / 2, maxVal].forEach(function (v) {
    ctx.fillText(v.toFixed(1), padL - 4, yPos(v) + 3);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────

function renderSummary(probPct, bcea, drift, swj, qe) {
  var icon, title, body;

  if (probPct < 25) {
    icon  = '✅';
    title = 'Neurotypical Fixation Pattern';
    body  = 'Your gaze stability is within normal ranges. BCEA, variance drift, and saccadic intrusion counts all fall within neurotypical baselines. No significant inhibitory control deficit detected.';
    Adom.summaryIcon.className = 'summary-icon summary-td';
  } else if (probPct < 50) {
    icon  = '🟡';
    title = 'Mild Attention Instability';
    body  = 'Some biomarkers deviate from neurotypical baselines. This may reflect subclinical attention variability, fatigue, or measurement noise. Consider retesting after rest.';
    Adom.summaryIcon.className = 'summary-icon summary-border';
  } else if (probPct < 75) {
    icon  = '🟠';
    title = 'Elevated ADHD Indicators';
    body  = 'Multiple biomarkers indicate elevated gaze instability. Increased BCEA and/or saccadic intrusions are consistent with inhibitory control deficits associated with ADHD. This is not a clinical diagnosis — please consult a specialist.';
    Adom.summaryIcon.className = 'summary-icon summary-elevated';
  } else {
    icon  = '🔴';
    title = 'Strong ADHD Biomarker Profile';
    body  = 'Significantly elevated gaze dispersion, variance drift, and saccadic intrusions were detected. This profile is strongly consistent with patterns observed in ADHD populations. Results should be shared with a qualified clinician for formal assessment.';
    Adom.summaryIcon.className = 'summary-icon summary-adhd';
  }

  Adom.summaryIcon.textContent  = icon;
  Adom.summaryTitle.textContent = title;

  // Detailed stats appendage
  var statsDetail =
    ' [BCEA=' + bcea.toFixed(2) + '°², Drift=' + (drift * 100).toFixed(0) +
    '%, SWJs=' + swj + ', QE=' + (qe * 100).toFixed(0) + '%]';
  Adom.summaryBody.textContent  = body + statsDetail;
}

// ── Retest ────────────────────────────────────────────────────────────────

function retest() {
  AT.gazeData       = [];
  AT.swjCount       = 0;
  AT.pendingSaccade = null;
  AT.prevGaze       = null;
  if (AT.hudTimer)  clearInterval(AT.hudTimer);
  if (AT.taskTimer) clearTimeout(AT.taskTimer);

  if (typeof webgazer !== 'undefined' && typeof webgazer.resume === 'function') {
    webgazer.resume();
  }
  CalApp.startFaceMonitoring();
  startAccuracyTest();
}

// ── Initialization ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  initDom();

  Adom.startBtn.addEventListener('click', async function () {
    showLoading();
    try {
      await initWebGazer();
      hideLoading();
      // Capture face reference and immediately start face monitoring so that
      // range-check, offset-correction, and the recheck overlay all work.
      CalApp.captureFaceReference(function (ref) {
        CalApp.state.faceReference = ref;
        CalApp.startFaceMonitoring();
        // face-pos toggle starts false — keep overlays hidden until the user enables them
        if (CalApp.dom.faceInfoBadge)   CalApp.dom.faceInfoBadge.style.display   = 'none';
        if (CalApp.dom.faceBoundaryBox) CalApp.dom.faceBoundaryBox.style.display = 'none';
      });
      startAccuracyTest();
    } catch (err) {
      var t = 'Initialization Failed';
      var m = (err && err.message) ? err.message : 'An unknown error occurred.';
      if ((err && err.name === 'NotAllowedError') || m.indexOf('denied') !== -1) {
        t = 'Camera Access Denied';
        m = 'Camera access is required. Please allow it in your browser settings.';
      } else if ((err && err.name === 'NotFoundError')) {
        t = 'No Camera Found';
        m = 'No webcam was detected. Connect a camera and reload the page.';
      }
      showError(t, m);
    }
  });

  Adom.retestBtn.addEventListener('click', retest);

  Adom.errorBtn.addEventListener('click', function () {
    Adom.errorOvl.classList.remove('active');
    var action = ADHD_retryAction;
    ADHD_retryAction = null;
    if (action === 'accuracy') {
      startAccuracyTest();
    } else {
      showScreen('intro');
    }
  });

  // Recalibration button inside error overlay — navigate to calibration page
  var recalibrateBtn = document.getElementById('force-recalibrate-btn');
  if (recalibrateBtn) {
    recalibrateBtn.addEventListener('click', function () {
      window.location.href = 'calibration.html';
    });
  }

  // Recheck overlay buttons (mirrors calibration.html)
  if (CalApp.dom.recheckBtn) {
    CalApp.dom.recheckBtn.addEventListener('click', CalApp.performAccuracyRecheck);
  }
  var modalFullrecalBtn = document.getElementById('modal-fullrecal-btn');
  if (modalFullrecalBtn) {
    modalFullrecalBtn.addEventListener('click', function () {
      window.location.href = 'calibration.html';
    });
  }

  window.addEventListener('resize', function () {
    if (Adom.scatterCanvas) {
      Adom.scatterCanvas.width  = window.innerWidth;
      Adom.scatterCanvas.height = window.innerHeight;
      AT.scatterCtx = Adom.scatterCanvas.getContext('2d');
    }
    AT.targetX = window.innerWidth  / 2;
    AT.targetY = window.innerHeight / 2;
  });

  window.addEventListener('beforeunload', function () {
    if (typeof webgazer !== 'undefined' && typeof webgazer.end === 'function') {
      webgazer.end();
    }
  });

  // ── Debug settings panel (via reusable component) ────────────
  SettingsPanel.init({
    alwaysVisible: true,
    panelLabel: 'Settings',
    sections: [
      { type: 'buttons', items: [
        { id: 'recalibrate', label: '⟳ Recalibrate', onClick: function () { window.location.href = 'calibration.html'; } },
        { id: 'dashboard',   label: '← Dashboard',   onClick: function () { window.location.href = 'dashboard.html'; } },
      ]},
      { type: 'divider' },
      { type: 'toggle', id: 'gaze-dot', label: 'Gaze dot', initial: false,
        onChange: function (on) {
          AT.debugSettings.gazeDot = on;
          if (Adom.gazeDot) Adom.gazeDot.classList.toggle('visible', on);
        }
      },
      { type: 'toggle', id: 'camera', label: 'Camera preview', initial: false,
        onChange: function (on) {
          AT.debugSettings.camera = on;
          var el = document.getElementById('webgazerVideoContainer');
          if (el) el.style.display = on ? '' : 'none';
          if (typeof webgazer.showFaceOverlay === 'function') webgazer.showFaceOverlay(on);
        }
      },
      { type: 'toggle', id: 'face-pos', label: 'Face positioning', initial: false,
        onChange: function (on) {
          AT.debugSettings.facePositioning = on;
          var badge = CalApp.dom.faceInfoBadge;
          var box   = CalApp.dom.faceBoundaryBox;
          if (badge) badge.style.display = on ? '' : 'none';
          if (box)   box.style.display   = on ? '' : 'none';
        }
      },
    ],
  });
});
