/* ============================================================
   antisaccade-test.js — Antisaccade Task (Inhibitory Control)
   Biomarkers: Directional Error Rate, Saccadic Latency,
               Correction Time, Latency Variability (CV)
   ============================================================ */
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

var AST_CONST = {
  TOTAL_TRIALS:      20,
  FIXATION_MIN_MS:   1000,
  FIXATION_MAX_MS:   2000,
  STIMULUS_MS:       1500,
  BLANK_MS:          500,
  COUNTDOWN_SECS:    3,

  // Minimum saccadic latency filter (below = anticipatory noise, exclude)
  MIN_LATENCY_MS:    80,
  // Maximum latency to count for analysis (beyond = "no saccade detected")
  MAX_LATENCY_MS:    1200,

  // Saccade detection: fraction of screen width for displacement threshold
  SACCADE_THRESH_PCT: 0.15,
  // Require this many consecutive samples past threshold
  SACCADE_CONFIRM_N:  2,

  // Benchmark thresholds
  TD_ERROR_RATE:    15,    // % — neurotypical max error rate
  ADHD_ERROR_RATE:  35,    // % — ADHD marker threshold
  TD_LATENCY_MS:    250,   // ms — neurotypical mean latency
  TD_LATENCY_CV:    30,    // % — neurotypical coefficient of variation
  ADHD_LATENCY_CV:  60,    // % — ADHD latency CV threshold
  TD_CORRECTION_MS: 200,   // ms — neurotypical correction time
  ADHD_CORRECTION_MS: 500, // ms — ADHD correction time threshold
};

// ── State ─────────────────────────────────────────────────────────────────

var AST = {
  // Completed trial records
  trials: [],

  // Current trial
  trialIndex:      0,
  currentSide:     null,   // 'left' | 'right'
  stimOnsetTime:   0,      // performance.now() at stimulus onset
  firstSaccadeFound:   false,
  firstSaccadeTime:    null,   // ms after stimulus onset
  firstSaccadeDir:     null,   // 'left' | 'right'
  errorDetected:       false,
  correctionFound:     false,
  correctionTime:      null,   // ms from first saccade to correction
  consecutiveCount:    0,
  lastSaccadeDir:      null,

  // Timers / listeners
  gazeListener:    null,
  stimTimer:       null,
  blankTimer:      null,
  fixTimer:        null,

  // Task state flags
  taskRunning:     false,
  paused:          false,

  // Debug settings (managed by SettingsPanel)
  debug: {
    gazeDot:         false,
    camera:          false,
    rangeCheck:      false,
    facePositioning: false,
  },
};

// Tracks the active gaze listener so it can be restored after recalibration
var AST_activeGazeListener = null;

// ── DOM ────────────────────────────────────────────────────────────────────

var ASTdom = {};

function $ast(id) { return document.getElementById(id); }

function astInitDom() {
  ASTdom.introScreen   = $ast('ast-intro-screen');
  ASTdom.taskScreen    = $ast('ast-task-screen');
  ASTdom.resultsScreen = $ast('ast-results-screen');
  ASTdom.loadingOvl    = $ast('ast-loading-overlay');
  ASTdom.errorOvl      = $ast('ast-error-overlay');
  ASTdom.errorTitle    = $ast('ast-error-title');
  ASTdom.errorMsg      = $ast('ast-error-message');
  ASTdom.errorBtn      = $ast('ast-error-btn');
  ASTdom.startBtn      = $ast('ast-start-btn');
  ASTdom.retestBtn     = $ast('ast-retest-btn');

  // Task elements
  ASTdom.countdown     = $ast('ast-countdown');
  ASTdom.countdownNum  = $ast('ast-countdown-num');
  ASTdom.countdownArc  = $ast('ast-countdown-arc');
  ASTdom.fixation      = $ast('ast-fixation');
  ASTdom.stimulus      = $ast('ast-stimulus');
  ASTdom.arrowHint     = $ast('ast-arrow-hint');
  ASTdom.lookAwayText  = $ast('ast-look-away-text');
  ASTdom.phaseBanner   = $ast('ast-phase-banner');
  ASTdom.liveHud       = $ast('ast-live-hud');
  ASTdom.hudTrialNum   = $ast('ast-hud-trial-num');
  ASTdom.hudProgress   = $ast('ast-hud-progress-fill');
  ASTdom.hudErrors     = $ast('ast-hud-errors');
  ASTdom.hudLatency    = $ast('ast-hud-latency');
  ASTdom.hudPhase      = $ast('ast-hud-phase');
  ASTdom.feedbackFlash = $ast('ast-feedback-flash');
  ASTdom.gazeDot       = $ast('gaze-dot');

  // Results elements
  ASTdom.gaugeArc      = $ast('ast-gauge-arc');
  ASTdom.gaugePct      = $ast('ast-gauge-pct');
  ASTdom.gaugeLabel    = $ast('ast-gauge-label');
  ASTdom.gaugeNeedle   = $ast('ast-gauge-needle');

  ASTdom.rcErrBadge    = $ast('ast-rc-err-badge');
  ASTdom.rcErrVal      = $ast('ast-rc-err-val');
  ASTdom.rcErrBar      = $ast('ast-rc-err-bar');
  ASTdom.rcErrDesc     = $ast('ast-rc-err-desc');

  ASTdom.rcLatBadge    = $ast('ast-rc-lat-badge');
  ASTdom.rcLatVal      = $ast('ast-rc-lat-val');
  ASTdom.rcLatBar      = $ast('ast-rc-lat-bar');
  ASTdom.rcLatDesc     = $ast('ast-rc-lat-desc');

  ASTdom.rcCvBadge     = $ast('ast-rc-cv-badge');
  ASTdom.rcCvVal       = $ast('ast-rc-cv-val');
  ASTdom.rcCvBar       = $ast('ast-rc-cv-bar');
  ASTdom.rcCvDesc      = $ast('ast-rc-cv-desc');

  ASTdom.rcCorBadge    = $ast('ast-rc-cor-badge');
  ASTdom.rcCorVal      = $ast('ast-rc-cor-val');
  ASTdom.rcCorBar      = $ast('ast-rc-cor-bar');
  ASTdom.rcCorDesc     = $ast('ast-rc-cor-desc');

  ASTdom.tableBody     = $ast('ast-table-body');
  ASTdom.summaryIcon   = $ast('ast-summary-icon');
  ASTdom.summaryTitle  = $ast('ast-summary-title');
  ASTdom.summaryBody   = $ast('ast-summary-body');

  // Wire CalApp DOM for face-tracking.js
  CalApp.dom.faceBoundaryBox     = $ast('face-boundary-box');
  CalApp.dom.faceInfoBadge       = $ast('face-info-badge');
  CalApp.dom.fiOffset            = $ast('fi-offset');
  CalApp.dom.fiDepth             = $ast('fi-depth');
  CalApp.dom.fiStatus            = $ast('fi-status');
  CalApp.dom.positionWarning     = $ast('position-warning');
  CalApp.dom.positionWarningText = $ast('position-warning-text');
  CalApp.dom.gazeDot             = $ast('gaze-dot');

  // Recalibrate overlay
  CalApp.dom.recalibrateOvl      = $ast('recalibrate-overlay');
  CalApp.dom.recalibrateTitle    = $ast('recalibrate-title');
  CalApp.dom.recalibrateMsg      = $ast('recalibrate-message');
  CalApp.dom.recalibrateAccuracy = $ast('recalibrate-accuracy');
  CalApp.dom.recheckBtn          = $ast('recheck-btn');
  CalApp.dom.statAcc             = { textContent: '' };

  // Pause the task during recalibration
  var _originalTriggerAST = CalApp.triggerAccuracyRecheck;
  CalApp.triggerAccuracyRecheck = function () {
    astPauseTask();
    _originalTriggerAST.call(CalApp);
  };

  // After recheck completes, restore task gaze listener and resume
  CalApp.startGazeDemo = function () {
    if (typeof AST_activeGazeListener === 'function') {
      webgazer.setGazeListener(AST_activeGazeListener);
    }
    CalApp.startFaceMonitoring();
    astResumeTask();
  };

  // After recheck, compute tol80 (80th-percentile gaze distance) and store it
  // on CalApp.state for reference; then run the default evaluateRecheck logic.
  var _originalEvalAST = CalApp.evaluateRecheck;
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
      if (tol80 > 0) s.lastTol80 = tol80;
    }
    _originalEvalAST.call(CalApp);
  };
}

// ── Screen helpers ─────────────────────────────────────────────────────────

function astShowScreen(name) {
  var map = {
    intro:   ASTdom.introScreen,
    task:    ASTdom.taskScreen,
    results: ASTdom.resultsScreen,
  };
  Object.values(map).forEach(function (s) { s.classList.remove('active'); });
  map[name].classList.add('active');
}

function astShowLoading() { ASTdom.loadingOvl.classList.add('active'); }
function astHideLoading() { ASTdom.loadingOvl.classList.remove('active'); }

// 'accuracy' → retry accuracy check; 'init' → back to intro
var AST_retryAction = null;

function astShowError(title, msg, retryAction) {
  astHideLoading();
  AST_retryAction = retryAction || 'intro';
  ASTdom.errorTitle.textContent = title;
  ASTdom.errorMsg.textContent   = msg;
  ASTdom.errorOvl.classList.add('active');
}

// ── WebGazer bootstrap ─────────────────────────────────────────────────────

async function astInitWebGazer() {
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

function astMean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
}

function astVariance(arr) {
  if (arr.length < 2) return 0;
  var m = astMean(arr);
  return arr.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (arr.length - 1);
}

function astStdDev(arr) { return Math.sqrt(astVariance(arr)); }

function astSigmoidScore(value, low, high) {
  if (high <= low) return value >= high ? 1 : 0;
  var norm    = (value - low) / (high - low);
  var clamped = Math.max(0, Math.min(1, norm));
  return clamped * clamped * (3 - 2 * clamped);  // smooth-step
}

// ── Pause / Resume (during recalibration) ─────────────────────────────────

function astPauseTask() {
  if (!AST.taskRunning || AST.paused) return;
  AST.paused = true;

  // Stop all running trial timers
  clearTimeout(AST.fixTimer);
  clearTimeout(AST.stimTimer);
  clearTimeout(AST.blankTimer);

  // Clear gaze listener so interrupted trial data isn't corrupted
  try {
    if (typeof webgazer.clearGazeListener === 'function') {
      webgazer.clearGazeListener();
    } else { webgazer.setGazeListener(null); }
  } catch (_) {}

  // Hide task visuals
  ASTdom.fixation.style.display  = 'none';
  ASTdom.stimulus.className      = 'ast-stimulus';
  ASTdom.arrowHint.className     = 'ast-arrow-hint';
  ASTdom.lookAwayText.className  = 'ast-look-away-text';
  ASTdom.feedbackFlash.className = 'ast-feedback-flash';
  ASTdom.phaseBanner.textContent = '⏸ Paused — Recalibrating…';
  ASTdom.phaseBanner.className   = 'ast-phase-banner phase-blank';
}

function astResumeTask() {
  if (!AST.taskRunning || !AST.paused) return;
  AST.paused = false;

  // Re-run the current trial from scratch (fixation → stimulus → record)
  astRunTrial();
}

// ── Accuracy check phase ───────────────────────────────────────────────────

function astStartAccuracyTest() {
  astShowScreen('task');
  ASTdom.fixation.style.display   = 'none';
  ASTdom.stimulus.style.display   = 'none';
  ASTdom.liveHud.style.display    = 'none';
  ASTdom.countdown.style.display  = 'none';
  ASTdom.phaseBanner.style.display = 'none';

  var card = document.createElement('div');
  card.className = 'acc-warning-card';
  card.innerHTML =
    '<div class="acc-warning-icon">🎯</div>' +
    '<h3>Accuracy Check</h3>' +
    '<p>A gold dot will appear at the centre of the screen.<br>' +
    'Stare <strong>directly at it</strong> for 3 seconds.</p>';
  ASTdom.taskScreen.appendChild(card);
  requestAnimationFrame(function () { card.classList.add('visible'); });

  setTimeout(function () {
    card.style.opacity = '0';
    setTimeout(function () { card.remove(); astStartAccuracyDot(); }, 400);
  }, 2500);
}

function astStartAccuracyDot() {
  var dot = document.createElement('div');
  dot.className = 'acc-dot';
  ASTdom.taskScreen.appendChild(dot);
  requestAnimationFrame(function () { dot.classList.add('visible'); });

  var banner = document.createElement('div');
  banner.className = 'acc-instr-banner';
  ASTdom.taskScreen.appendChild(banner);

  var samples = [];
  AST_activeGazeListener = function (data) {
    if (!data) return;
    samples.push({ x: data.x, y: data.y });
    if (AST.debug.gazeDot && ASTdom.gazeDot) {
      ASTdom.gazeDot.style.left = data.x + 'px';
      ASTdom.gazeDot.style.top  = data.y + 'px';
    }
  };
  webgazer.setGazeListener(AST_activeGazeListener);

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
          astStartTask();
        } else {
          astShowError(
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

function astRunCountdown(cb) {
  ASTdom.countdown.style.display = 'flex';
  ASTdom.fixation.style.display  = 'none';
  ASTdom.liveHud.style.display   = 'none';
  ASTdom.phaseBanner.style.display = 'none';

  var n = AST_CONST.COUNTDOWN_SECS;
  var arc = ASTdom.countdownArc;
  var FULL = 276.46;

  (function tick() {
    ASTdom.countdownNum.textContent = n;
    arc.style.strokeDashoffset = (FULL * (1 - n / AST_CONST.COUNTDOWN_SECS)).toFixed(2);
    if (n <= 0) {
      ASTdom.countdown.style.display = 'none';
      cb();
      return;
    }
    n--;
    setTimeout(tick, 1000);
  })();
}

// ── Task execution ─────────────────────────────────────────────────────────

function astStartTask() {
  AST.trials      = [];
  AST.trialIndex  = 0;
  AST.taskRunning = true;

  astShowScreen('task');
  astRunCountdown(function () {
    ASTdom.liveHud.style.display    = 'flex';
    ASTdom.phaseBanner.style.display = 'block';
    astUpdateHud();
    astRunTrial();
  });
}

function astRunTrial() {
  if (AST.paused) return;
  if (AST.trialIndex >= AST_CONST.TOTAL_TRIALS) {
    astFinishTask();
    return;
  }

  // Reset per-trial state
  AST.currentSide         = Math.random() < 0.5 ? 'left' : 'right';
  AST.firstSaccadeFound   = false;
  AST.firstSaccadeTime    = null;
  AST.firstSaccadeDir     = null;
  AST.errorDetected       = false;
  AST.correctionFound     = false;
  AST.correctionTime      = null;
  AST.consecutiveCount    = 0;
  AST.lastSaccadeDir      = null;

  astSetPhase('fixation');
  ASTdom.fixation.style.display = 'flex';
  ASTdom.stimulus.className     = 'ast-stimulus';  // hidden
  ASTdom.arrowHint.className    = 'ast-arrow-hint';
  ASTdom.lookAwayText.className = 'ast-look-away-text';
  ASTdom.feedbackFlash.className = 'ast-feedback-flash';

  // Random fixation duration
  var fixDur = AST_CONST.FIXATION_MIN_MS +
    Math.random() * (AST_CONST.FIXATION_MAX_MS - AST_CONST.FIXATION_MIN_MS);

  AST.fixTimer = setTimeout(function () { astShowStimulus(); }, fixDur);
}

function astShowStimulus() {
  var side = AST.currentSide;

  // Hide fixation cross, show stimulus
  ASTdom.fixation.style.display = 'none';
  astSetPhase('stimulus');

  // Position and reveal stimulus
  ASTdom.stimulus.className = 'ast-stimulus side-' + side + ' visible';

  // Arrow hint pointing to opposite side
  var hintSide = side === 'left' ? 'side-right' : 'side-left';
  ASTdom.arrowHint.textContent = side === 'left' ? '→' : '←';
  ASTdom.arrowHint.className = 'ast-arrow-hint ' + hintSide + ' visible';

  // "LOOK AWAY" text on opposite side
  ASTdom.lookAwayText.textContent = 'LOOK AWAY';
  ASTdom.lookAwayText.className = 'ast-look-away-text ' + hintSide;

  // Begin gaze tracking for this trial
  AST.stimOnsetTime = performance.now();
  astInstallTrialGazeListener();

  // End stimulus after window
  AST.stimTimer = setTimeout(function () { astEndStimulus(); }, AST_CONST.STIMULUS_MS);
}

function astInstallTrialGazeListener() {
  var screenW  = window.innerWidth;
  var centerX  = screenW / 2;
  var threshold = screenW * AST_CONST.SACCADE_THRESH_PCT;
  var stimSide  = AST.currentSide;

  AST_activeGazeListener = function (data) {
    if (!data) return;

    var now     = performance.now();
    var elapsed = now - AST.stimOnsetTime;

    // Update gaze-dot overlay if enabled
    if (AST.debug.gazeDot && ASTdom.gazeDot) {
      ASTdom.gazeDot.style.left = data.x + 'px';
      ASTdom.gazeDot.style.top  = data.y + 'px';
    }

    // -- First saccade detection --
    if (!AST.firstSaccadeFound) {
      // Skip anticipatory noise
      if (elapsed < AST_CONST.MIN_LATENCY_MS) return;
      // Skip beyond useful window
      if (elapsed > AST_CONST.MAX_LATENCY_MS) return;

      var dx  = data.x - centerX;
      var dir = dx > 0 ? 'right' : 'left';

      if (Math.abs(dx) > threshold) {
        if (dir === AST.lastSaccadeDir) {
          AST.consecutiveCount++;
        } else {
          AST.lastSaccadeDir  = dir;
          AST.consecutiveCount = 1;
        }

        if (AST.consecutiveCount >= AST_CONST.SACCADE_CONFIRM_N) {
          // First saccade confirmed
          AST.firstSaccadeFound = true;
          AST.firstSaccadeTime  = elapsed;
          AST.firstSaccadeDir   = dir;

          // Classify: correct if direction is AWAY from stimulus
          var correctDir = stimSide === 'left' ? 'right' : 'left';
          AST.errorDetected = (dir !== correctDir);

          astShowFeedback(AST.errorDetected);
        }
      } else {
        if (dir !== AST.lastSaccadeDir) {
          AST.lastSaccadeDir   = null;
          AST.consecutiveCount = 0;
        }
      }

    } else if (AST.errorDetected && !AST.correctionFound) {
      // Monitor for correction
      var correctDir2 = stimSide === 'left' ? 'right' : 'left';
      var correctionReached = correctDir2 === 'right'
        ? data.x > centerX + threshold
        : data.x < centerX - threshold;

      if (correctionReached) {
        AST.correctionFound = true;
        AST.correctionTime  = (performance.now() - AST.stimOnsetTime) - AST.firstSaccadeTime;
      }
    }
  };

  webgazer.setGazeListener(AST_activeGazeListener);
}

function astShowFeedback(isError) {
  var el = ASTdom.feedbackFlash;
  el.textContent = isError ? '✗ Inhibition Failure' : '✓ Correct';
  el.className = 'ast-feedback-flash ' + (isError ? 'flash-error' : 'flash-correct');
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(function () {
    el.className = 'ast-feedback-flash';
  }, 600);
}

function astEndStimulus() {
  // Stop gaze listener
  try {
    if (typeof webgazer.clearGazeListener === 'function') {
      webgazer.clearGazeListener();
    } else {
      webgazer.setGazeListener(null);
    }
  } catch (_) {}
  AST_activeGazeListener = null;

  // Hide stimulus
  ASTdom.stimulus.className     = 'ast-stimulus';
  ASTdom.arrowHint.className    = 'ast-arrow-hint';
  ASTdom.lookAwayText.className = 'ast-look-away-text';
  ASTdom.feedbackFlash.className = 'ast-feedback-flash';

  // Record trial
  AST.trials.push({
    index:          AST.trialIndex,
    side:           AST.currentSide,
    saccadeFound:   AST.firstSaccadeFound,
    saccadeDir:     AST.firstSaccadeDir,
    isError:        AST.firstSaccadeFound && AST.errorDetected,
    latency:        AST.firstSaccadeFound ? AST.firstSaccadeTime : null,
    correctionTime: (AST.firstSaccadeFound && AST.errorDetected && AST.correctionFound)
                    ? AST.correctionTime : null,
  });

  AST.trialIndex++;
  astUpdateHud();

  // Blank inter-trial interval, then next trial
  astSetPhase('blank');
  ASTdom.fixation.style.display = 'none';
  AST.blankTimer = setTimeout(function () { astRunTrial(); }, AST_CONST.BLANK_MS);
}

function astSetPhase(phase) {
  var banner = ASTdom.phaseBanner;
  var labels = {
    fixation: '● Fixation — hold your gaze at center',
    stimulus: '⚡ LOOK AWAY — respond to the opposite side',
    blank:    '',
  };
  banner.textContent = labels[phase] || '';
  banner.className = 'ast-phase-banner phase-' + phase;
}

function astUpdateHud() {
  var n     = AST.trialIndex;
  var total = AST_CONST.TOTAL_TRIALS;

  ASTdom.hudTrialNum.textContent = n + 1 <= total ? n + 1 : total;
  ASTdom.hudProgress.style.width = ((n / total) * 100).toFixed(1) + '%';

  // Running error rate
  var completedErrors = AST.trials.filter(function (t) { return t.isError; }).length;
  var completedTotal  = AST.trials.length;
  if (completedTotal > 0) {
    var errRate = (completedErrors / completedTotal) * 100;
    ASTdom.hudErrors.textContent = errRate.toFixed(0) + '%';
    ASTdom.hudErrors.className = 'ast-hud-metric-val ' +
      (errRate < AST_CONST.TD_ERROR_RATE    ? 'val-good' :
       errRate < AST_CONST.ADHD_ERROR_RATE  ? 'val-warn' : 'val-bad');
  } else {
    ASTdom.hudErrors.textContent = '—';
    ASTdom.hudErrors.className   = 'ast-hud-metric-val';
  }

  // Running mean latency
  var latencies = AST.trials
    .filter(function (t) { return t.latency !== null; })
    .map(function (t) { return t.latency; });
  if (latencies.length > 0) {
    ASTdom.hudLatency.textContent = Math.round(astMean(latencies)) + 'ms';
  } else {
    ASTdom.hudLatency.textContent = '—';
  }
}

// ── Finish task & compute results ──────────────────────────────────────────

function astFinishTask() {
  AST.taskRunning = false;
  ASTdom.fixation.style.display    = 'none';
  ASTdom.stimulus.className        = 'ast-stimulus';
  ASTdom.arrowHint.className       = 'ast-arrow-hint';
  ASTdom.lookAwayText.className    = 'ast-look-away-text';
  ASTdom.phaseBanner.style.display = 'none';
  ASTdom.liveHud.style.display     = 'none';

  CalApp.stopFaceMonitoring();

  astComputeAndShow();
}

function astComputeAndShow() {
  var trials = AST.trials;
  var total  = trials.length;

  if (total === 0) {
    astShowError('No Data', 'No trials were recorded. Please try again.');
    return;
  }

  // Error rate
  var errors     = trials.filter(function (t) { return t.isError; });
  var errorRate  = (errors.length / total) * 100;

  // Saccadic latency — only trials where a saccade was detected
  var latencies = trials
    .filter(function (t) { return t.latency !== null; })
    .map(function (t) { return t.latency; });

  var meanLat = latencies.length > 0 ? astMean(latencies) : null;
  var sdLat   = latencies.length > 1 ? astStdDev(latencies) : null;
  var cv      = (meanLat && meanLat > 0 && sdLat !== null)
                ? (sdLat / meanLat) * 100 : null;

  // Correction times
  var corrTimes = trials
    .filter(function (t) { return t.correctionTime !== null; })
    .map(function (t) { return t.correctionTime; });
  var meanCor = corrTimes.length > 0 ? astMean(corrTimes) : null;

  // ADHD probability
  var prob = astComputeAdhdProb(errorRate, cv, meanCor);

  // Persist to localStorage
  try {
    var history = [];
    var raw = localStorage.getItem('neurogaze_test_history');
    if (raw) history = JSON.parse(raw);
    history.push({
      name:        'Antisaccade Test',
      time:        Date.now(),
      errorRate:   errorRate,
      meanLat:     meanLat,
      cv:          cv,
      meanCor:     meanCor,
      prob:        prob,
      latencies:   latencies.slice(0, 120).map(function(v){ return Math.round(v); }),
      totalTrials: total,
      errorCount:  errors.length,
    });
    localStorage.setItem('neurogaze_test_history', JSON.stringify(history));
  } catch (_) {}

  astShowScreen('results');
  astRenderResults({
    total:     total,
    errors:    errors.length,
    errorRate: errorRate,
    latencies: latencies,
    meanLat:   meanLat,
    sdLat:     sdLat,
    cv:        cv,
    corrTimes: corrTimes,
    meanCor:   meanCor,
    prob:      prob,
    trials:    trials,
  });
}

// ── ADHD Probability ──────────────────────────────────────────────────────

function astComputeAdhdProb(errorRate, cv, meanCor) {
  // Error Rate — primary marker (55% weight)
  var errScore = astSigmoidScore(
    errorRate,
    AST_CONST.TD_ERROR_RATE,
    AST_CONST.ADHD_ERROR_RATE + 30  // ~65% for max
  );

  // Latency CV — variability marker (30% weight)
  var cvScore = cv !== null
    ? astSigmoidScore(cv, AST_CONST.TD_LATENCY_CV, AST_CONST.ADHD_LATENCY_CV + 20)
    : 0.3;  // default mild contribution if no data

  // Correction Time (15% weight)
  var corScore = meanCor !== null
    ? astSigmoidScore(meanCor, AST_CONST.TD_CORRECTION_MS, AST_CONST.ADHD_CORRECTION_MS + 200)
    : 0;

  var score = errScore * 0.55 + cvScore * 0.30 + corScore * 0.15;
  return Math.min(1, Math.max(0, score));
}

// ── Results rendering ─────────────────────────────────────────────────────

function astRenderResults(r) {
  var probPct = Math.round(r.prob * 100);

  // Gauge
  astAnimateGauge(r.prob, probPct);

  // Error Rate card
  var errStatus = r.errorRate < AST_CONST.TD_ERROR_RATE   ? 'td'
                : r.errorRate < AST_CONST.ADHD_ERROR_RATE  ? 'borderline'
                : 'adhd';
  astSetBadge(ASTdom.rcErrBadge, errStatus);
  ASTdom.rcErrVal.innerHTML =
    r.errorRate.toFixed(1) + '%' +
    '<span class="ast-rc-val-sub"> (' + r.errors + ' / ' + r.total + ' trials)</span>';
  ASTdom.rcErrBar.style.width = Math.min(100, r.errorRate * 1.5).toFixed(1) + '%';
  ASTdom.rcErrBar.className   = 'ast-rc-bar ' + errStatus;
  ASTdom.rcErrDesc.textContent = astDescribeErr(r.errorRate);

  // Saccadic Latency card
  var latStatus = r.meanLat === null      ? 'borderline'
                : r.meanLat < 180         ? 'borderline'     // too fast, anticipatory
                : r.meanLat < 400         ? 'td'
                : 'adhd';
  astSetBadge(ASTdom.rcLatBadge, latStatus);
  ASTdom.rcLatVal.innerHTML = r.meanLat !== null
    ? Math.round(r.meanLat) + ' ms' +
      (r.sdLat !== null ? '<span class="ast-rc-val-sub"> ±' + Math.round(r.sdLat) + ' ms SD</span>' : '')
    : '—';
  var latBarPct = r.meanLat !== null ? Math.min(100, (r.meanLat / 800) * 100) : 0;
  ASTdom.rcLatBar.style.width = latBarPct.toFixed(1) + '%';
  ASTdom.rcLatBar.className   = 'ast-rc-bar ' + latStatus;
  ASTdom.rcLatDesc.textContent = astDescribeLat(r.meanLat, r.sdLat);

  // Latency CV card
  var cvStatus = r.cv === null                              ? 'borderline'
               : r.cv < AST_CONST.TD_LATENCY_CV             ? 'td'
               : r.cv < AST_CONST.ADHD_LATENCY_CV           ? 'borderline'
               : 'adhd';
  astSetBadge(ASTdom.rcCvBadge, cvStatus);
  ASTdom.rcCvVal.innerHTML = r.cv !== null
    ? r.cv.toFixed(1) + '%' + '<span class="ast-rc-val-sub"> coefficient of variation</span>'
    : '—';
  var cvBarPct = r.cv !== null ? Math.min(100, r.cv) : 0;
  ASTdom.rcCvBar.style.width = cvBarPct.toFixed(1) + '%';
  ASTdom.rcCvBar.className   = 'ast-rc-bar ' + cvStatus;
  ASTdom.rcCvDesc.textContent = astDescribeCv(r.cv);

  // Correction Time card
  var corStatus = r.meanCor === null                          ? 'td'
                : r.meanCor < AST_CONST.TD_CORRECTION_MS      ? 'td'
                : r.meanCor < AST_CONST.ADHD_CORRECTION_MS    ? 'borderline'
                : 'adhd';
  astSetBadge(ASTdom.rcCorBadge, corStatus);
  ASTdom.rcCorVal.innerHTML = r.meanCor !== null
    ? Math.round(r.meanCor) + ' ms' +
      '<span class="ast-rc-val-sub"> (avg over ' + r.corrTimes.length + ' errors)</span>'
    : '— <span class="ast-rc-val-sub">no errors to correct</span>';
  var corBarPct = r.meanCor !== null ? Math.min(100, (r.meanCor / 1000) * 100) : 0;
  ASTdom.rcCorBar.style.width = corBarPct.toFixed(1) + '%';
  ASTdom.rcCorBar.className   = 'ast-rc-bar ' + corStatus;
  ASTdom.rcCorDesc.textContent = astDescribeCor(r.meanCor, r.errors);

  // Per-trial data table
  astRenderTable(r.trials);

  // Summary
  astRenderSummary(probPct, r.errorRate, r.cv, r.meanLat, r.meanCor);
}

function astAnimateGauge(prob, probPct) {
  var ARC_FULL = 283;
  var color = prob < 0.35 ? '#4cd964'
            : prob < 0.60 ? '#ffcc00'
            : prob < 0.80 ? '#ff9500'
            :               '#ff3b30';

  ASTdom.gaugeArc.style.stroke = color;

  var start    = performance.now();
  var duration = 1200;
  (function frame(ts) {
    var t     = Math.min(1, (ts - start) / duration);
    var eased = 1 - Math.pow(1 - t, 3);
    ASTdom.gaugeArc.style.strokeDashoffset = (ARC_FULL * (1 - eased * prob)).toFixed(2);

    var deg = -90 + 180 * eased * prob;
    ASTdom.gaugeNeedle.setAttribute('transform', 'rotate(' + deg.toFixed(1) + ' 100 100)');
    ASTdom.gaugePct.textContent = Math.round(eased * probPct) + '%';

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      ASTdom.gaugePct.textContent = probPct + '%';
      ASTdom.gaugePct.style.color = color;
    }
  })(start);

  ASTdom.gaugeLabel.textContent =
    prob < 0.35 ? 'Neurotypical Pattern' :
    prob < 0.60 ? 'Mild Inhibitory Deficits' :
    prob < 0.80 ? 'Elevated ADHD Indicators' :
                  'Strong ADHD Biomarkers';
  ASTdom.gaugeLabel.style.color = color;
}

function astSetBadge(el, status) {
  el.className = 'ast-rc-badge badge-' + status;
  el.textContent = status === 'td'         ? 'Neurotypical'
                 : status === 'borderline' ? 'Borderline'
                 :                          'ADHD Marker';
}

function astDescribeErr(rate) {
  if (rate < AST_CONST.TD_ERROR_RATE)
    return 'Error rate is within neurotypical norms. Inhibitory control appears intact — the brain is successfully suppressing reflexive glances toward the stimulus.';
  if (rate < AST_CONST.ADHD_ERROR_RATE)
    return 'Moderate error rate. Some difficulty suppressing reflexive saccades. Borderline inhibitory control, may reflect attention variability or fatigue.';
  return 'High error rate (' + rate.toFixed(1) + '%). The brain is frequently failing to suppress the reflexive glance toward the stimulus. This is a strong marker of inhibitory control deficits consistent with ADHD.';
}

function astDescribeLat(mean, sd) {
  if (mean === null) return 'Insufficient trials with detectable saccades for latency analysis.';
  if (mean < 180) return 'Extremely fast responses suggest anticipatory saccades (before visual processing could guide them). This may inflate accuracy artificially.';
  if (mean < 350)
    return 'Saccadic latency is within the neurotypical range (~250ms). Response speed is consistent with efficient oculomotor processing.';
  return 'Elevated mean latency (' + Math.round(mean) + 'ms). Slow initial eye movements may reflect delayed inhibitory processing or motor initiation difficulties.';
}

function astDescribeCv(cv) {
  if (cv === null)
    return 'Insufficient data to compute latency variability.';
  if (cv < AST_CONST.TD_LATENCY_CV)
    return 'Low latency variability (CV ' + cv.toFixed(1) + '%). Consistent response timing is characteristic of stable attention and executive control.';
  if (cv < AST_CONST.ADHD_LATENCY_CV)
    return 'Moderate latency variability (CV ' + cv.toFixed(1) + '%). Some inconsistency in response timing — within the borderline range.';
  return 'High latency variability (CV ' + cv.toFixed(1) + '%). Highly inconsistent saccade timing is a hallmark of ADHD, reflecting intraindividual variability in response inhibition.';
}

function astDescribeCor(cor, errorCount) {
  if (errorCount === 0 || cor === null)
    return 'No errors occurred, so correction time is not applicable. Perfect inhibitory control was demonstrated.';
  if (cor < AST_CONST.TD_CORRECTION_MS)
    return 'Rapid error correction (' + Math.round(cor) + 'ms). Even when an error was made, the system quickly detected and corrected it — within neurotypical ranges.';
  if (cor < AST_CONST.ADHD_CORRECTION_MS)
    return 'Moderate correction time (' + Math.round(cor) + 'ms). Errors took a borderline amount of time to detect and correct.';
  return 'Slow error correction (' + Math.round(cor) + 'ms). Significantly delayed correction of inhibition failures is consistent with reduced self-monitoring in ADHD.';
}

// ── Per-trial table ───────────────────────────────────────────────────────

function astRenderTable(trials) {
  var tbody = ASTdom.tableBody;
  tbody.innerHTML = '';

  trials.forEach(function (t) {
    var tr = document.createElement('tr');
    if (t.isError) tr.className = 'ast-table-row-error';

    var sideArrow  = t.side === 'left' ? '← Left' : 'Right →';
    var sacDir     = t.saccadeDir ? (t.saccadeDir === 'left' ? '← Left' : 'Right →') : '—';
    var resultTxt  = !t.saccadeFound ? '<span class="td-result-none">— No Response</span>'
                   : t.isError       ? '<span class="td-result-error">✗ Error</span>'
                   :                   '<span class="td-result-correct">✓ Correct</span>';
    var latTxt     = t.latency !== null ? Math.round(t.latency) + ' ms' : '—';
    var corTxt     = t.correctionTime !== null
                   ? '<span class="td-correction">' + Math.round(t.correctionTime) + ' ms</span>'
                   : '—';

    tr.innerHTML =
      '<td class="td-trial-num">' + (t.index + 1) + '</td>' +
      '<td class="td-side">' + sideArrow + '</td>' +
      '<td>' + sacDir + '</td>' +
      '<td>' + resultTxt + '</td>' +
      '<td class="td-latency">' + latTxt + '</td>' +
      '<td>' + corTxt + '</td>';

    tbody.appendChild(tr);
  });
}

// ── Summary interpretation ─────────────────────────────────────────────────

function astRenderSummary(probPct, errorRate, cv, meanLat, meanCor) {
  var icon, title, body, cls;

  if (probPct < 25) {
    icon  = '✅';
    title = 'Strong Inhibitory Control';
    body  = 'Your antisaccade performance is comfortably within neurotypical ranges. Error rate, latency, and variability all indicate healthy top-down inhibitory control. No significant markers of ADHD-associated oculomotor dysregulation detected.';
    cls   = 'sum-td';
  } else if (probPct < 50) {
    icon  = '🟡';
    title = 'Mild Inhibitory Deficits';
    body  = 'Some deviations from neurotypical baselines were detected. Borderline error rate or latency variability may indicate subclinical attention variability. Consider retesting after adequate rest and in a distraction-free environment.';
    cls   = 'sum-border';
  } else if (probPct < 75) {
    icon  = '🟠';
    title = 'Elevated ADHD Indicators';
    body  = 'Multiple antisaccade biomarkers indicate elevated inhibitory control deficits. Elevated error rate and/or high latency variability are consistent with patterns observed in ADHD populations. This is not a clinical diagnosis — consult a specialist.';
    cls   = 'sum-elevated';
  } else {
    icon  = '🔴';
    title = 'Strong ADHD Biomarker Profile';
    body  = 'Significantly elevated error rate, high latency variability, and delayed correction times form a profile strongly consistent with ADHD-associated inhibitory control deficits. Share these results with a qualified clinician for formal assessment.';
    cls   = 'sum-adhd';
  }

  var statsDetail =
    ' [Errors=' + errorRate.toFixed(1) + '%' +
    (meanLat !== null ? ', Latency=' + Math.round(meanLat) + 'ms' : '') +
    (cv      !== null ? ', CV=' + cv.toFixed(1) + '%' : '') +
    (meanCor !== null ? ', CorrTime=' + Math.round(meanCor) + 'ms' : '') +
    ']';

  ASTdom.summaryIcon.textContent  = icon;
  ASTdom.summaryIcon.className    = 'ast-summary-icon ' + cls;
  ASTdom.summaryTitle.textContent = title;
  ASTdom.summaryBody.textContent  = body + statsDetail;
}

// ── Retest ─────────────────────────────────────────────────────────────────

function astRetest() {
  clearTimeout(AST.fixTimer);
  clearTimeout(AST.stimTimer);
  clearTimeout(AST.blankTimer);
  AST_activeGazeListener = null;

  try {
    if (typeof webgazer.clearGazeListener === 'function') {
      webgazer.clearGazeListener();
    } else {
      webgazer.setGazeListener(null);
    }
  } catch (_) {}

  if (typeof webgazer !== 'undefined' && typeof webgazer.resume === 'function') {
    webgazer.resume();
  }

  CalApp.startFaceMonitoring();
  astStartAccuracyTest();
}

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  astInitDom();

  // Start button
  ASTdom.startBtn.addEventListener('click', async function () {
    astShowLoading();
    try {
      await astInitWebGazer();
      astHideLoading();

      CalApp.captureFaceReference(function (ref) {
        CalApp.state.faceReference = ref;
        CalApp.startFaceMonitoring();
        if (CalApp.dom.faceInfoBadge)   CalApp.dom.faceInfoBadge.style.display   = 'none';
        if (CalApp.dom.faceBoundaryBox) CalApp.dom.faceBoundaryBox.style.display = 'none';
      });

      astStartAccuracyTest();
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
      astShowError(t, m);
    }
  });

  // Retest
  ASTdom.retestBtn.addEventListener('click', astRetest);

  // Error overlay — dismiss
  ASTdom.errorBtn.addEventListener('click', function () {
    ASTdom.errorOvl.classList.remove('active');
    var action = AST_retryAction;
    AST_retryAction = null;
    if (action === 'accuracy') {
      astStartAccuracyTest();
    } else {
      astShowScreen('intro');
    }
  });

  // Force recalibrate (error overlay)
  var forceRecalBtn = document.getElementById('ast-force-recal-btn');
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

  // Cleanup on unload
  window.addEventListener('beforeunload', function () {
    if (typeof webgazer !== 'undefined' && typeof webgazer.end === 'function') {
      webgazer.end();
    }
  });

  // ── Settings / debug panel ──────────────────────────────────────
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
          AST.debug.gazeDot = on;
          var el = document.getElementById('gaze-dot');
          if (el) el.classList.toggle('visible', on);
        }
      },
      { type: 'toggle', id: 'camera', label: 'Camera preview', initial: false,
        onChange: function (on) {
          AST.debug.camera = on;
          var el = document.getElementById('webgazerVideoContainer');
          if (el) el.style.display = on ? '' : 'none';
          if (typeof webgazer.showFaceOverlay === 'function') webgazer.showFaceOverlay(on);
        }
      },
      { type: 'toggle', id: 'face-pos', label: 'Face positioning', initial: false,
        onChange: function (on) {
          AST.debug.facePositioning = on;
          var badge = CalApp.dom.faceInfoBadge;
          var box   = CalApp.dom.faceBoundaryBox;
          if (badge) badge.style.display = on ? '' : 'none';
          if (box)   box.style.display   = on ? '' : 'none';
        }
      },
    ],
  });
});
