/* ============================================================
   Gaze dot, trail canvas, and live gaze demo.
   Depends on: state.js, face-tracking.js
   ============================================================ */
'use strict';

window.CalApp = window.CalApp || {};

// ── Trail canvas ──────────────────────────────────────────────────────────

/** Resize the trail canvas to fill the viewport. */
CalApp.resizeTrailCanvas = function () {
  var dom = CalApp.dom;
  dom.trailCanvas.width  = window.innerWidth;
  dom.trailCanvas.height = window.innerHeight;
};

/** Redraw the gaze trail from the current trailPts array. */
CalApp.drawTrail = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  dom.trailCtx.clearRect(0, 0, dom.trailCanvas.width, dom.trailCanvas.height);
  if (s.trailPts.length < 2) return;
  for (var i = 1; i < s.trailPts.length; i++) {
    var a     = s.trailPts[i - 1], b = s.trailPts[i];
    var alpha = i / s.trailPts.length;
    dom.trailCtx.beginPath();
    dom.trailCtx.moveTo(a.x, a.y);
    dom.trailCtx.lineTo(b.x, b.y);
    dom.trailCtx.strokeStyle = 'rgba(0, 190, 255, ' + (alpha * 0.42).toFixed(3) + ')';
    dom.trailCtx.lineWidth   = 2.2;
    dom.trailCtx.stroke();
  }
};

// ── Gaze demo ─────────────────────────────────────────────────────────────

/**
 * Start the live gaze tracking demo.
 * Shows the gaze dot + trail, camera preview, and face monitoring.
 */
CalApp.startGazeDemo = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  if (typeof webgazer === 'undefined') return;
  if (typeof webgazer.resume === 'function') webgazer.resume();

  // Show gaze dot and trail canvas, sync toggle button state
  s.gazeDotVisible = true;
  SettingsPanel.setState('gaze-dot', true);
  dom.gazeDot.classList.add('visible');
  dom.trailCanvas.classList.add('visible');

  // Show camera preview, sync toggle button state
  s.cameraVisible = true;
  SettingsPanel.setState('camera', true);
  var videoContainer  = document.getElementById('webgazerVideoContainer');
  var faceOverlay     = document.getElementById('webgazerFaceOverlay');
  var faceFeedbackBox = document.getElementById('webgazerFaceFeedbackBox');
  if (videoContainer)  videoContainer.classList.remove('hidden');
  if (faceOverlay)     faceOverlay.classList.remove('hidden');
  if (faceFeedbackBox) faceFeedbackBox.classList.remove('hidden');

  // Start face boundary monitoring
  CalApp.startFaceMonitoring();

  // Show gear settings button
  SettingsPanel.show();

  webgazer.setGazeListener(function (data) {
    if (!data || s.isPaused) return;
    s.latestGaze = { x: data.x, y: data.y };

    // Apply real-time gaze correction from 3-D facial landmarks
    var corrected = CalApp.computeGazeCorrection(data.x, data.y);
    dom.gazeDot.style.left = corrected.x + 'px';
    dom.gazeDot.style.top  = corrected.y + 'px';

    if (!s.gazeDotVisible) return;
    s.trailPts.push({ x: corrected.x, y: corrected.y });
    if (s.trailPts.length > 60) s.trailPts.shift();
    CalApp.drawTrail();
  });

  // Stop mouse events feeding into the regression model now that calibration is done
  if (typeof webgazer.removeMouseEventListeners === 'function') {
    webgazer.removeMouseEventListeners();
  }
};

/** Pause WebGazer and clear the gaze listener. */
CalApp.stopGazeDemo = function () {
  if (typeof webgazer === 'undefined') return;
  try {
    if (typeof webgazer.clearGazeListener === 'function') {
      webgazer.clearGazeListener();
    } else {
      webgazer.setGazeListener(null);
    }
  } catch (_) {}
  if (typeof webgazer.pause === 'function') webgazer.pause();
};
