/* ============================================================
   Calibration dot UI, calibration flow, and accuracy test.
   Depends on: state.js, face-tracking.js
   ============================================================ */
'use strict';

window.CalApp = window.CalApp || {};

// ── Dot helpers ───────────────────────────────────────────────────────────

/** Create and inject all calibration dot buttons into the calibration screen. */
CalApp.buildDots = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;

  s.dotEls.forEach(function (el) { el.remove(); });
  s.dotEls      = [];
  s.dotClicks   = [];
  s.clickSamples = [];

  CalApp.POINTS.forEach(function (pt, i) {
    var btn = document.createElement('button');
    btn.className = 'cal-dot';
    btn.setAttribute('aria-label', 'Calibration point ' + (i + 1) + ' of 9');
    btn.style.left = pt.x + '%';
    btn.style.top  = pt.y + '%';

    btn.innerHTML =
      '<svg class="dot-svg" viewBox="0 0 54 54">' +
        '<circle class="dot-track" cx="27" cy="27" r="' + CalApp.R + '"/>' +
        '<circle class="dot-ring"  cx="27" cy="27" r="' + CalApp.R + '"' +
        ' style="stroke-dasharray:' + CalApp.CIRC + ';stroke-dashoffset:' + CalApp.CIRC + '"/>' +
      '</svg>' +
      '<div class="dot-inner"></div>' +
      '<div class="dot-label">0 / ' + CalApp.CLICKS_PER_POINT + '</div>';

    btn.addEventListener('click', (function (idx) {
      return function () { CalApp.handleDotClick(idx); };
    })(i));

    dom.screens.calibration.appendChild(btn);
    s.dotEls.push(btn);
    s.dotClicks.push(0);
  });
};

/** Make dot at idx active and hide all others. */
CalApp.activateDot = function (idx) {
  var s   = CalApp.state;
  var dom = CalApp.dom;

  s.dotEls.forEach(function (el, i) {
    el.classList.remove('visible');
    if (i === idx) {
      requestAnimationFrame(function () { el.classList.add('visible'); });
    }
  });

  dom.instrBanner.classList.remove('centered');
  dom.instrBanner.style.top    = '46px';
  dom.instrBanner.style.bottom = '';
  // Dot 2 (idx=1) is the top-center dot — hide banner to avoid blocking it
  dom.instrBanner.style.opacity = (idx === 1) ? '0' : '1';
  dom.instrText.textContent =
    'Look at red dot ' + (idx + 1) + ' of ' + CalApp.POINTS.length +
    ' \u2014 ' +
    (window.matchMedia('(pointer: coarse)').matches
      ? 'tap anywhere ' : 'click it ') +
    CalApp.CLICKS_PER_POINT + ' times. Keep your head still.';
};

/** Update the SVG progress ring and click-count label for a dot. */
CalApp.refreshDotRing = function (idx) {
  var s      = CalApp.state;
  var el     = s.dotEls[idx];
  var ring   = el.querySelector('.dot-ring');
  var lbl    = el.querySelector('.dot-label');
  var offset = CalApp.CIRC * (1 - s.dotClicks[idx] / CalApp.CLICKS_PER_POINT);
  ring.style.strokeDashoffset = offset.toFixed(2);
  lbl.textContent = s.dotClicks[idx] + ' / ' + CalApp.CLICKS_PER_POINT;
};

/** Update the top progress bar and badge. */
CalApp.refreshProgress = function (completedPts) {
  var dom = CalApp.dom;
  var pct = (completedPts / CalApp.POINTS.length) * 100;
  dom.progressFill.style.width = pct + '%';
  dom.progressFill.parentElement.setAttribute('aria-valuenow', String(completedPts));
  dom.progressBadge.textContent = completedPts + ' / ' + CalApp.POINTS.length;
};

/** Handle a click on calibration dot at idx. */
CalApp.handleDotClick = function (idx) {
  var s   = CalApp.state;
  var dom = CalApp.dom;

  if (idx !== s.currentIdx) return;
  if (s.dotClicks[idx] >= CalApp.CLICKS_PER_POINT) return;

  s.dotClicks[idx]++;
  CalApp.refreshDotRing(idx);

  // Always tell WebGazer the user was looking at the dot's actual position,
  // not wherever they physically clicked/tapped.
  var tx = CalApp.POINTS[idx].x / 100 * window.innerWidth;
  var ty = CalApp.POINTS[idx].y / 100 * window.innerHeight;
  if (typeof webgazer !== 'undefined' && typeof webgazer.recordScreenPosition === 'function') {
    webgazer.recordScreenPosition(tx, ty, 'click');
  }

  // Record prediction-error sample if gaze data is available
  if (s.latestGaze) {
    var dx = tx - s.latestGaze.x;
    var dy = ty - s.latestGaze.y;
    s.clickSamples.push(Math.sqrt(dx * dx + dy * dy));
  }

  if (s.dotClicks[idx] >= CalApp.CLICKS_PER_POINT) {
    s.dotEls[idx].classList.remove('visible');
    s.dotEls[idx].classList.add('done');
    s.currentIdx++;
    CalApp.refreshProgress(s.currentIdx);

    if (s.currentIdx >= CalApp.POINTS.length) {
      // All points done — show transition message
      dom.instrBanner.classList.add('centered');
      dom.instrBanner.style.top     = '';
      dom.instrBanner.style.bottom  = '';
      dom.instrBanner.style.opacity = '1';
      dom.instrText.textContent =
        'All points calibrated! Stare at the gold dot in the center to measure your accuracy.';
      setTimeout(function () {
        dom.instrBanner.style.opacity = '0';
        setTimeout(function () {
          dom.instrBanner.classList.remove('centered');
          CalApp.finishCalibration();
        }, 400);
      }, 2800);
    } else {
      setTimeout(function () { CalApp.activateDot(s.currentIdx); }, 420);
    }
  }
};

// ── Calibration flow ──────────────────────────────────────────────────────

/** Reset state and begin the calibration dot sequence. */
CalApp.startCalibration = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;

  s.currentIdx = 0;
  s.trailPts   = [];
  s.latestGaze = null;
  s.isPaused   = false;
  dom.pauseBtn.textContent = '\u23F8 Pause Tracking';

  CalApp.refreshProgress(0);
  CalApp.buildDots();
  CalApp.showScreen('calibration');

  dom.instrBanner.classList.remove('centered');
  dom.instrBanner.style.top     = '46px';
  dom.instrBanner.style.bottom  = '';
  dom.instrBanner.style.opacity = '1';

  // Hide gaze dot and trail canvas during calibration
  dom.gazeDot.classList.remove('visible');
  dom.trailCanvas.classList.remove('visible');
  s.trailPts = [];
  dom.trailCtx.clearRect(0, 0, dom.trailCanvas.width, dom.trailCanvas.height);

  // Hide camera preview during calibration
  var videoContainer  = document.getElementById('webgazerVideoContainer');
  var faceOverlay     = document.getElementById('webgazerFaceOverlay');
  var faceFeedbackBox = document.getElementById('webgazerFaceFeedbackBox');
  if (videoContainer)  videoContainer.classList.add('hidden');
  if (faceOverlay)     faceOverlay.classList.add('hidden');
  if (faceFeedbackBox) faceFeedbackBox.classList.add('hidden');

  if (typeof webgazer !== 'undefined' && typeof webgazer.resume === 'function') {
    webgazer.resume();
  }

  setTimeout(function () { CalApp.activateDot(0); }, 620);

  // On touch devices: tap anywhere on the calibration screen to register a click on the current dot
  if (!CalApp._tapAnywhere) {
    CalApp._tapAnywhere = function (e) {
      // Only fire on touch
      if (e.pointerType === 'mouse') return;

      // If the tap landed directly on the dot button, let the button's own click
      // listener handle it — avoid calling handleDotClick twice.
      // Training at the button's position is already correct (it sits on the dot).
      if (e.target.closest('.cal-dot')) return;

      // Tap was somewhere else on screen.
      // Prevent the browser from synthesising a 'click' event at the wrong coords —
      // WebGazer listens for 'click' on document (capture phase) and would train
      // itself at the tap position instead of the dot's position.
      e.preventDefault();

      var s = CalApp.state;
      if (s.currentIdx < CalApp.POINTS.length) {
        CalApp.handleDotClick(s.currentIdx);
      }
    };
    var calScreen = CalApp.dom.screens.calibration;
    calScreen.addEventListener('pointerdown', CalApp._tapAnywhere);
  }
};

CalApp.finishCalibration = function () {
  CalApp.startAccuracyTest();
};

// ── Accuracy test ─────────────────────────────────────────────────────────

/** Show a gold dot at centre for 3 s and measure gaze accuracy. */
CalApp.startAccuracyTest = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;

  s.dotEls.forEach(function (el) { el.remove(); });
  s.dotEls = [];
  s.accGazeSamples = [];

  // Reset banner for accuracy countdown
  dom.instrBanner.classList.remove('centered');
  dom.instrBanner.style.top     = '46px';
  dom.instrBanner.style.bottom  = '';
  dom.instrBanner.style.opacity = '1';

  // Gold dot at centre of calibration screen
  s.accDotEl = document.createElement('div');
  s.accDotEl.className = 'acc-dot';
  dom.screens.calibration.appendChild(s.accDotEl);
  requestAnimationFrame(function () { s.accDotEl.classList.add('visible'); });

  // Collect gaze samples while counting down
  webgazer.setGazeListener(function (data) {
    if (!data) return;
    s.latestGaze = { x: data.x, y: data.y };
    if (Array.isArray(s.accGazeSamples)) {
      s.accGazeSamples.push({ x: data.x, y: data.y });
    }
  });

  // Capture face reference in parallel with accuracy measurement
  CalApp.captureFaceReference(function (ref) {
    if (ref) s.faceReference = ref;
  });

  var remaining = 3;
  function tick() {
    dom.instrText.textContent =
      'Look at the gold dot \u2014 measuring accuracy\u2026 ' + remaining + 's';
    remaining--;
    if (remaining < 0) {
      s.accDotEl.classList.remove('visible');
      setTimeout(function () {
        if (s.accDotEl) { s.accDotEl.remove(); s.accDotEl = null; }
        CalApp.computeAccuracy();
        if (s.lastAccuracy < 70) {
          // Below 70 % — prompt recalibration
          dom.recalibrateTitle.textContent    = 'Low Calibration Accuracy';
          dom.recalibrateMsg.textContent      = 'Accuracy is ' + s.lastAccuracy.toFixed(1) +
            '%, below the 70% threshold. Please recalibrate for reliable tracking.';
          dom.recalibrateAccuracy.textContent = s.lastAccuracy.toFixed(1) + '%';
          dom.recalibrateAccuracy.style.display = '';
          dom.recheckBtn.style.display = 'none';
          dom.recalibrateOvl.classList.add('active');
        } else {
          localStorage.setItem('neurogaze_cal_done',     'true');
          localStorage.setItem('neurogaze_cal_accuracy', s.lastAccuracy.toFixed(1));
          localStorage.setItem('neurogaze_cal_time',     String(Date.now()));
          if (s.lastTol80 > 0) {
            localStorage.setItem('neurogaze_cal_tol80', String(s.lastTol80));
          }
          CalApp.showScreen('success');
          CalApp.resizeTrailCanvas();
          CalApp.startGazeDemo();
        }
      }, 350);
      return;
    }
    setTimeout(tick, 1000);
  }
  tick();
};

/** Compute accuracy from accumulated accGazeSamples and update HUD stats. */
CalApp.computeAccuracy = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  var cx  = window.innerWidth  / 2;
  var cy  = window.innerHeight / 2;

  var samples = s.accGazeSamples || [];
  // Discard the first 40 % of samples (model settling time)
  if (samples.length > 10) {
    samples = samples.slice(Math.floor(samples.length * 0.4));
  }
  s.accGazeSamples = null;

  if (samples.length === 0) {
    s.lastAccuracy = 0;
    dom.statAvgErr.textContent  = '\u2014';
    dom.statAcc.textContent     = '\u2014';
    dom.statSamples.textContent = '\u2014';
    return;
  }

  var avgErr = samples.reduce(function (acc, pt) {
    var dx = pt.x - cx, dy = pt.y - cy;
    return acc + Math.sqrt(dx * dx + dy * dy);
  }, 0) / samples.length;

  var maxDist = Math.sqrt(
    window.innerWidth  * window.innerWidth +
    window.innerHeight * window.innerHeight
  );
  var acc = Math.max(0, Math.min(100, 100 - (avgErr / maxDist) * 190));
  s.lastAccuracy = acc;

  // Compute 80th-percentile gaze error (tol80) — used by games as the hit radius
  var dists80 = samples.map(function (pt) {
    var dx = pt.x - cx, dy = pt.y - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }).sort(function (a, b) { return a - b; });
  s.lastTol80 = Math.round(dists80[Math.floor(dists80.length * 0.8)] || 0);

  dom.statAvgErr.textContent  = avgErr.toFixed(1) + ' px';
  dom.statAcc.textContent     = acc.toFixed(1) + '%';
  dom.statSamples.textContent = samples.length;
};
