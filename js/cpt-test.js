/* ============================================================
   cpt-test.js — Continuous Performance Task (Go/No-Go)
   Biomarkers: Commission Errors, Omission Errors,
               Response Time Variability (RTV), Gaze Wander,
               Attentional Decay (first vs. second half)
   ============================================================ */
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

var CPT_CONST = {
  TASK_MS:       300000,   // 5 minutes 300000
  STIM_MS:       250,      // letter visible duration
  INTERVAL_MS:   1000,     // blank gap between trials
  TRIAL_MS:      1250,     // STIM_MS + INTERVAL_MS

  NOGO_LETTER:   'X',
  NOGO_RATIO:    0.20,     // 20% of trials are No-Go (X)

  FOCUS_RADIUS_PX: 200,    // gaze must stay within this radius of screen center

  COUNTDOWN_SECS: 3,

  // Warm-up phase — first N trials show letters longer so tester can read them
  WARMUP_TRIALS:   8,
  WARMUP_STIM_MS:  800,   // letter visible duration during warmup
  WARMUP_TRIAL_MS: 1800,  // WARMUP_STIM_MS + INTERVAL_MS

  // Thresholds for biomarker classification
  // Commission error rate (%)
  TD_COMMISSION:    5,
  ADHD_COMMISSION:  15,

  // Omission error rate (%)
  TD_OMISSION:      2,
  ADHD_OMISSION:    10,

  // Response time variability — SD of correct Go RT (ms)
  TD_RTV:           80,
  ADHD_RTV:         160,

  // Gaze wander — % of task time off-target
  TD_GAZE_WANDER:   10,
  ADHD_GAZE_WANDER: 30,

  // Attentional decay — difference in omission rate between halves (%)
  TD_DECAY_DELTA:   3,
  ADHD_DECAY_DELTA: 10,
};

// ── State ─────────────────────────────────────────────────────────────────

var CPT = {
  trials:           [],  // completed trial records
  trialIndex:       0,
  taskStartTime:    0,  // performance.now() at task start
  halfReported:     false,

  // Current trial state
  currentLetter:    '',
  isNoGo:           false,
  stimOnsetTime:    0,
  pressedThisTrial: false,
  pressRT:          null,
  trialTimer:       null,
  stimTimer:        null,

  // Gaze tracking
  gazeOffTaskMs:    0,
  gazeOffTaskStart: null,  // timestamp when gaze went off-task
  isGazeOffTask:    false,

  // Per-half gaze off-task accumulation
  halfGazeOffMs:    [0, 0],
  halfGazeStart:    [null, null],
  halfGazeOff:      [false, false],

  taskRunning:      false,
  halfIndex:        0,  // 0 = first half, 1 = second half
  halfSwitchTime:   0,

  // Pause / resume (for recalibration)
  paused:           false,
  pauseStartTime:   0,      // performance.now() when paused
  totalPausedMs:    0,      // accumulated paused time

  // Pre-build trial sequence
  trialSequence:    [],

  // Debug
  debug: {
    gazeDot:         false,
    camera:          false,
    rangeCheck:      false,
    facePositioning: false,
  },
};

// Active gaze listener ref (for recheck restoration)
var CPT_activeGazeListener = null;

// ── DOM ────────────────────────────────────────────────────────────────────

var CPTdom = {};

function $cpt(id) { return document.getElementById(id); }

function cptInitDom() {
  CPTdom.introScreen   = $cpt('cpt-intro-screen');
  CPTdom.taskScreen    = $cpt('cpt-task-screen');
  CPTdom.resultsScreen = $cpt('cpt-results-screen');
  CPTdom.loadingOvl    = $cpt('cpt-loading-overlay');
  CPTdom.errorOvl      = $cpt('cpt-error-overlay');
  CPTdom.errorTitle    = $cpt('cpt-error-title');
  CPTdom.errorMsg      = $cpt('cpt-error-message');
  CPTdom.errorBtn      = $cpt('cpt-error-btn');
  CPTdom.startBtn      = $cpt('cpt-start-btn');
  CPTdom.retestBtn     = $cpt('cpt-retest-btn');

  // Task elements
  CPTdom.countdown     = $cpt('cpt-countdown');
  CPTdom.countdownNum  = $cpt('cpt-countdown-num');
  CPTdom.countdownArc  = $cpt('cpt-countdown-arc');
  CPTdom.letter        = $cpt('cpt-letter');
  CPTdom.pressRipple   = $cpt('cpt-press-ripple');
  CPTdom.feedback      = $cpt('cpt-feedback');
  CPTdom.gazeVignette  = $cpt('cpt-gaze-vignette');
  CPTdom.milestoneBanner = $cpt('cpt-milestone-banner');

  // Live HUD
  CPTdom.liveHud       = $cpt('cpt-live-hud');
  CPTdom.hudTimerSvg   = $cpt('cpt-hud-timer-arc');
  CPTdom.hudTimerText  = $cpt('cpt-hud-timer-text');
  CPTdom.hudTrials     = $cpt('cpt-hud-trials');
  CPTdom.hudCommission = $cpt('cpt-hud-commission');
  CPTdom.hudOmission   = $cpt('cpt-hud-omission');
  CPTdom.hudRtv        = $cpt('cpt-hud-rtv');

  // Results
  CPTdom.gaugePct      = $cpt('cpt-gauge-pct');
  CPTdom.gaugeLabel    = $cpt('cpt-gauge-label');
  CPTdom.gaugeArc      = $cpt('cpt-gauge-arc');
  CPTdom.gaugeNeedle   = $cpt('cpt-gauge-needle');

  CPTdom.rcComBadge    = $cpt('cpt-rc-com-badge');
  CPTdom.rcComVal      = $cpt('cpt-rc-com-val');
  CPTdom.rcComBar      = $cpt('cpt-rc-com-bar');
  CPTdom.rcComDesc     = $cpt('cpt-rc-com-desc');

  CPTdom.rcOmiBadge    = $cpt('cpt-rc-omi-badge');
  CPTdom.rcOmiVal      = $cpt('cpt-rc-omi-val');
  CPTdom.rcOmiBar      = $cpt('cpt-rc-omi-bar');
  CPTdom.rcOmiDesc     = $cpt('cpt-rc-omi-desc');

  CPTdom.rcRtvBadge    = $cpt('cpt-rc-rtv-badge');
  CPTdom.rcRtvVal      = $cpt('cpt-rc-rtv-val');
  CPTdom.rcRtvBar      = $cpt('cpt-rc-rtv-bar');
  CPTdom.rcRtvDesc     = $cpt('cpt-rc-rtv-desc');

  CPTdom.rcGwBadge     = $cpt('cpt-rc-gw-badge');
  CPTdom.rcGwVal       = $cpt('cpt-rc-gw-val');
  CPTdom.rcGwBar       = $cpt('cpt-rc-gw-bar');
  CPTdom.rcGwDesc      = $cpt('cpt-rc-gw-desc');

  CPTdom.half1Trials   = $cpt('cpt-h1-trials');
  CPTdom.half1OmiRate  = $cpt('cpt-h1-omi-rate');
  CPTdom.half1AvgRt    = $cpt('cpt-h1-avg-rt');
  CPTdom.half1Gaze     = $cpt('cpt-h1-gaze');

  CPTdom.half2Trials   = $cpt('cpt-h2-trials');
  CPTdom.half2OmiRate  = $cpt('cpt-h2-omi-rate');
  CPTdom.half2AvgRt    = $cpt('cpt-h2-avg-rt');
  CPTdom.half2Gaze     = $cpt('cpt-h2-gaze');

  CPTdom.tableBody     = $cpt('cpt-table-body');
  CPTdom.summaryIcon   = $cpt('cpt-summary-icon');
  CPTdom.summaryTitle  = $cpt('cpt-summary-title');
  CPTdom.summaryBody   = $cpt('cpt-summary-body');
  CPTdom.gazeDot       = $cpt('gaze-dot');

  // Wire CalApp DOM for face-tracking.js
  CalApp.dom.faceBoundaryBox     = $cpt('face-boundary-box');
  CalApp.dom.faceInfoBadge       = $cpt('face-info-badge');
  CalApp.dom.fiOffset            = $cpt('fi-offset');
  CalApp.dom.fiDepth             = $cpt('fi-depth');
  CalApp.dom.fiStatus            = $cpt('fi-status');
  CalApp.dom.positionWarning     = $cpt('position-warning');
  CalApp.dom.positionWarningText = $cpt('position-warning-text');
  CalApp.dom.gazeDot             = $cpt('gaze-dot');

  CalApp.dom.recalibrateOvl      = $cpt('recalibrate-overlay');
  CalApp.dom.recalibrateTitle    = $cpt('recalibrate-title');
  CalApp.dom.recalibrateMsg      = $cpt('recalibrate-message');
  CalApp.dom.recalibrateAccuracy = $cpt('recalibrate-accuracy');
  CalApp.dom.recheckBtn          = $cpt('recheck-btn');
  CalApp.dom.statAcc             = { textContent: '' };

  // Pause the task when face-tracking triggers recalibration
  var _originalTrigger = CalApp.triggerAccuracyRecheck;
  CalApp.triggerAccuracyRecheck = function () {
    cptPauseTask();
    _originalTrigger.call(CalApp);
  };

  // After recheck, restore task gaze listener AND resume
  CalApp.startGazeDemo = function () {
    if (typeof CPT_activeGazeListener === 'function') {
      webgazer.setGazeListener(CPT_activeGazeListener);
    }
    CalApp.startFaceMonitoring();
    cptResumeTask();
  };

  // After recheck, apply tol80 (80th-percentile gaze distance) as the
  // off-task focus radius, then run the default evaluateRecheck logic.
  var _originalEvalCPT = CalApp.evaluateRecheck;
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
      if (tol80 > 0) CPT_CONST.FOCUS_RADIUS_PX = Math.max(50, Math.min(500, tol80));
    }
    _originalEvalCPT.call(CalApp);
  };
}

// ── Screen helpers ─────────────────────────────────────────────────────────

function cptShowScreen(name) {
  var map = {
    intro:   CPTdom.introScreen,
    task:    CPTdom.taskScreen,
    results: CPTdom.resultsScreen,
  };
  Object.values(map).forEach(function (s) { s.classList.remove('active'); });
  map[name].classList.add('active');
}

function cptShowLoading() { CPTdom.loadingOvl.classList.add('active'); }
function cptHideLoading() { CPTdom.loadingOvl.classList.remove('active'); }

// 'accuracy' → retry accuracy check; 'init' → back to intro
var CPT_retryAction = null;

function cptShowError(title, msg, retryAction) {
  cptHideLoading();
  CPT_retryAction = retryAction || 'intro';
  CPTdom.errorTitle.textContent = title;
  CPTdom.errorMsg.textContent   = msg;
  CPTdom.errorOvl.classList.add('active');
}

// ── WebGazer bootstrap ─────────────────────────────────────────────────────

async function cptInitWebGazer() {
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
  if (typeof webgazer.showVideoPreview       === 'function') webgazer.showVideoPreview(true);
  if (typeof webgazer.showFaceOverlay        === 'function') webgazer.showFaceOverlay(false);
  if (typeof webgazer.showFaceFeedbackBox    === 'function') webgazer.showFaceFeedbackBox(false);

  await webgazer.begin();

  ['webgazerVideoContainer', 'webgazerFaceOverlay', 'webgazerFaceFeedbackBox'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  if (typeof webgazer.removeMouseEventListeners === 'function') {
    webgazer.removeMouseEventListeners();
  }
}

// ── Stats helpers ──────────────────────────────────────────────────────────

function cptMean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
}

function cptVariance(arr) {
  if (arr.length < 2) return 0;
  var m = cptMean(arr);
  return arr.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (arr.length - 1);
}

function cptStdDev(arr) { return Math.sqrt(cptVariance(arr)); }

function cptSigmoidScore(value, low, high) {
  if (high <= low) return value >= high ? 1 : 0;
  var norm    = (value - low) / (high - low);
  var clamped = Math.max(0, Math.min(1, norm));
  return clamped * clamped * (3 - 2 * clamped);  // smooth-step
}

// ── Pause / Resume (during recalibration) ─────────────────────────────

function cptPauseTask() {
  if (!CPT.taskRunning || CPT.paused) return;
  CPT.paused = true;
  CPT.pauseStartTime = performance.now();

  // Stop current trial timers so no new trial fires while paused
  clearTimeout(CPT.stimTimer);
  clearTimeout(CPT.trialTimer);

  // Hide the letter if it's still showing
  CPTdom.letter.classList.remove('visible');
  CPTdom.feedback.className = 'cpt-feedback';

  // Remove spacebar listener so accidental presses during recheck don't count
  document.removeEventListener('keydown', cptOnSpacebar);

  // Flush open gaze off-task windows
  cptFlushGaze();

  // Show a visual cue that the task is paused
  CPTdom.milestoneBanner.textContent = '⏸ Paused — Recalibrating…';
  CPTdom.milestoneBanner.classList.add('visible');
}

function cptResumeTask() {
  if (!CPT.taskRunning || !CPT.paused) return;
  var pauseDuration = performance.now() - CPT.pauseStartTime;
  CPT.totalPausedMs += pauseDuration;
  CPT.paused = false;

  // Shift all time anchors forward so the timer and half-switch are unaffected
  CPT.taskStartTime  += pauseDuration;
  CPT.halfSwitchTime += pauseDuration;

  // Re-install spacebar listener
  document.addEventListener('keydown', cptOnSpacebar);

  // Dismiss pause banner
  CPTdom.milestoneBanner.classList.remove('visible');

  // Resume trial loop — re-run the same trial index (it was interrupted)
  cptRunTrial();
}

// ── Trial sequence pre-generation ─────────────────────────────────────────

function cptGenerateSequence() {
  var totalMs  = CPT_CONST.TASK_MS;
  var trialMs  = CPT_CONST.TRIAL_MS;
  var N        = Math.floor(totalMs / trialMs);  // ~240
  var noGoN    = Math.round(N * CPT_CONST.NOGO_RATIO);
  var goN      = N - noGoN;

  var LETTERS  = 'ABCDEFGHIJKLMNOPQRSTUVWYZ';  // all except X = 24 letters

  var seq = [];

  // Build N trials: goN Go and noGoN No-Go, then shuffle
  for (var i = 0; i < goN; i++) {
    seq.push({ letter: LETTERS[Math.floor(Math.random() * LETTERS.length)], isNoGo: false });
  }
  for (var j = 0; j < noGoN; j++) {
    seq.push({ letter: CPT_CONST.NOGO_LETTER, isNoGo: true });
  }

  // Fisher-Yates shuffle
  for (var k = seq.length - 1; k > 0; k--) {
    var r = Math.floor(Math.random() * (k + 1));
    var tmp = seq[k]; seq[k] = seq[r]; seq[r] = tmp;
  }

  CPT.trialSequence = seq;
}

// ── Accuracy check phase ───────────────────────────────────────────────────

function cptStartAccuracyTest() {
  cptShowScreen('task');
  CPTdom.countdown.style.display    = 'none';
  CPTdom.letter.classList.remove('visible');
  CPTdom.liveHud.style.display      = 'none';

  var card = document.createElement('div');
  card.className = 'acc-warning-card';
  card.innerHTML =
    '<div class="acc-warning-icon">🎯</div>' +
    '<h3>Accuracy Check</h3>' +
    '<p>A gold dot will appear at the centre of the screen.<br>' +
    'Stare <strong>directly at it</strong> for 3 seconds.</p>';
  CPTdom.taskScreen.appendChild(card);
  requestAnimationFrame(function () { card.classList.add('visible'); });

  setTimeout(function () {
    card.style.opacity = '0';
    setTimeout(function () { card.remove(); cptStartAccuracyDot(); }, 400);
  }, 2500);
}

function cptStartAccuracyDot() {
  var dot = document.createElement('div');
  dot.className = 'acc-dot';
  CPTdom.taskScreen.appendChild(dot);
  requestAnimationFrame(function () { dot.classList.add('visible'); });

  var banner = document.createElement('div');
  banner.className = 'acc-instr-banner';
  CPTdom.taskScreen.appendChild(banner);

  var samples = [];
  CPT_activeGazeListener = function (data) {
    if (!data) return;
    samples.push({ x: data.x, y: data.y });
    if (CPT.debug.gazeDot && CPTdom.gazeDot) {
      CPTdom.gazeDot.style.left = data.x + 'px';
      CPTdom.gazeDot.style.top  = data.y + 'px';
    }
  };
  webgazer.setGazeListener(CPT_activeGazeListener);

  var remaining = 3;
  (function tick() {
    banner.textContent = 'Look at the gold dot — measuring accuracy… ' + remaining + 's';
    remaining--;
    if (remaining < 0) {
      dot.classList.remove('visible');
      setTimeout(function () {
        dot.remove(); banner.remove();
        if (typeof webgazer.clearGazeListener === 'function') {
          webgazer.clearGazeListener();
        } else { webgazer.setGazeListener(null); }

        var cx = window.innerWidth  / 2;
        var cy = window.innerHeight / 2;

        if (samples.length > 10) {
          samples = samples.slice(Math.floor(samples.length * 0.4));
        }

        var accuracy = 0;
        if (samples.length > 0) {
          var avgErr = samples.reduce(function (sum, pt) {
            var dx = pt.x - cx, dy = pt.y - cy;
            return sum + Math.sqrt(dx * dx + dy * dy);
          }, 0) / samples.length;
          var maxDist = Math.sqrt(
            window.innerWidth  * window.innerWidth +
            window.innerHeight * window.innerHeight
          );
          accuracy = Math.max(0, Math.min(100, 100 - (avgErr / maxDist) * 190));
        }

        if (accuracy >= 80) {
          cptStartTask();
        } else {
          cptShowError(
            'Accuracy Below Threshold',
            'Gaze accuracy is ' + accuracy.toFixed(1) + '%, below the required 80%. ' +
            'Please look at the centre dot again and retry.',
            'accuracy'
          );
        }
      }, 350);
      return;
    }
    setTimeout(tick, 1000);
  })();
}

// ── Countdown before task ──────────────────────────────────────────────────

function cptRunCountdown(cb) {
  CPTdom.countdown.style.display = 'flex';
  CPTdom.liveHud.style.display   = 'none';

  var n = CPT_CONST.COUNTDOWN_SECS;
  var arc = CPTdom.countdownArc;
  var FULL = 276.46;

  (function tick() {
    CPTdom.countdownNum.textContent = n;
    arc.style.strokeDashoffset = (FULL * (1 - n / CPT_CONST.COUNTDOWN_SECS)).toFixed(2);
    if (n <= 0) {
      CPTdom.countdown.style.display = 'none';
      cb();
      return;
    }
    n--;
    setTimeout(tick, 1000);
  })();
}

// ── Spacebar listener ─────────────────────────────────────────────────────

function cptOnSpacebar(e) {
  if (e.code !== 'Space' && e.keyCode !== 32) return;
  e.preventDefault();

  if (!CPT.taskRunning) return;
  if (CPT.pressedThisTrial) return;  // no double-count

  CPT.pressedThisTrial = true;
  CPT.pressRT = performance.now() - CPT.stimOnsetTime;

  if (CPT.isNoGo) {
    // Commission error — pressed on X
    cptShowFeedback('commission');
  } else if (CPTdom.letter && CPTdom.letter.classList.contains('visible')) {
    // Correct Go response — letter still visible
    cptShowFeedback('correct');
  } else {
    // Pressed during blank gap after a Go letter (still credited as Go response,
    // but RT is measured from stimulus onset so it will be longer)
    cptShowFeedback('correct');
  }

  // Ripple animation
  var rip = CPTdom.pressRipple;
  rip.classList.remove('fire', 'fire-error');
  void rip.offsetWidth;  // reflow
  rip.classList.add(CPT.isNoGo ? 'fire-error' : 'fire');
}

// ── Gaze listener during task ─────────────────────────────────────────────

function cptInstallTaskGazeListener() {
  CPT_activeGazeListener = function (data) {
    if (!data) return;

    if (CPT.debug.gazeDot && CPTdom.gazeDot) {
      CPTdom.gazeDot.style.left = data.x + 'px';
      CPTdom.gazeDot.style.top  = data.y + 'px';
    }

    var cx = window.innerWidth  / 2;
    var cy = window.innerHeight / 2;
    var dx = data.x - cx;
    var dy = data.y - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var offTask = dist > CPT_CONST.FOCUS_RADIUS_PX;
    var now = performance.now();

    // Update vignette overlay
    CPTdom.gazeVignette.classList.toggle('active', offTask);

    // Accumulate global off-task ms
    if (offTask && !CPT.isGazeOffTask) {
      CPT.isGazeOffTask    = true;
      CPT.gazeOffTaskStart = now;
    } else if (!offTask && CPT.isGazeOffTask) {
      CPT.isGazeOffTask = false;
      CPT.gazeOffTaskMs += now - CPT.gazeOffTaskStart;
      CPT.gazeOffTaskStart = null;
    }

    // Per-half accumulation
    var h = CPT.halfIndex;
    if (offTask && !CPT.halfGazeOff[h]) {
      CPT.halfGazeOff[h]  = true;
      CPT.halfGazeStart[h] = now;
    } else if (!offTask && CPT.halfGazeOff[h]) {
      CPT.halfGazeOff[h]  = false;
      CPT.halfGazeOffMs[h] += now - CPT.halfGazeStart[h];
      CPT.halfGazeStart[h]  = null;
    }
  };

  webgazer.setGazeListener(CPT_activeGazeListener);
}

function cptFlushGaze() {
  // Close any open off-task window
  if (CPT.isGazeOffTask && CPT.gazeOffTaskStart !== null) {
    CPT.gazeOffTaskMs += performance.now() - CPT.gazeOffTaskStart;
    CPT.gazeOffTaskStart = null;
    CPT.isGazeOffTask    = false;
  }
  var h = CPT.halfIndex;
  if (CPT.halfGazeOff[h] && CPT.halfGazeStart[h] !== null) {
    CPT.halfGazeOffMs[h] += performance.now() - CPT.halfGazeStart[h];
    CPT.halfGazeStart[h]  = null;
    CPT.halfGazeOff[h]    = false;
  }
}

// ── Task execution ─────────────────────────────────────────────────────────

function cptStartTask() {
  // Reset state
  CPT.trials           = [];
  CPT.trialIndex       = 0;
  CPT.halfReported     = false;
  CPT.gazeOffTaskMs    = 0;
  CPT.gazeOffTaskStart = null;
  CPT.isGazeOffTask    = false;
  CPT.halfGazeOffMs    = [0, 0];
  CPT.halfGazeStart    = [null, null];
  CPT.halfGazeOff      = [false, false];
  CPT.halfIndex        = 0;
  CPT.taskRunning      = false;
  CPT.paused           = false;
  CPT.pauseStartTime   = 0;
  CPT.totalPausedMs    = 0;

  cptGenerateSequence();

  cptShowScreen('task');
  cptRunCountdown(function () {
    CPT.taskRunning   = true;
    CPT.taskStartTime = performance.now();
    CPT.halfSwitchTime = CPT.taskStartTime + CPT_CONST.TASK_MS / 2;

    CPTdom.liveHud.style.display = 'flex';
    cptInstallTaskGazeListener();
    document.addEventListener('keydown', cptOnSpacebar);

    cptUpdateHud();
    cptRunTrial();
  });
}

function cptRunTrial() {
  if (!CPT.taskRunning || CPT.paused) return;

  var elapsed = performance.now() - CPT.taskStartTime;

  // Check if half has switched
  if (CPT.halfIndex === 0 && performance.now() >= CPT.halfSwitchTime) {
    CPT.halfIndex = 1;
    // Flush current half gaze accumulator properly
    cptFlushGaze();
    CPT.halfGazeOff[0]  = false;
    CPT.halfGazeStart[0] = null;
    // Show milestone banner
    CPTdom.milestoneBanner.textContent = '⏱ Halfway — keep going!';
    CPTdom.milestoneBanner.classList.add('visible');
    setTimeout(function () { CPTdom.milestoneBanner.classList.remove('visible'); }, 2500);
  }

  // Stop after TASK_MS
  if (elapsed >= CPT_CONST.TASK_MS || CPT.trialIndex >= CPT.trialSequence.length) {
    cptFinishTask();
    return;
  }

  var trial = CPT.trialSequence[CPT.trialIndex];
  CPT.currentLetter    = trial.letter;
  CPT.isNoGo           = trial.isNoGo;
  CPT.pressedThisTrial = false;
  CPT.pressRT          = null;
  CPT.stimOnsetTime    = performance.now();

  // Warm-up phase: first N trials use longer display time
  var isWarmup  = CPT.trialIndex < CPT_CONST.WARMUP_TRIALS;
  var stimMs    = isWarmup ? CPT_CONST.WARMUP_STIM_MS  : CPT_CONST.STIM_MS;
  var trialMs   = isWarmup ? CPT_CONST.WARMUP_TRIAL_MS : CPT_CONST.TRIAL_MS;

  // Transition banner: warmup → task
  if (CPT.trialIndex === 0) {
    CPTdom.milestoneBanner.textContent = '🟢 Warm-up — letters shown slowly';
    CPTdom.milestoneBanner.classList.add('visible');
    setTimeout(function () { CPTdom.milestoneBanner.classList.remove('visible'); }, 2000);
  } else if (CPT.trialIndex === CPT_CONST.WARMUP_TRIALS) {
    CPTdom.milestoneBanner.textContent = '⚡ Full speed — task running';
    CPTdom.milestoneBanner.classList.add('visible');
    setTimeout(function () { CPTdom.milestoneBanner.classList.remove('visible'); }, 2000);
  }

  // Show letter
  CPTdom.letter.textContent = trial.letter;
  CPTdom.letter.className   = 'cpt-letter visible' + (trial.isNoGo ? ' is-x' : '');

  // Hide after stimMs
  CPT.stimTimer = setTimeout(function () {
    CPTdom.letter.classList.remove('visible');
    CPTdom.feedback.className = 'cpt-feedback';
  }, stimMs);

  // End trial after trialMs
  CPT.trialTimer = setTimeout(function () { cptEndTrial(); }, trialMs);
}

function cptEndTrial() {
  if (!CPT.taskRunning) return;

  // Classify
  var pressed   = CPT.pressedThisTrial;
  var isNoGo    = CPT.isNoGo;
  var rt        = CPT.pressRT;

  var isCommission = isNoGo && pressed;          // pressed on X  → commission error
  var isOmission   = !isNoGo && !pressed;        // no press on non-X → omission error
  var isCorrectGo  = !isNoGo && pressed;
  var isWarmupTrial = CPT.trialIndex < CPT_CONST.WARMUP_TRIALS;

  CPT.trials.push({
    index:       CPT.trialIndex,
    letter:      CPT.currentLetter,
    isNoGo:      isNoGo,
    pressed:     pressed,
    rt:          rt,
    commission:  isCommission,
    omission:    isOmission,
    correctGo:   isCorrectGo,
    half:        CPT.halfIndex,
    warmup:      isWarmupTrial,
  });

  CPT.trialIndex++;
  cptUpdateHud();

  cptRunTrial();
}

function cptShowFeedback(type) {
  var el = CPTdom.feedback;
  clearTimeout(el._ft);
  el.className = 'cpt-feedback';
  void el.offsetWidth;

  if (type === 'correct') {
    el.textContent = '✓ Go';
    el.className   = 'cpt-feedback fb-correct';
  } else if (type === 'commission') {
    el.textContent = '✗ Commission Error';
    el.className   = 'cpt-feedback fb-commission';
  } else {
    el.textContent = '✕ Missed';
    el.className   = 'cpt-feedback fb-miss';
  }

  el._ft = setTimeout(function () {
    el.className = 'cpt-feedback';
  }, 500);
}

// ── Live HUD ──────────────────────────────────────────────────────────────

var cptHudTimer = null;

function cptUpdateHud() {
  var completed = CPT.trials.length;
  CPTdom.hudTrials.textContent = completed;

  // Running commission rate
  var noGoTrials = CPT.trials.filter(function (t) { return t.isNoGo; });
  if (noGoTrials.length > 0) {
    var comRate = (noGoTrials.filter(function (t) { return t.commission; }).length / noGoTrials.length) * 100;
    CPTdom.hudCommission.textContent = comRate.toFixed(0) + '%';
    CPTdom.hudCommission.className = 'cpt-hud-metric-val ' + cptRateClass(comRate, CPT_CONST.TD_COMMISSION, CPT_CONST.ADHD_COMMISSION);
  } else {
    CPTdom.hudCommission.textContent = '—';
    CPTdom.hudCommission.className   = 'cpt-hud-metric-val';
  }

  // Running omission rate
  var goTrials = CPT.trials.filter(function (t) { return !t.isNoGo; });
  if (goTrials.length > 0) {
    var omiRate = (goTrials.filter(function (t) { return t.omission; }).length / goTrials.length) * 100;
    CPTdom.hudOmission.textContent = omiRate.toFixed(0) + '%';
    CPTdom.hudOmission.className = 'cpt-hud-metric-val ' + cptRateClass(omiRate, CPT_CONST.TD_OMISSION, CPT_CONST.ADHD_OMISSION);
  } else {
    CPTdom.hudOmission.textContent = '—';
    CPTdom.hudOmission.className   = 'cpt-hud-metric-val';
  }

  // Running RTV (SD of correct Go RTs)
  var goRts = CPT.trials
    .filter(function (t) { return t.correctGo && t.rt !== null; })
    .map(function (t) { return t.rt; });
  if (goRts.length >= 3) {
    var rtv = cptStdDev(goRts);
    CPTdom.hudRtv.textContent = Math.round(rtv) + 'ms';
    CPTdom.hudRtv.className = 'cpt-hud-metric-val ' + cptRateClass(rtv, CPT_CONST.TD_RTV, CPT_CONST.ADHD_RTV);
  } else {
    CPTdom.hudRtv.textContent = '—';
    CPTdom.hudRtv.className   = 'cpt-hud-metric-val';
  }
}

function cptRateClass(val, tdThresh, adhdThresh) {
  return val <= tdThresh ? 'val-good' : val <= adhdThresh ? 'val-warn' : 'val-bad';
}

function cptStartHudTimer() {
  var ARC_LEN = 138;  // circumference at r=22
  cptHudTimer = setInterval(function () {
    if (!CPT.taskRunning || CPT.paused) return;
    var elapsed  = performance.now() - CPT.taskStartTime;
    var fraction = Math.min(1, elapsed / CPT_CONST.TASK_MS);
    var remaining = Math.max(0, CPT_CONST.TASK_MS - elapsed);
    var m = Math.floor(remaining / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    CPTdom.hudTimerText.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    if (CPTdom.hudTimerSvg) {
      CPTdom.hudTimerSvg.style.strokeDashoffset = (ARC_LEN * (1 - fraction)).toFixed(2);
    }
  }, 500);
}

// ── Finish task ────────────────────────────────────────────────────────────

function cptFinishTask() {
  CPT.taskRunning = false;
  clearInterval(cptHudTimer);
  document.removeEventListener('keydown', cptOnSpacebar);
  clearTimeout(CPT.stimTimer);
  clearTimeout(CPT.trialTimer);

  cptFlushGaze();

  try {
    if (typeof webgazer.clearGazeListener === 'function') {
      webgazer.clearGazeListener();
    } else {
      webgazer.setGazeListener(null);
    }
  } catch (_) {}
  CPT_activeGazeListener = null;

  CPTdom.letter.classList.remove('visible');
  CPTdom.liveHud.style.display = 'none';
  CPTdom.gazeVignette.classList.remove('active');
  CPTdom.feedback.className = 'cpt-feedback';

  CalApp.stopFaceMonitoring();

  cptComputeAndShow();
}

// ── Compute & present results ─────────────────────────────────────────────

function cptComputeAndShow() {
  var trials = CPT.trials;
  var total  = trials.length;

  if (total === 0) {
    cptShowError('No Data', 'No trials were recorded. Please try again.');
    return;
  }

  var goTrials   = trials.filter(function (t) { return !t.isNoGo; });
  var noGoTrials = trials.filter(function (t) { return t.isNoGo;  });

  // Commission error rate (false alarms on X)
  var commissions    = noGoTrials.filter(function (t) { return t.commission; });
  var commissionRate = noGoTrials.length > 0
    ? (commissions.length / noGoTrials.length) * 100 : 0;

  // Omission error rate (missed Go)
  var omissions    = goTrials.filter(function (t) { return t.omission; });
  var omissionRate = goTrials.length > 0
    ? (omissions.length / goTrials.length) * 100 : 0;

  // Correct Go RTs — exclude warmup trials to avoid skewing RTV
  var correctGoRts = trials
    .filter(function (t) { return t.correctGo && t.rt !== null && !t.warmup; })
    .map(function (t) { return t.rt; });

  var meanRt  = correctGoRts.length > 0 ? cptMean(correctGoRts) : null;
  var rtv     = correctGoRts.length >= 2 ? cptStdDev(correctGoRts) : null;

  // Gaze wander %
  var taskDuration = CPT_CONST.TASK_MS;
  var gazeWander   = (CPT.gazeOffTaskMs / taskDuration) * 100;

  // Per-half stats
  var h0 = trials.filter(function (t) { return t.half === 0; });
  var h1 = trials.filter(function (t) { return t.half === 1; });

  function halfStats(ht, gazeOffMs, totalMs) {
    var goH   = ht.filter(function (t) { return !t.isNoGo; });
    var omiR  = goH.length > 0 ? (goH.filter(function (t) { return t.omission; }).length / goH.length) * 100 : 0;
    var rts   = ht.filter(function (t) { return t.correctGo && t.rt !== null && !t.warmup; }).map(function (t) { return t.rt; });
    var avgRt = rts.length > 0 ? cptMean(rts) : null;
    var gwPct = totalMs > 0 ? (gazeOffMs / totalMs) * 100 : 0;
    return { trials: ht.length, omiRate: omiR, avgRt: avgRt, gazeWander: gwPct };
  }

  var halfMs = CPT_CONST.TASK_MS / 2;
  var s0 = halfStats(h0, CPT.halfGazeOffMs[0], halfMs);
  var s1 = halfStats(h1, CPT.halfGazeOffMs[1], halfMs);

  // Attentional decay delta: omission rate difference between halves
  var decayDelta = Math.max(0, s1.omiRate - s0.omiRate);

  // ADHD Probability
  var prob = cptComputeAdhdProb(commissionRate, omissionRate, rtv, gazeWander, decayDelta);

  // Save to localStorage history
  try {
    var history = [];
    var raw = localStorage.getItem('neurogaze_test_history');
    if (raw) history = JSON.parse(raw);
    history.push({
      name:           'CPT (Go/No-Go)',
      time:           Date.now(),
      commissionRate: commissionRate,
      omissionRate:   omissionRate,
      rtv:            rtv,
      gazeWander:     gazeWander,
      decayDelta:     decayDelta,
      prob:           prob,
      meanRt:         meanRt,
      s0:             s0,
      s1:             s1,
    });
    localStorage.setItem('neurogaze_test_history', JSON.stringify(history));
  } catch (_) {}

  cptShowScreen('results');
  cptRenderResults({
    total:          total,
    goTrials:       goTrials.length,
    noGoTrials:     noGoTrials.length,
    commissions:    commissions.length,
    commissionRate: commissionRate,
    omissions:      omissions.length,
    omissionRate:   omissionRate,
    correctGoRts:   correctGoRts,
    meanRt:         meanRt,
    rtv:            rtv,
    gazeWander:     gazeWander,
    decayDelta:     decayDelta,
    s0:             s0,
    s1:             s1,
    prob:           prob,
    trials:         trials,
  });
}

// ── ADHD Probability ──────────────────────────────────────────────────────

function cptComputeAdhdProb(commissionRate, omissionRate, rtv, gazeWander, decayDelta) {
  // Commission errors — primary inhibitory marker (25%)
  var comScore = cptSigmoidScore(
    commissionRate, CPT_CONST.TD_COMMISSION, CPT_CONST.ADHD_COMMISSION + 15
  );

  // RTV — intraindividual variability marker (30%)
  var rtvScore = rtv !== null
    ? cptSigmoidScore(rtv, CPT_CONST.TD_RTV, CPT_CONST.ADHD_RTV + 80)
    : 0.25;  // mild default if insufficient data

  // Omission errors — sustained attention (20%)
  var omiScore = cptSigmoidScore(
    omissionRate, CPT_CONST.TD_OMISSION, CPT_CONST.ADHD_OMISSION + 15
  );

  // Gaze wander — off-task attention (15%)
  var gwScore = cptSigmoidScore(
    gazeWander, CPT_CONST.TD_GAZE_WANDER, CPT_CONST.ADHD_GAZE_WANDER + 20
  );

  // Attentional decay (10%)
  var decayScore = cptSigmoidScore(
    decayDelta, CPT_CONST.TD_DECAY_DELTA, CPT_CONST.ADHD_DECAY_DELTA + 10
  );

  var score = comScore * 0.25 + rtvScore * 0.30 + omiScore * 0.20
            + gwScore  * 0.15 + decayScore * 0.10;
  return Math.min(1, Math.max(0, score));
}

// ── Results rendering ─────────────────────────────────────────────────────

function cptRenderResults(r) {
  var probPct = Math.round(r.prob * 100);
  cptAnimateGauge(r.prob, probPct);

  // Commission card
  var comStatus = r.commissionRate < CPT_CONST.TD_COMMISSION   ? 'td'
                : r.commissionRate < CPT_CONST.ADHD_COMMISSION  ? 'borderline' : 'adhd';
  cptSetBadge(CPTdom.rcComBadge, comStatus);
  CPTdom.rcComVal.innerHTML =
    r.commissionRate.toFixed(1) + '%' +
    '<span class="cpt-rc-val-sub"> (' + r.commissions + ' / ' + r.noGoTrials + ' X trials)</span>';
  CPTdom.rcComBar.style.width = Math.min(100, r.commissionRate * 2.5).toFixed(1) + '%';
  CPTdom.rcComBar.className   = 'cpt-rc-bar ' + comStatus;
  CPTdom.rcComDesc.textContent = cptDescribeCommission(r.commissionRate);

  // Omission card
  var omiStatus = r.omissionRate < CPT_CONST.TD_OMISSION   ? 'td'
                : r.omissionRate < CPT_CONST.ADHD_OMISSION  ? 'borderline' : 'adhd';
  cptSetBadge(CPTdom.rcOmiBadge, omiStatus);
  CPTdom.rcOmiVal.innerHTML =
    r.omissionRate.toFixed(1) + '%' +
    '<span class="cpt-rc-val-sub"> (' + r.omissions + ' / ' + r.goTrials + ' Go trials)</span>';
  CPTdom.rcOmiBar.style.width = Math.min(100, r.omissionRate * 4).toFixed(1) + '%';
  CPTdom.rcOmiBar.className   = 'cpt-rc-bar ' + omiStatus;
  CPTdom.rcOmiDesc.textContent = cptDescribeOmission(r.omissionRate);

  // RTV card
  var rtvStatus = r.rtv === null            ? 'borderline'
                : r.rtv < CPT_CONST.TD_RTV   ? 'td'
                : r.rtv < CPT_CONST.ADHD_RTV  ? 'borderline' : 'adhd';
  cptSetBadge(CPTdom.rcRtvBadge, rtvStatus);
  CPTdom.rcRtvVal.innerHTML = r.rtv !== null
    ? Math.round(r.rtv) + ' ms SD' +
      (r.meanRt !== null ? '<span class="cpt-rc-val-sub"> (mean ' + Math.round(r.meanRt) + 'ms)</span>' : '')
    : '—';
  var rtvBarPct = r.rtv !== null ? Math.min(100, (r.rtv / 300) * 100) : 0;
  CPTdom.rcRtvBar.style.width = rtvBarPct.toFixed(1) + '%';
  CPTdom.rcRtvBar.className   = 'cpt-rc-bar ' + rtvStatus;
  CPTdom.rcRtvDesc.textContent = cptDescribeRtv(r.rtv, r.correctGoRts.length);

  // Gaze wander card
  var gwStatus = r.gazeWander < CPT_CONST.TD_GAZE_WANDER   ? 'td'
               : r.gazeWander < CPT_CONST.ADHD_GAZE_WANDER  ? 'borderline' : 'adhd';
  cptSetBadge(CPTdom.rcGwBadge, gwStatus);
  CPTdom.rcGwVal.innerHTML =
    r.gazeWander.toFixed(1) + '%' +
    '<span class="cpt-rc-val-sub"> of task time off-target</span>';
  CPTdom.rcGwBar.style.width = Math.min(100, r.gazeWander * 2).toFixed(1) + '%';
  CPTdom.rcGwBar.className   = 'cpt-rc-bar ' + gwStatus;
  CPTdom.rcGwDesc.textContent = cptDescribeGazeWander(r.gazeWander);

  // Half-split cards
  cptRenderHalves(r.s0, r.s1);

  // Trial table
  cptRenderTable(r.trials);

  // Summary
  cptRenderSummary(probPct, r);
}

function cptRenderHalves(s0, s1) {
  // Half 1
  CPTdom.half1Trials.textContent  = s0.trials;
  CPTdom.half1OmiRate.textContent = s0.omiRate.toFixed(1) + '%';
  CPTdom.half1AvgRt.textContent   = s0.avgRt !== null ? Math.round(s0.avgRt) + 'ms' : '—';
  CPTdom.half1Gaze.textContent    = s0.gazeWander.toFixed(1) + '%';

  // Half 2 — compare and color
  CPTdom.half2Trials.textContent = s1.trials;
  cptHalfCompare(CPTdom.half2OmiRate, s1.omiRate.toFixed(1) + '%',   s1.omiRate,   s0.omiRate,  true);
  cptHalfCompare(CPTdom.half2AvgRt,   s1.avgRt !== null ? Math.round(s1.avgRt) + 'ms' : '—', s1.avgRt, s0.avgRt, true);
  cptHalfCompare(CPTdom.half2Gaze,    s1.gazeWander.toFixed(1) + '%', s1.gazeWander, s0.gazeWander, true);
}

function cptHalfCompare(el, displayText, v2, v1, higherIsBad) {
  el.textContent = displayText;
  if (v1 === null || v2 === null) { el.className = 'cpt-half-val'; return; }
  var diff = v2 - v1;
  var threshold = Math.abs(v1) * 0.1 + 1;  // 10% relative + 1 unit tolerance
  if (Math.abs(diff) < threshold) {
    el.className = 'cpt-half-val';
  } else {
    var worse = higherIsBad ? diff > 0 : diff < 0;
    el.className = 'cpt-half-val ' + (worse ? 'worse' : 'better');
  }
}

function cptAnimateGauge(prob, probPct) {
  var ARC_FULL = 283;
  var color = prob < 0.35 ? '#4cd964'
            : prob < 0.60 ? '#ffcc00'
            : prob < 0.80 ? '#ff9500'
            :               '#ff3b30';

  CPTdom.gaugeArc.style.stroke = color;

  var start    = performance.now();
  var duration = 1200;
  (function frame(ts) {
    var t     = Math.min(1, (ts - start) / duration);
    var eased = 1 - Math.pow(1 - t, 3);
    CPTdom.gaugeArc.style.strokeDashoffset = (ARC_FULL * (1 - eased * prob)).toFixed(2);
    var deg = -90 + 180 * eased * prob;
    CPTdom.gaugeNeedle.setAttribute('transform', 'rotate(' + deg.toFixed(1) + ' 100 100)');
    CPTdom.gaugePct.textContent = Math.round(eased * probPct) + '%';

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      CPTdom.gaugePct.textContent = probPct + '%';
      CPTdom.gaugePct.style.color = color;
    }
  })(start);

  CPTdom.gaugeLabel.textContent =
    prob < 0.35 ? 'Neurotypical Pattern' :
    prob < 0.60 ? 'Mild Sustained Attention Deficits' :
    prob < 0.80 ? 'Elevated ADHD Indicators' :
                  'Strong ADHD Biomarkers';
  CPTdom.gaugeLabel.style.color = color;
}

function cptSetBadge(el, status) {
  el.className = 'cpt-rc-badge badge-' + status;
  el.textContent = status === 'td'         ? 'Neurotypical'
                 : status === 'borderline' ? 'Borderline'
                 :                          'ADHD Marker';
}

function cptDescribeCommission(rate) {
  if (rate < CPT_CONST.TD_COMMISSION)
    return 'Commission error rate is within neurotypical norms. The inhibitory system is successfully suppressing responses to non-target stimuli — a key executive function intact.';
  if (rate < CPT_CONST.ADHD_COMMISSION)
    return 'Moderate false alarm rate. Some difficulty withholding responses on No-Go (X) trials. This may reflect borderline response inhibition or impulsivity.';
  return 'Elevated commission error rate (' + rate.toFixed(1) + '%). Frequent false alarms on No-Go trials are a hallmark marker of impulsivity and response inhibition deficits in ADHD.';
}

function cptDescribeOmission(rate) {
  if (rate < CPT_CONST.TD_OMISSION)
    return 'Very few missed Go trials. Sustained attention appears intact — consistent responses to target stimuli across the full 5-minute task.';
  if (rate < CPT_CONST.ADHD_OMISSION)
    return 'Moderate omission rate. Some lapses in responding to Go stimuli may indicate periodic attentional failures or fatigue.';
  return 'High omission rate (' + rate.toFixed(1) + '%). Frequent missed responses to non-X letters indicate significant lapses in sustained attention, a core ADHD deficit.';
}

function cptDescribeRtv(rtv, n) {
  if (n < 5 || rtv === null)
    return 'Insufficient correct Go responses to compute reliable response time variability.';
  if (rtv < CPT_CONST.TD_RTV)
    return 'Low response time variability (' + Math.round(rtv) + 'ms SD). Consistent reaction times reflect stable, sustained attentional engagement — a neurotypical pattern.';
  if (rtv < CPT_CONST.ADHD_RTV)
    return 'Moderate RTV (' + Math.round(rtv) + 'ms SD). Some inconsistency in response speed is within the borderline range. This may indicate mild attentional fluctuation.';
  return 'High response time variability (' + Math.round(rtv) + 'ms SD). Intraindividual variability in RTs is one of the most reliable computational markers of ADHD — reflecting moment-to-moment attentional instability.';
}

function cptDescribeGazeWander(pct) {
  if (pct < CPT_CONST.TD_GAZE_WANDER)
    return 'Gaze remained well within the focus zone for most of the task. Sustained visual attention is consistent with neurotypical performance.';
  if (pct < CPT_CONST.ADHD_GAZE_WANDER)
    return 'Moderate off-task gaze (' + pct.toFixed(1) + '% of time). Some visual distraction or mind-wandering occurred but remains in the borderline range.';
  return 'Significant off-task gaze (' + pct.toFixed(1) + '% of time). Frequent gaze diversion from the stimulus area indicates reduced focused attention, consistent with ADHD-associated mind-wandering patterns.';
}

// ── Per-trial table ────────────────────────────────────────────────────────

function cptRenderTable(trials) {
  var tbody = CPTdom.tableBody;
  tbody.innerHTML = '';

  trials.forEach(function (t) {
    var tr = document.createElement('tr');
    if (t.commission) tr.className = 'cpt-table-row-commission';
    if (t.omission)   tr.className = 'cpt-table-row-omission';

    var type    = t.isNoGo ? '<span class="td-nogo">No-Go (X)</span>' : 'Go';
    var outcome = t.commission  ? '<span class="td-result-error">✗ Commission</span>'
                : t.omission    ? '<span class="td-result-miss">— Omission</span>'
                : t.correctGo   ? '<span class="td-result-correct">✓ Correct</span>'
                :                 '<span class="td-result-none">✓ No-Go ✓</span>';
    var rtTxt   = t.rt !== null ? Math.round(t.rt) + ' ms' : '—';
    var halfTxt = t.warmup ? '<span style="color:#34d399;font-size:0.72rem;">Warm-up</span>'
                : t.half === 0 ? '1st' : '2nd';

    tr.innerHTML =
      '<td class="td-trial-num">' + (t.index + 1) + '</td>' +
      '<td class="td-letter" style="font-family:monospace;font-weight:800;">' + t.letter + '</td>' +
      '<td>' + type + '</td>' +
      '<td>' + outcome + '</td>' +
      '<td class="td-latency">' + rtTxt + '</td>' +
      '<td>' + halfTxt + '</td>';

    tbody.appendChild(tr);
  });
}

// ── Summary ────────────────────────────────────────────────────────────────

function cptRenderSummary(probPct, r) {
  var icon, title, body;

  if (probPct < 25) {
    icon  = '✅';
    title = 'Healthy Sustained Attention';
    body  = 'Your CPT performance is comfortably within neurotypical ranges. Commission and omission errors are low, response time variability is consistent, and gaze remained focused throughout. No significant ADHD-associated markers detected.';
  } else if (probPct < 50) {
    icon  = '🟡';
    title = 'Mild Attentional Variability';
    body  = 'Some deviations from neurotypical baselines were detected. Borderline commission errors, occasional omissions, or response time variability may reflect subclinical attention fluctuation. Consider retesting after rest in a distraction-free environment.';
  } else if (probPct < 75) {
    icon  = '🟠';
    title = 'Elevated Attentional Deficits';
    body  = 'Multiple CPT biomarkers indicate elevated attentional control deficits. Elevated error rates and/or high response variability are consistent with patterns observed in ADHD populations. This is not a clinical diagnosis — consult a specialist.';
  } else {
    icon  = '🔴';
    title = 'Strong ADHD Biomarker Profile';
    body  = 'Significantly elevated commission errors, high response time variability, sustained omissions, and off-task gaze form a profile strongly consistent with ADHD-associated attentional deficits. Share these results with a qualified clinician for formal assessment.';
  }

  var stats =
    ' [Com=' + r.commissionRate.toFixed(1) + '%' +
    ', Omi=' + r.omissionRate.toFixed(1) + '%' +
    (r.rtv !== null ? ', RTV=' + Math.round(r.rtv) + 'ms' : '') +
    ', Gaze=' + r.gazeWander.toFixed(1) + '%' +
    ', Decay=' + r.decayDelta.toFixed(1) + '%]';

  CPTdom.summaryIcon.textContent  = icon;
  CPTdom.summaryTitle.textContent = title;
  CPTdom.summaryBody.textContent  = body + stats;
}

// ── Retest ─────────────────────────────────────────────────────────────────

function cptRetest() {
  clearTimeout(CPT.stimTimer);
  clearTimeout(CPT.trialTimer);
  clearInterval(cptHudTimer);
  document.removeEventListener('keydown', cptOnSpacebar);
  CPT_activeGazeListener = null;

  try {
    if (typeof webgazer.clearGazeListener === 'function') {
      webgazer.clearGazeListener();
    } else { webgazer.setGazeListener(null); }
  } catch (_) {}

  if (typeof webgazer !== 'undefined' && typeof webgazer.resume === 'function') {
    webgazer.resume();
  }

  CalApp.startFaceMonitoring();
  cptStartAccuracyTest();
}

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  cptInitDom();

  // Start button
  CPTdom.startBtn.addEventListener('click', async function () {
    cptShowLoading();
    try {
      await cptInitWebGazer();
      cptHideLoading();

      CalApp.captureFaceReference(function (ref) {
        CalApp.state.faceReference = ref;
        CalApp.startFaceMonitoring();
        if (CalApp.dom.faceInfoBadge)   CalApp.dom.faceInfoBadge.style.display   = 'none';
        if (CalApp.dom.faceBoundaryBox) CalApp.dom.faceBoundaryBox.style.display = 'none';
      });

      cptStartAccuracyTest();
    } catch (err) {
      var t = 'Initialization Failed';
      var m = (err && err.message) ? err.message : 'An unknown error occurred.';
      if ((err && err.name === 'NotAllowedError') || (m && m.indexOf('denied') !== -1)) {
        t = 'Camera Access Denied';
        m = 'Camera access is required. Please allow it in your browser settings.';
      } else if (err && err.name === 'NotFoundError') {
        t = 'No Camera Found';
        m = 'No webcam was detected. Connect a camera and reload the page.';
      }
      cptShowError(t, m);
    }
  });

  // Retest
  CPTdom.retestBtn.addEventListener('click', cptRetest);

  // Error overlay dismiss
  CPTdom.errorBtn.addEventListener('click', function () {
    CPTdom.errorOvl.classList.remove('active');
    var action = CPT_retryAction;
    CPT_retryAction = null;
    if (action === 'accuracy') {
      cptStartAccuracyTest();
    } else {
      cptShowScreen('intro');
    }
  });

  // Force recalibrate button inside error overlay
  var forceRecalBtn = document.getElementById('cpt-force-recal-btn');
  if (forceRecalBtn) {
    forceRecalBtn.addEventListener('click', function () {
      window.location.href = 'calibration.html';
    });
  }

  // Recalibrate overlay buttons
  if (CalApp.dom.recheckBtn) {
    CalApp.dom.recheckBtn.addEventListener('click', CalApp.performAccuracyRecheck);
  }
  var modalFullrecalBtn = document.getElementById('modal-fullrecal-btn');
  if (modalFullrecalBtn) {
    modalFullrecalBtn.addEventListener('click', function () {
      window.location.href = 'calibration.html';
    });
  }

  // Start HUD timer (always ticking once loaded)
  cptStartHudTimer();

  // Cleanup on unload
  window.addEventListener('beforeunload', function () {
    if (typeof webgazer !== 'undefined' && typeof webgazer.end === 'function') {
      webgazer.end();
    }
  });

  // ── Settings panel ───────────────────────────────────────────
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
          CPT.debug.gazeDot = on;
          var el = document.getElementById('gaze-dot');
          if (el) el.classList.toggle('visible', on);
        }
      },
      { type: 'toggle', id: 'camera', label: 'Camera preview', initial: false,
        onChange: function (on) {
          CPT.debug.camera = on;
          var el = document.getElementById('webgazerVideoContainer');
          if (el) el.style.display = on ? '' : 'none';
          if (typeof webgazer.showFaceOverlay === 'function') webgazer.showFaceOverlay(on);
        }
      },
      { type: 'toggle', id: 'face-pos', label: 'Face positioning', initial: false,
        onChange: function (on) {
          CPT.debug.facePositioning = on;
          var badge = CalApp.dom.faceInfoBadge;
          var box   = CalApp.dom.faceBoundaryBox;
          if (badge) badge.style.display = on ? '' : 'none';
          if (box)   box.style.display   = on ? '' : 'none';
        }
      },
    ],
  });
});
