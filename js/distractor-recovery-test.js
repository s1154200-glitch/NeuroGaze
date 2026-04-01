/* ============================================================
   distractor-recovery-test.js — Distractor Recovery Task
   Biomarkers: Gaze Reorientation Latency (GRL),
               Distractor Capture Rate,
               Total Off-Task Time
   ============================================================ */
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────

var DRT = {
  TASK_DURATION_MS:        120000,   // 2 minutes
  COUNTDOWN_S:             3,

  // Primary target (figure-8 movement around screen center)
  TARGET_RADIUS_X:         90,       // px horizontal amplitude
  TARGET_RADIUS_Y:         50,       // px vertical amplitude
  TARGET_PERIOD_MS:        9000,     // full cycle period

  // Primary focus zone: gaze must be within this radius of the moving target
  // Widened from 160px — webcam noise of ~3–5° pushes gaze outside a tight zone
  // even when the user is genuinely tracking the target.
  FOCUS_ZONE_RADIUS:       160,      // px

  // Distractor events
  DISTRACTOR_COUNT:        4,
  DISTRACTOR_DURATION_MS:  1500,     // how long each distractor stays on screen

  // Capture detection window: gaze must leave zone within this ms of distractor appearing
  CAPTURE_WINDOW_MS:       1200,

  // Recovery stability: gaze must stay IN zone for this long after distractor ends
  RECOVERY_STABLE_MS:      200,

  // Give up measuring GRL after this many ms post-distractor
  RECOVERY_TIMEOUT_MS:     6000,

  // ── Benchmark thresholds ──────────────────────────────────────
  // Widened from clinical values (500/720ms, 50/80%, 10/25%) to account for
  // webcam latency (~150ms added) and gaze noise inflating off-task estimates.
  GRL_TD_MS:     100,    // neurotypical: fast return < 700ms
  GRL_ADHD_MS:   720,   // ADHD marker: slow return > 1500ms

  CAPTURE_TD_PCT:   50,  // TD: < 60% of distractors capture gaze
  CAPTURE_ADHD_PCT: 80,  // ADHD: > 90% capture rate

  OFFTASK_TD_PCT:   10,  // TD: < 20% of total time off-task
  OFFTASK_ADHD_PCT: 25,  // ADHD: > 45% off-task time
};

// Distractor slot bases (ms into task) — give ±0–8 s jitter each
var DR_DISTRACTOR_BASES = [15000, 37000, 59000, 81000];

// Distractor fill-colors (cycled by index)
var DR_DISTRACTOR_COLORS = ['#ff3b30', '#ff9500', '#34c759', '#64d2ff'];

// ── State ─────────────────────────────────────────────────────────────────

var DR = {
  gazeData:            [],    // { x, y, t (task-relative ms), onTask }
  distractors:         [],    // completed/active event records

  taskStartTime:       0,     // wall-clock ms at task begin
  centerX:             0,     // screen center (set on start)
  centerY:             0,
  targetX:             0,     // current target position (updated by animation loop)
  targetY:             0,

  paused:              false,
  pauseStartTime:      0,

  finishTimer:         null,
  taskTimer:           null,  // setTimeout handle for 1-second clock tick
  hudTimer:            null,  // setInterval for HUD refresh
  animFrameId:         null,  // requestAnimationFrame id
  remainingSecs:       0,

  distractorSchedule:  [],    // { idx, taskT, wallClockTarget, timeoutId, hideTimeoutId, endTimeoutId, fired, ev }

  activeEvent:         null,  // measurement event currently in progress
  recoveryInZoneWall:  null,  // wall-clock when gaze re-entered zone (post-distractor)

  lastOffTaskStart:    null,  // wall-clock when gaze last left focus zone
  totalOffTaskMs:      0,

  // Blink detection state
  blinkCount:          0,
  blinkNullCount:      0,
  lastBlinkTime:       0,
  prevGazeY:           null,

  debugSettings: {
    gazeDot:          false,
    camera:           false,
    offsetCorrection: false,
    rangeCheck:       false,
    facePositioning:  false,
    accData:          false,
  },
};

// Current active gaze listener (restored after recalibration)
var DR_activeGazeListener = null;

// ── DOM ────────────────────────────────────────────────────────────────────

var Ddom = {};

function $dr(id) { return document.getElementById(id); }

function drInitDom() {
  Ddom.introScreen   = $dr('dr-intro-screen');
  Ddom.taskScreen    = $dr('dr-task-screen');
  Ddom.resultsScreen = $dr('dr-results-screen');
  Ddom.loadingOvl    = $dr('dr-loading-overlay');
  Ddom.errorOvl      = $dr('dr-error-overlay');
  Ddom.errorTitle    = $dr('dr-error-title');
  Ddom.errorMsg      = $dr('dr-error-message');
  Ddom.errorBtn      = $dr('dr-error-btn');
  Ddom.startBtn      = $dr('dr-start-btn');
  Ddom.retestBtn     = $dr('dr-retest-btn');

  Ddom.countdown     = $dr('dr-countdown');
  Ddom.countdownNum  = $dr('dr-countdown-num');
  Ddom.countdownArc  = $dr('dr-countdown-arc');
  Ddom.target        = $dr('dr-target');
  Ddom.focusRing     = $dr('dr-focus-ring');
  Ddom.distractor    = $dr('dr-distractor');
  Ddom.phaseBanner   = $dr('dr-phase-banner');
  Ddom.liveHud       = $dr('dr-live-hud');
  Ddom.timerText     = $dr('dr-hud-timer-text');
  Ddom.hudTimerArc   = $dr('dr-hud-timer-arc');
  Ddom.hudOffTask    = $dr('dr-hud-offtask');
  Ddom.hudCaptures   = $dr('dr-hud-captures');
  Ddom.hudPhase      = $dr('dr-hud-phase');
  Ddom.hudGazeStatus = $dr('dr-hud-gaze-status');
  Ddom.hudBlinks     = $dr('dr-hud-blinks');
  Ddom.gazeDot       = $dr('gaze-dot');

  // Results
  Ddom.gaugeArc      = $dr('dr-gauge-arc');
  Ddom.gaugePct      = $dr('dr-gauge-pct');
  Ddom.gaugeLabel    = $dr('dr-gauge-label');
  Ddom.gaugeNeedle   = $dr('dr-gauge-needle');
  Ddom.rcGrlBadge    = $dr('dr-rc-grl-badge');
  Ddom.rcGrlVal      = $dr('dr-rc-grl-val');
  Ddom.rcGrlBar      = $dr('dr-rc-grl-bar');
  Ddom.rcGrlDesc     = $dr('dr-rc-grl-desc');
  Ddom.rcCapBadge    = $dr('dr-rc-cap-badge');
  Ddom.rcCapVal      = $dr('dr-rc-cap-val');
  Ddom.rcCapBar      = $dr('dr-rc-cap-bar');
  Ddom.rcCapDesc     = $dr('dr-rc-cap-desc');
  Ddom.rcOtBadge     = $dr('dr-rc-ot-badge');
  Ddom.rcOtVal       = $dr('dr-rc-ot-val');
  Ddom.rcOtBar       = $dr('dr-rc-ot-bar');
  Ddom.rcOtDesc      = $dr('dr-rc-ot-desc');
  Ddom.tableBody     = $dr('dr-table-body');
  Ddom.summaryIcon   = $dr('dr-summary-icon');
  Ddom.summaryTitle  = $dr('dr-summary-title');
  Ddom.summaryBody   = $dr('dr-summary-body');

  // Wire CalApp DOM for face-tracking.js
  CalApp.dom.faceBoundaryBox     = $dr('face-boundary-box');
  CalApp.dom.faceInfoBadge       = $dr('face-info-badge');
  CalApp.dom.fiOffset            = $dr('fi-offset');
  CalApp.dom.fiDepth             = $dr('fi-depth');
  CalApp.dom.fiStatus            = $dr('fi-status');
  CalApp.dom.positionWarning     = $dr('position-warning');
  CalApp.dom.positionWarningText = $dr('position-warning-text');
  CalApp.dom.gazeDot             = $dr('gaze-dot');
  CalApp.dom.recalibrateOvl      = $dr('recalibrate-overlay');
  CalApp.dom.recalibrateTitle    = $dr('recalibrate-title');
  CalApp.dom.recalibrateMsg      = $dr('recalibrate-message');
  CalApp.dom.recalibrateAccuracy = $dr('recalibrate-accuracy');
  CalApp.dom.recheckBtn          = $dr('recheck-btn');
  CalApp.dom.statAcc             = { textContent: '' };

  // ── Pause / resume hooks ──────────────────────────────────────
  var _origTrigger = CalApp.triggerAccuracyRecheck;
  CalApp.triggerAccuracyRecheck = function () {
    drPauseTask();
    _origTrigger.call(CalApp);
  };

  CalApp.startGazeDemo = function () {
    if (typeof DR_activeGazeListener === 'function') {
      webgazer.setGazeListener(DR_activeGazeListener);
    }
    CalApp.startFaceMonitoring();
    drResumeTask();
  };

  // After recheck, apply tol80 (80th-percentile gaze distance) as the
  // primary focus zone radius, then run the default evaluateRecheck logic.
  var _originalEvalDR = CalApp.evaluateRecheck;
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
      if (tol80 > 0) DRT.FOCUS_ZONE_RADIUS = Math.max(50, Math.min(500, tol80));
    }
    _originalEvalDR.call(CalApp);
  };
}

// ── Screen helpers ─────────────────────────────────────────────────────────

function drShowScreen(name) {
  var map = { intro: Ddom.introScreen, task: Ddom.taskScreen, results: Ddom.resultsScreen };
  Object.values(map).forEach(function (s) { s.classList.remove('active'); });
  map[name].classList.add('active');
}

function drShowLoading() { Ddom.loadingOvl.classList.add('active'); }
function drHideLoading() { Ddom.loadingOvl.classList.remove('active'); }

// 'accuracy' → retry accuracy check; 'init' → back to intro
var DR_retryAction = null;

function drShowError(title, msg, retryAction) {
  drHideLoading();
  DR_retryAction = retryAction || 'intro';
  Ddom.errorTitle.textContent = title;
  Ddom.errorMsg.textContent   = msg;
  Ddom.errorOvl.classList.add('active');
}

// ── WebGazer bootstrap ─────────────────────────────────────────────────────

async function drInitWebGazer() {
  if (typeof webgazer === 'undefined') throw new Error('webgazer.js is not loaded.');
  if (webgazer.params) {
    webgazer.params.faceMeshSolutionPath = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';
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
  if (typeof webgazer.removeMouseEventListeners === 'function') webgazer.removeMouseEventListeners();
}

// ── Target movement (figure-8) ─────────────────────────────────────────────
// x = cx + Rx·cos(θ)     y = cy + Ry·sin(2θ)     θ = 2π·t / PERIOD

function drGetTargetPos(elapsedMs) {
  var theta = (elapsedMs % DRT.TARGET_PERIOD_MS) / DRT.TARGET_PERIOD_MS * 2 * Math.PI;
  return {
    x: DR.centerX + DRT.TARGET_RADIUS_X * Math.cos(theta),
    y: DR.centerY + DRT.TARGET_RADIUS_Y * Math.sin(2 * theta),
  };
}

function drAnimateTarget() {
  var elapsed = Date.now() - DR.taskStartTime;
  var pos = drGetTargetPos(elapsed);
  DR.targetX = pos.x;
  DR.targetY = pos.y;
  if (Ddom.target) {
    Ddom.target.style.left = pos.x + 'px';
    Ddom.target.style.top  = pos.y + 'px';
  }
  if (Ddom.focusRing) {
    Ddom.focusRing.style.left = pos.x + 'px';
    Ddom.focusRing.style.top  = pos.y + 'px';
  }
  if (!DR.paused) {
    DR.animFrameId = requestAnimationFrame(drAnimateTarget);
  }
}

// ── Distractor management ──────────────────────────────────────────────────

function drRandomEdgePos() {
  var W = window.innerWidth, H = window.innerHeight;
  var edge = Math.floor(Math.random() * 4);
  switch (edge) {
    case 0: return { x: 60,     y: 120 + Math.random() * (H - 240) }; // left
    case 1: return { x: W - 60, y: 120 + Math.random() * (H - 240) }; // right
    case 2: return { x: 120 + Math.random() * (W - 240), y: 60     }; // top
    case 3: return { x: 120 + Math.random() * (W - 240), y: H - 60 }; // bottom
    default: return { x: 60, y: H / 2 };
  }
}

function drShowDistractor(ev) {
  var el = Ddom.distractor;
  if (!el) return;
  el.style.left       = ev.pos.x + 'px';
  el.style.top        = ev.pos.y + 'px';
  el.style.background = ev.color;
  el.style.boxShadow  = '0 0 28px 10px ' + ev.color + '99, 0 0 60px 20px ' + ev.color + '44';
  el.style.display    = 'block';
  el.classList.remove('dr-distractor-hide');
  el.classList.add('dr-distractor-active');
  if (Ddom.phaseBanner) {
    Ddom.phaseBanner.textContent = '⚡ Distractor';
    Ddom.phaseBanner.className   = 'dr-phase-banner dr-banner-distractor visible';
  }
}

function drHideDistractor() {
  var el = Ddom.distractor;
  if (!el || el.style.display === 'none') return;
  el.classList.remove('dr-distractor-active');
  el.classList.add('dr-distractor-hide');
  setTimeout(function () {
    el.style.display = 'none';
    el.classList.remove('dr-distractor-hide');
  }, 300);
  if (Ddom.phaseBanner) {
    Ddom.phaseBanner.className   = 'dr-phase-banner';
    Ddom.phaseBanner.textContent = '';
  }
}

function drTriggerDistractor(entry) {
  entry.fired = true;
  var now = Date.now();
  var ev = {
    idx:            entry.idx,
    taskT_start:    now - DR.taskStartTime,
    wallT_start:    now,
    wallT_end:      now + DRT.DISTRACTOR_DURATION_MS,
    captured:       false,
    captureChecked: false,
    captureWallT:   null,
    recovered:      false,
    recoveryWallT:  null,
    grlMs:          null,
    cancelled:      false,
    pos:            drRandomEdgePos(),
    color:          DR_DISTRACTOR_COLORS[entry.idx % DR_DISTRACTOR_COLORS.length],
  };
  DR.activeEvent = ev;
  entry.ev = ev;
  DR.distractors.push(ev);
  DR.recoveryInZoneWall = null;

  drShowDistractor(ev);

  // Hide after distractor duration
  entry.hideTimeoutId = setTimeout(function () {
    drHideDistractor();
    // If not captured at all, close the event cleanly
    if (!ev.captured) {
      ev.captureChecked = true;
      DR.activeEvent = null;
      return;
    }
    // Give the user RECOVERY_TIMEOUT_MS to return gaze
    entry.endTimeoutId = setTimeout(function () {
      if (DR.activeEvent === ev && !ev.recovered) {
        ev.grlMs       = null;  // timed out — could not recover
        DR.activeEvent = null;
        DR.recoveryInZoneWall = null;
      }
    }, DRT.RECOVERY_TIMEOUT_MS);
  }, DRT.DISTRACTOR_DURATION_MS);
}

function drScheduleDistractors() {
  DR.distractorSchedule = DR_DISTRACTOR_BASES.map(function (base, idx) {
    var taskT  = base + Math.random() * 8000;
    var entry  = {
      idx: idx, taskT: taskT,
      wallClockTarget: DR.taskStartTime + taskT,
      timeoutId: null, hideTimeoutId: null, endTimeoutId: null,
      fired: false, ev: null,
    };
    entry.timeoutId = setTimeout(function () { drTriggerDistractor(entry); }, Math.round(taskT));
    return entry;
  });
}

// ── Pause / Resume ─────────────────────────────────────────────────────────

function drPauseTask() {
  if (!DR.taskStartTime || DR.paused) return;
  DR.paused         = true;
  DR.pauseStartTime = Date.now();

  // Halt animation frame
  if (DR.animFrameId) { cancelAnimationFrame(DR.animFrameId); DR.animFrameId = null; }

  // Clear timers
  clearInterval(DR.hudTimer);
  clearTimeout(DR.taskTimer);
  clearTimeout(DR.finishTimer);

  // Cancel pending and active distractor timers
  DR.distractorSchedule.forEach(function (entry) {
    if (!entry.fired) {
      clearTimeout(entry.timeoutId);
    }
    // If distractor is currently showing, abort it
    if (entry.fired && entry.ev && !entry.ev.recovered && !entry.ev.cancelled) {
      clearTimeout(entry.hideTimeoutId);
      clearTimeout(entry.endTimeoutId);
      if (DR.activeEvent === entry.ev) {
        entry.ev.cancelled = true;
        DR.activeEvent     = null;
        drHideDistractor();
      }
    }
  });

  // Flush open off-task window so time is not lost
  if (DR.lastOffTaskStart !== null) {
    DR.totalOffTaskMs  += Date.now() - DR.lastOffTaskStart;
    DR.lastOffTaskStart = null;
  }

  // Remove gaze listener
  try {
    if (typeof webgazer.clearGazeListener === 'function') webgazer.clearGazeListener();
    else webgazer.setGazeListener(null);
  } catch (_) {}

  if (Ddom.timerText) Ddom.timerText.textContent = '⏸';
}

function drResumeTask() {
  if (!DR.paused) return;
  var pauseDuration = Date.now() - DR.pauseStartTime;
  DR.paused          = false;
  DR.taskStartTime  += pauseDuration;

  // Shift unfired distractor wall-clock targets and reschedule
  DR.distractorSchedule.forEach(function (entry) {
    if (!entry.fired) {
      entry.wallClockTarget += pauseDuration;
      var newDelay = Math.max(0, entry.wallClockTarget - Date.now());
      entry.timeoutId = setTimeout(function () { drTriggerDistractor(entry); }, newDelay);
    }
  });

  // Reinstall gaze listener
  if (typeof DR_activeGazeListener === 'function') {
    webgazer.setGazeListener(DR_activeGazeListener);
  }

  // Restart animation, HUD, clock, and finish timer
  DR.animFrameId = requestAnimationFrame(drAnimateTarget);
  DR.hudTimer    = setInterval(drUpdateHud, 200);
  drStartClockTick();
  DR.finishTimer = setTimeout(drFinishTask, DR.remainingSecs * 1000);
}

// ── HUD ────────────────────────────────────────────────────────────────────

function drUpdateHud() {
  if (DR.paused) return;
  var offPct   = Math.min(100, Math.round(DR.totalOffTaskMs / DRT.TASK_DURATION_MS * 100));
  var captures = DR.distractors.filter(function (e) { return e.captured && !e.cancelled; }).length;
  if (Ddom.hudOffTask)  Ddom.hudOffTask.textContent  = offPct + '%';
  if (Ddom.hudCaptures) Ddom.hudCaptures.textContent = captures + '/' + DRT.DISTRACTOR_COUNT;
  if (Ddom.hudPhase)    Ddom.hudPhase.textContent    = DR.activeEvent ? '⚡ Distractor' : '🎯 Tracking';

  // Live gaze-on-target indicator — based on most recent sample
  if (Ddom.hudGazeStatus && DR.gazeData.length > 0) {
    var last = DR.gazeData[DR.gazeData.length - 1];
    if (last.onTask) {
      Ddom.hudGazeStatus.textContent = '✓ On Target';
      Ddom.hudGazeStatus.className   = 'dr-hud-metric-val dr-gaze-on';
    } else {
      Ddom.hudGazeStatus.textContent = '✗ Off Target';
      Ddom.hudGazeStatus.className   = 'dr-hud-metric-val dr-gaze-off';
    }
  }
}

var DR_FULL_DASH = 138; // stroke-dasharray of hud timer arc (r=22 → circ ≈ 138)

function drStartClockTick() {
  var totalSecs = DRT.TASK_DURATION_MS / 1000;
  (function tick() {
    if (DR.paused) return;
    var mm = Math.floor(DR.remainingSecs / 60);
    var ss = DR.remainingSecs % 60;
    if (Ddom.timerText) Ddom.timerText.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    var progress = 1 - (DR.remainingSecs / totalSecs);
    if (Ddom.hudTimerArc) {
      Ddom.hudTimerArc.style.strokeDashoffset = (DR_FULL_DASH * (1 - progress)).toFixed(2);
    }
    if (DR.remainingSecs <= 0) return;
    DR.remainingSecs--;
    DR.taskTimer = setTimeout(tick, 1000);
  })();
}

// ── Countdown ──────────────────────────────────────────────────────────────

function drRunCountdown(cb) {
  var count  = DRT.COUNTDOWN_S;
  var circum = 276.46;
  Ddom.countdown.style.display = 'flex';
  Ddom.target.style.display    = 'none';
  (function tick() {
    if (count < 1) {
      Ddom.countdown.style.display = 'none';
      cb();
      return;
    }
    Ddom.countdownNum.textContent = count;
    if (Ddom.countdownArc) {
      Ddom.countdownArc.style.strokeDashoffset =
        String((circum * (1 - count / DRT.COUNTDOWN_S)).toFixed(2));
    }
    count--;
    setTimeout(tick, 1000);
  })();
}

// ── Pre-task accuracy check ────────────────────────────────────────────────

function drStartAccuracyTest() {
  drShowScreen('task');
  Ddom.countdown.style.display  = 'none';
  Ddom.target.style.display     = 'none';
  Ddom.liveHud.style.display    = 'none';
  if (Ddom.distractor) Ddom.distractor.style.display = 'none';
  if (Ddom.phaseBanner) Ddom.phaseBanner.className   = 'dr-phase-banner';

  var card = document.createElement('div');
  card.className = 'acc-warning-card';
  card.innerHTML =
    '<div class="acc-warning-icon">🎯</div>' +
    '<h3>Accuracy Check</h3>' +
    '<p>A gold dot will appear at the centre of the screen.<br>' +
    'Stare <strong>directly at it</strong> for 3 seconds.</p>';
  Ddom.taskScreen.appendChild(card);
  requestAnimationFrame(function () { card.classList.add('visible'); });

  setTimeout(function () {
    card.style.opacity = '0';
    setTimeout(function () { card.remove(); drStartAccuracyDot(); }, 400);
  }, 2500);
}

function drStartAccuracyDot() {
  var dot = document.createElement('div');
  dot.className = 'acc-dot';
  Ddom.taskScreen.appendChild(dot);
  requestAnimationFrame(function () { dot.classList.add('visible'); });

  var banner = document.createElement('div');
  banner.className = 'acc-instr-banner';
  Ddom.taskScreen.appendChild(banner);

  var samples = [];
  DR_activeGazeListener = function (data) {
    if (!data) return;
    samples.push({ x: data.x, y: data.y });
    if (DR.debugSettings.gazeDot && Ddom.gazeDot) {
      Ddom.gazeDot.style.left = data.x + 'px';
      Ddom.gazeDot.style.top  = data.y + 'px';
    }
  };
  webgazer.setGazeListener(DR_activeGazeListener);

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
          drStartTask();
        } else {
          drShowError(
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

// ── Task start ─────────────────────────────────────────────────────────────

function drStartTask() {
  // Reset state
  DR.gazeData          = [];
  DR.distractors       = [];
  DR.activeEvent       = null;
  DR.taskStartTime     = 0;
  DR.paused            = false;
  DR.pauseStartTime    = 0;
  DR.recoveryInZoneWall = null;
  DR.lastOffTaskStart  = null;
  DR.totalOffTaskMs    = 0;
  DR.blinkCount        = 0;
  DR.blinkNullCount    = 0;
  DR.lastBlinkTime     = 0;
  DR.prevGazeY         = null;
  DR.remainingSecs     = DRT.TASK_DURATION_MS / 1000;
  DR.distractorSchedule = [];

  clearInterval(DR.hudTimer);
  clearTimeout(DR.taskTimer);
  clearTimeout(DR.finishTimer);
  if (DR.animFrameId) { cancelAnimationFrame(DR.animFrameId); DR.animFrameId = null; }

  DR.centerX = window.innerWidth  / 2;
  DR.centerY = window.innerHeight / 2;
  DR.targetX = DR.centerX;
  DR.targetY = DR.centerY;

  // Position target and focus ring at center
  if (Ddom.target) {
    Ddom.target.style.left      = DR.centerX + 'px';
    Ddom.target.style.top       = DR.centerY + 'px';
    Ddom.target.style.display   = 'none';
    Ddom.target.style.transform = 'translate(-50%, -50%)';
  }
  if (Ddom.focusRing) {
    Ddom.focusRing.style.left = DR.centerX + 'px';
    Ddom.focusRing.style.top  = DR.centerY + 'px';
  }

  drShowScreen('task');
  Ddom.liveHud.style.display   = 'none';
  Ddom.distractor.style.display = 'none';
  if (Ddom.phaseBanner) Ddom.phaseBanner.className = 'dr-phase-banner';

  drRunCountdown(function () {
    // ── Task begins ────────────────────────────────
    Ddom.target.style.display = 'flex';
    Ddom.liveHud.style.display = 'flex';
    DR.taskStartTime = Date.now();

    // Blink detection thresholds
    var DR_BLINK_NULL_THRESHOLD = 4;   // consecutive null frames = tracking loss
    var DR_BLINK_DROP_THRESHOLD = 90;  // px downward jump = eyelid artifact
    var DR_BLINK_COOLDOWN       = 600; // ms between blink events

    // Build gaze listener
    DR_activeGazeListener = function (data) {
      if (!data) {
        // Tracking lost — count consecutive null frames as a blink
        if (!DR.paused) {
          DR.blinkNullCount++;
          if (DR.blinkNullCount === DR_BLINK_NULL_THRESHOLD) {
            var nowB = Date.now();
            if (nowB - DR.lastBlinkTime > DR_BLINK_COOLDOWN) {
              DR.blinkCount++;
              DR.lastBlinkTime = nowB;
              if (Ddom.hudBlinks) Ddom.hudBlinks.textContent = DR.blinkCount;
            }
            // Freeze off-task timer — blink gap must not count as off-task time
            if (DR.lastOffTaskStart !== null) {
              DR.totalOffTaskMs += nowB - DR.lastOffTaskStart;
              DR.lastOffTaskStart = null;
            }
          }
        }
        return;
      }
      // Skip first valid frame after a tracking-loss blink (artifact position)
      if (DR.blinkNullCount >= DR_BLINK_NULL_THRESHOLD) {
        DR.blinkNullCount = 0;
        DR.prevGazeY = null;
        return;
      }
      // Detect sudden large downward jump (eyelid closing artifact)
      if (!DR.paused && DR.blinkNullCount === 0 && DR.prevGazeY !== null) {
        var dyB = data.y - DR.prevGazeY;
        if (dyB > DR_BLINK_DROP_THRESHOLD) {
          var nowB2 = Date.now();
          if (nowB2 - DR.lastBlinkTime > DR_BLINK_COOLDOWN) {
            DR.blinkCount++;
            DR.lastBlinkTime = nowB2;
            if (Ddom.hudBlinks) Ddom.hudBlinks.textContent = DR.blinkCount;
          }
          // Freeze off-task timer and discard this artifact frame
          if (DR.lastOffTaskStart !== null) {
            DR.totalOffTaskMs += nowB2 - DR.lastOffTaskStart;
            DR.lastOffTaskStart = null;
          }
          DR.prevGazeY = null;
          return;
        }
      }
      DR.blinkNullCount = 0;
      DR.prevGazeY = data.y;
      if (DR.paused) return;
      var now  = Date.now();
      var t    = now - DR.taskStartTime;
      var gx   = data.x, gy = data.y;
      var dist = Math.sqrt(
        (gx - DR.targetX) * (gx - DR.targetX) +
        (gy - DR.targetY) * (gy - DR.targetY)
      );
      var onTask = dist <= DRT.FOCUS_ZONE_RADIUS;

      DR.gazeData.push({ x: gx, y: gy, t: t, onTask: onTask });

      // ── Continuous off-task tracking ─────────────
      if (!onTask) {
        if (DR.lastOffTaskStart === null) DR.lastOffTaskStart = now;
      } else {
        if (DR.lastOffTaskStart !== null) {
          DR.totalOffTaskMs   += now - DR.lastOffTaskStart;
          DR.lastOffTaskStart  = null;
        }
      }

      // ── Distractor event state machine ───────────
      var ev = DR.activeEvent;
      if (ev && !ev.cancelled) {

        // Stage 1 — capture detection (gaze leaves zone within CAPTURE_WINDOW_MS)
        if (!ev.captured && !ev.captureChecked) {
          if (now <= ev.wallT_start + DRT.CAPTURE_WINDOW_MS) {
            if (!onTask) {
              ev.captured    = true;
              ev.captureWallT = now;
            }
          } else {
            ev.captureChecked = true; // window elapsed — not captured
          }
        }

        // Stage 2 — recovery detection (gaze returns stably after distractor ends)
        if (ev.captured && !ev.recovered && now > ev.wallT_end) {
          if (onTask) {
            if (DR.recoveryInZoneWall === null) {
              DR.recoveryInZoneWall = now;
            } else if (now - DR.recoveryInZoneWall >= DRT.RECOVERY_STABLE_MS) {
              ev.recovered      = true;
              ev.recoveryWallT  = DR.recoveryInZoneWall;
              ev.grlMs          = Math.max(0, DR.recoveryInZoneWall - ev.wallT_end);
              DR.activeEvent    = null;
              DR.recoveryInZoneWall = null;
            }
          } else {
            // Gaze left zone again — reset stable-return timer
            DR.recoveryInZoneWall = null;
          }
        }
      }

      // Debug dot
      if (DR.debugSettings.gazeDot && Ddom.gazeDot) {
        Ddom.gazeDot.style.left = gx + 'px';
        Ddom.gazeDot.style.top  = gy + 'px';
      }
    };

    webgazer.setGazeListener(DR_activeGazeListener);
    DR.hudTimer    = setInterval(drUpdateHud, 200);
    drStartClockTick();
    drAnimateTarget();
    drScheduleDistractors();
    DR.finishTimer = setTimeout(drFinishTask, DRT.TASK_DURATION_MS);
  });
}

// ── Task finish ────────────────────────────────────────────────────────────

function drFinishTask() {
  clearInterval(DR.hudTimer);
  clearTimeout(DR.taskTimer);
  if (DR.animFrameId) { cancelAnimationFrame(DR.animFrameId); DR.animFrameId = null; }

  DR.distractorSchedule.forEach(function (entry) {
    clearTimeout(entry.timeoutId);
    clearTimeout(entry.hideTimeoutId);
    clearTimeout(entry.endTimeoutId);
  });

  drHideDistractor();

  // Flush any open off-task window
  if (DR.lastOffTaskStart !== null) {
    DR.totalOffTaskMs  += Date.now() - DR.lastOffTaskStart;
    DR.lastOffTaskStart = null;
  }

  // Close any still-active event (e.g. recovery window still open)
  if (DR.activeEvent && !DR.activeEvent.cancelled) {
    if (DR.distractors.indexOf(DR.activeEvent) < 0) DR.distractors.push(DR.activeEvent);
    DR.activeEvent = null;
  }

  DR_activeGazeListener = null;
  try {
    if (typeof webgazer.clearGazeListener === 'function') webgazer.clearGazeListener();
    else webgazer.setGazeListener(null);
  } catch (_) {}

  CalApp.stopFaceMonitoring();

  drComputeResults();
}

// ── Stats helpers ──────────────────────────────────────────────────────────

function drMean(arr) {
  if (!arr.length) return 0;
  return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
}

// ── Results computation ────────────────────────────────────────────────────

function drComputeResults() {
  var allEvts      = DR.distractors.filter(function (e) { return !e.cancelled; });
  var capturedEvts = allEvts.filter(function (e) { return e.captured; });
  var recoveredEvts = capturedEvts.filter(function (e) { return e.recovered && e.grlMs !== null; });

  var totalDistr   = allEvts.length;
  var captureCount = capturedEvts.length;
  var capturePct   = totalDistr > 0 ? (captureCount / totalDistr * 100) : 0;
  var avgGrl       = recoveredEvts.length > 0
      ? drMean(recoveredEvts.map(function (e) { return e.grlMs; }))
      : null;
  var offTaskPct   = (DR.totalOffTaskMs / DRT.TASK_DURATION_MS) * 100;

  // ── ADHD Probability (GRL 50%, Capture 25%, Off-Task 25%) ────
  var grlScore = 0;
  if (avgGrl !== null) {
    if      (avgGrl <= DRT.GRL_TD_MS)   grlScore = 0;
    else if (avgGrl >= DRT.GRL_ADHD_MS) grlScore = 100;
    else grlScore = (avgGrl - DRT.GRL_TD_MS) / (DRT.GRL_ADHD_MS - DRT.GRL_TD_MS) * 100;
  }
  var capScore = 0;
  if      (capturePct <= DRT.CAPTURE_TD_PCT)   capScore = 0;
  else if (capturePct >= DRT.CAPTURE_ADHD_PCT) capScore = 100;
  else capScore = (capturePct - DRT.CAPTURE_TD_PCT) / (DRT.CAPTURE_ADHD_PCT - DRT.CAPTURE_TD_PCT) * 100;

  var otScore = 0;
  if      (offTaskPct <= DRT.OFFTASK_TD_PCT)   otScore = 0;
  else if (offTaskPct >= DRT.OFFTASK_ADHD_PCT) otScore = 100;
  else otScore = (offTaskPct - DRT.OFFTASK_TD_PCT) / (DRT.OFFTASK_ADHD_PCT - DRT.OFFTASK_TD_PCT) * 100;

  var adhdProb = Math.round(grlScore * 0.50 + capScore * 0.25 + otScore * 0.25);

  drDisplayResults({
    avgGrl: avgGrl, capturePct: capturePct, offTaskPct: offTaskPct,
    adhdProb: adhdProb, grlScore: grlScore, capScore: capScore, otScore: otScore,
    totalDistr: totalDistr, captureCount: captureCount,
    allEvts: allEvts, recoveredEvts: recoveredEvts,
  });
}

// ── Results display ────────────────────────────────────────────────────────

function drClassify(value, td, adhd, lowIsGood) {
  if (value === null || value === undefined) return 'td';
  return lowIsGood
    ? (value <= td ? 'td' : value >= adhd ? 'adhd' : 'borderline')
    : (value >= td ? 'td' : value <= adhd ? 'adhd' : 'borderline');
}

function drBadgeLabel(cls) {
  return { td: 'Neurotypical', borderline: 'Borderline', adhd: 'ADHD Indicator' }[cls];
}

function drDisplayResults(r) {
  drShowScreen('results');

  // ── Gauge ──────────────────────────────────────────────────────
  var pct = r.adhdProb;
  setTimeout(function () {
    var fill = 283 * (pct / 100);
    Ddom.gaugeArc.style.strokeDashoffset = String(283 - fill);
    Ddom.gaugeArc.style.stroke = pct < 40 ? '#4cd964' : pct < 70 ? '#ffcc00' : '#ff3b30';
    Ddom.gaugeNeedle.setAttribute('transform', 'rotate(' + (-90 + pct * 1.8) + ' 100 100)');
    Ddom.gaugePct.textContent   = pct + '%';
    Ddom.gaugeLabel.textContent = pct < 40
      ? 'Low Concern'
      : pct < 70 ? 'Moderate Concern' : 'High Concern — Consult Clinician';
    Ddom.gaugeLabel.style.color = pct < 40 ? '#4cd964' : pct < 70 ? '#ffcc00' : '#ff3b30';
  }, 120);

  // ── GRL card ───────────────────────────────────────────────────
  var grlCls = drClassify(r.avgGrl, DRT.GRL_TD_MS, DRT.GRL_ADHD_MS, true);
  Ddom.rcGrlBadge.textContent = drBadgeLabel(grlCls);
  Ddom.rcGrlBadge.className   = 'rc-badge badge-' + grlCls;
  Ddom.rcGrlVal.textContent   = r.avgGrl !== null
    ? Math.round(r.avgGrl) + ' ms avg (' + r.recoveredEvts.length + ' events)'
    : 'No captures — N/A';
  setTimeout(function () {
    var barPct = r.avgGrl !== null ? Math.min(100, r.avgGrl / DRT.GRL_ADHD_MS * 100) : 0;
    Ddom.rcGrlBar.style.width = barPct + '%';
    Ddom.rcGrlBar.className   = 'rc-bar ' + grlCls;
  }, 300);
  Ddom.rcGrlDesc.textContent = r.avgGrl !== null
    ? (grlCls === 'td'
        ? 'Fast gaze reorientation — attention recovers quickly after distraction. Consistent with intact frontoparietal control.'
        : grlCls === 'borderline'
          ? 'Mildly delayed reorientation. May indicate attentional stickiness under distraction.'
          : 'Significantly impaired reorientation. Delayed recovery is a hallmark of frontoparietal dysfunction in ADHD — "attentional stickiness".')
    : 'No distractors successfully captured gaze — GRL could not be computed.';

  // ── Capture Rate card ──────────────────────────────────────────
  var capCls = drClassify(r.capturePct, DRT.CAPTURE_TD_PCT, DRT.CAPTURE_ADHD_PCT, true);
  Ddom.rcCapBadge.textContent = drBadgeLabel(capCls);
  Ddom.rcCapBadge.className   = 'rc-badge badge-' + capCls;
  Ddom.rcCapVal.textContent   = r.capturePct.toFixed(0) + '% (' + r.captureCount + ' / ' + r.totalDistr + ')';
  setTimeout(function () {
    Ddom.rcCapBar.style.width = Math.min(100, r.capturePct) + '%';
    Ddom.rcCapBar.className   = 'rc-bar ' + capCls;
  }, 400);
  Ddom.rcCapDesc.textContent = capCls === 'td'
    ? 'Good inhibitory control — most peripheral distractors did not involuntarily capture gaze.'
    : capCls === 'borderline'
      ? 'Moderate distractor capture. Some vulnerability to novel peripheral stimuli.'
      : 'High capture rate — involuntary attentional orientation to novelty. A core marker of ADHD distractibility.';

  // ── Off-Task card ──────────────────────────────────────────────
  var otCls = drClassify(r.offTaskPct, DRT.OFFTASK_TD_PCT, DRT.OFFTASK_ADHD_PCT, true);
  Ddom.rcOtBadge.textContent = drBadgeLabel(otCls);
  Ddom.rcOtBadge.className   = 'rc-badge badge-' + otCls;
  var offSec = Math.round(DR.totalOffTaskMs / 1000);
  Ddom.rcOtVal.textContent   = r.offTaskPct.toFixed(1) + '% (' + offSec + 's of 120s)';
  setTimeout(function () {
    Ddom.rcOtBar.style.width = Math.min(100, r.offTaskPct / DRT.OFFTASK_ADHD_PCT * 80) + '%';
    Ddom.rcOtBar.className   = 'rc-bar ' + otCls;
  }, 500);
  Ddom.rcOtDesc.textContent = otCls === 'td'
    ? 'Excellent on-task time — gaze remained in the primary zone most of the task.'
    : otCls === 'borderline'
      ? 'Moderate off-task time. Attention wandered more than typical but not in the clinical range.'
      : 'Excessive off-task gaze. Unable to sustain focus on the primary target — consistent with ADHD sustained-attention deficits.';

  // ── Per-distractor table ───────────────────────────────────────
  Ddom.tableBody.innerHTML = '';
  r.allEvts.forEach(function (ev, i) {
    var tr       = document.createElement('tr');
    var capText  = ev.captured  ? '✓ Yes' : '✗ No';
    var capColor = ev.captured  ? '#ff6060' : '#4cd964';
    var grlText, grlColor;
    if (!ev.captured) {
      grlText = '—';  grlColor = '#555';
    } else if (ev.recovered && ev.grlMs !== null) {
      grlText  = Math.round(ev.grlMs) + ' ms';
      grlColor = ev.grlMs <= DRT.GRL_TD_MS ? '#4cd964'
               : ev.grlMs <= DRT.GRL_ADHD_MS ? '#ffcc00' : '#ff6060';
    } else {
      grlText = 'Timeout'; grlColor = '#ff9500';
    }
    tr.innerHTML =
      '<td style="color:#555;font-size:0.77rem;padding:9px 12px">' + (i + 1) + '</td>' +
      '<td style="color:#888;padding:9px 12px">' +
        (ev.taskT_start !== undefined ? (ev.taskT_start / 1000).toFixed(1) + 's' : '—') +
      '</td>' +
      '<td style="color:' + capColor + ';font-weight:700;padding:9px 12px">' + capText + '</td>' +
      '<td style="color:' + grlColor + ';font-weight:700;font-family:monospace;padding:9px 12px">' + grlText + '</td>';
    Ddom.tableBody.appendChild(tr);
  });
  // Pad remaining rows if fewer than 4 distractors fired
  for (var i = r.allEvts.length; i < DRT.DISTRACTOR_COUNT; i++) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td style="color:#333;font-size:0.77rem;padding:9px 12px">' + (i + 1) + '</td>' +
      '<td style="color:#333;padding:9px 12px">—</td>' +
      '<td style="color:#333;padding:9px 12px">—</td>' +
      '<td style="color:#333;padding:9px 12px">—</td>';
    Ddom.tableBody.appendChild(tr);
  }

  // ── Summary ────────────────────────────────────────────────────
  if (r.adhdProb < 35) {
    Ddom.summaryIcon.textContent  = '✅';
    Ddom.summaryTitle.textContent = 'Low ADHD Concern';
    Ddom.summaryBody.textContent  = 'Gaze reorientation and sustained attention are within neurotypical range. No significant attentional stickiness detected.';
  } else if (r.adhdProb < 65) {
    Ddom.summaryIcon.textContent  = '⚠️';
    Ddom.summaryTitle.textContent = 'Moderate Concern — Monitor';
    Ddom.summaryBody.textContent  = 'Partial attentional stickiness detected. Results are borderline. Consider repeating and comparing with other test biomarkers.';
  } else {
    Ddom.summaryIcon.textContent  = '🧠';
    Ddom.summaryTitle.textContent = 'High ADHD Concern — Consult Clinician';
    Ddom.summaryBody.textContent  = 'Significantly impaired distractor recovery. Both gaze reorientation latency and off-task time are in the ADHD range, indicating frontoparietal attention-network dysfunction. This is a screening result — consult a qualified clinician.';
  }

  // ── Persist to localStorage ────────────────────────────────────
  try {
    var rec = {
      test: 'distractor-recovery', date: new Date().toISOString(),
      adhdProb: r.adhdProb, avgGrl: r.avgGrl,
      capturePct: r.capturePct, offTaskPct: r.offTaskPct,
    };
    var hist = JSON.parse(localStorage.getItem('neurogaze_dr_results') || '[]');
    hist.push(rec);
    localStorage.setItem('neurogaze_dr_results', JSON.stringify(hist.slice(-20)));
  } catch (_) {}
}

// ── Entry point ────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', function () {
  drInitDom();

  // Settings panel
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
          DR.debugSettings.gazeDot = on;
          var el = document.getElementById('gaze-dot');
          if (el) el.classList.toggle('visible', on);
        }
      },
      { type: 'toggle', id: 'camera', label: 'Camera preview', initial: false,
        onChange: function (on) {
          DR.debugSettings.camera = on;
          var el = document.getElementById('webgazerVideoContainer');
          if (el) el.style.display = on ? '' : 'none';
          if (typeof webgazer.showFaceOverlay === 'function') webgazer.showFaceOverlay(on);
        }
      },
      { type: 'toggle', id: 'face-pos', label: 'Face positioning', initial: false,
        onChange: function (on) {
          DR.debugSettings.facePositioning = on;
          var badge = CalApp.dom.faceInfoBadge;
          var box   = CalApp.dom.faceBoundaryBox;
          if (badge) badge.style.display = on ? '' : 'none';
          if (box)   box.style.display   = on ? '' : 'none';
        }
      },
    ],
  });

  // ── Button bindings ────────────────────────────────────────────
  Ddom.startBtn.addEventListener('click', async function () {
    drShowLoading();
    try {
      await drInitWebGazer();
      drHideLoading();
      CalApp.captureFaceReference(function (ref) {
        CalApp.state.faceReference = ref;
        CalApp.startFaceMonitoring();
        if (CalApp.dom.faceInfoBadge)   CalApp.dom.faceInfoBadge.style.display   = 'none';
        if (CalApp.dom.faceBoundaryBox) CalApp.dom.faceBoundaryBox.style.display = 'none';
      });
      drStartAccuracyTest();
    } catch (err) {
      var t = 'Camera Error';
      var m = (err && err.message) ? err.message : 'Could not initialize eye tracking. Please allow camera access.';
      if ((err && err.name === 'NotAllowedError') || (m && m.indexOf('denied') !== -1)) {
        t = 'Camera Access Denied';
        m = 'Camera access is required. Please allow it in your browser settings.';
      } else if (err && err.name === 'NotFoundError') {
        t = 'No Camera Found';
        m = 'No webcam was detected. Connect a camera and reload the page.';
      }
      drShowError(t, m, 'init');
    }
  });

  Ddom.errorBtn.addEventListener('click', function () {
    Ddom.errorOvl.classList.remove('active');
    var action = DR_retryAction;
    DR_retryAction = null;
    if (action === 'accuracy') {
      drStartAccuracyTest();
    } else {
      drShowScreen('intro');
    }
  });

  Ddom.retestBtn.addEventListener('click', function () { drStartAccuracyTest(); });

  if (CalApp.dom.recheckBtn) {
    CalApp.dom.recheckBtn.addEventListener('click', CalApp.performAccuracyRecheck);
  }

  var forceBtn = $dr('dr-force-recal-btn');
  if (forceBtn) forceBtn.addEventListener('click', function () { window.location.href = 'calibration.html'; });

  var modalBtn = $dr('modal-fullrecal-btn');
  if (modalBtn) modalBtn.addEventListener('click', function () { window.location.href = 'calibration.html'; });
});
