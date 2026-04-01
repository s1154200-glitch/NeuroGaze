/* ============================================================
   DOM wiring, screen/overlay helpers, UI controls, and event
   listeners for calibration.html.

   Must be loaded last (after state.js, webgazer-init.js,
   face-tracking.js, calibration.js, gaze-demo.js).
   ============================================================ */
'use strict';

window.CalApp = window.CalApp || {};

// ── Screen helpers ────────────────────────────────────────────────────────

CalApp.showScreen = function (name) {
  var dom = CalApp.dom;
  Object.values(dom.screens).forEach(function (s) { s.classList.remove('active'); });
  dom.screens[name].classList.add('active');
  var navPanel = document.getElementById('cal-nav-panel');
  if (navPanel) navPanel.style.display = name === 'success' ? 'flex' : 'none';
};

CalApp.showLoading = function () { CalApp.dom.loadingOvl.classList.add('active'); };
CalApp.hideLoading = function () { CalApp.dom.loadingOvl.classList.remove('active'); };

CalApp.showError = function (title, msg) {
  CalApp.hideLoading();
  var dom = CalApp.dom;
  dom.errorTitle.textContent = title;
  dom.errorMsg.textContent   = msg;
  dom.errorOvl.classList.add('active');
};
CalApp.hideError = function () { CalApp.dom.errorOvl.classList.remove('active'); };

// ── Controls ──────────────────────────────────────────────────────────────

CalApp.togglePause = function () {
  var s   = CalApp.state;
  s.isPaused = !s.isPaused;
  var pauseEl = SettingsPanel.getButtonEl('pause');
  if (s.isPaused) {
    if (typeof webgazer !== 'undefined' && typeof webgazer.pause === 'function') webgazer.pause();
    if (pauseEl) pauseEl.textContent = '\u25B6 Resume Tracking';
  } else {
    if (typeof webgazer !== 'undefined' && typeof webgazer.resume === 'function') webgazer.resume();
    if (pauseEl) pauseEl.textContent = '\u23F8 Pause Tracking';
  }
};

CalApp.toggleGazeDot = function (on) {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  if (typeof on === 'boolean') s.gazeDotVisible = on; else s.gazeDotVisible = !s.gazeDotVisible;
  dom.gazeDot.classList.toggle('visible', s.gazeDotVisible);
  SettingsPanel.setState('gaze-dot', s.gazeDotVisible);
  if (!s.gazeDotVisible) {
    s.trailPts = [];
    dom.trailCtx.clearRect(0, 0, dom.trailCanvas.width, dom.trailCanvas.height);
  }
};

CalApp.toggleCamera = function (on) {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  if (typeof on === 'boolean') s.cameraVisible = on; else s.cameraVisible = !s.cameraVisible;
  var videoContainer  = document.getElementById('webgazerVideoContainer');
  var faceOverlay     = document.getElementById('webgazerFaceOverlay');
  var faceFeedbackBox = document.getElementById('webgazerFaceFeedbackBox');
  [videoContainer, faceOverlay, faceFeedbackBox].forEach(function (el) {
    if (el) el.classList.toggle('hidden', !s.cameraVisible);
  });
  dom.faceBoundaryBox.classList.toggle('visible', s.cameraVisible);
  SettingsPanel.setState('camera', s.cameraVisible);
};

CalApp.toggleOffset = function (on) {
  var s = CalApp.state;
  if (typeof on === 'boolean') s.offsetCorrectionEnabled = on; else s.offsetCorrectionEnabled = !s.offsetCorrectionEnabled;
  SettingsPanel.setState('offset', s.offsetCorrectionEnabled);
};

CalApp.toggleRange = function (on) {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  if (typeof on === 'boolean') s.rangeCheckEnabled = on; else s.rangeCheckEnabled = !s.rangeCheckEnabled;
  SettingsPanel.setState('range', s.rangeCheckEnabled);
  if (!s.rangeCheckEnabled) {
    dom.positionWarning.classList.remove('visible', 'level-warning');
    s.dangerStartTime = 0;
  }
};

CalApp.toggleFacePos = function (on) {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  if (typeof on === 'boolean') s.facePosVisible = on; else s.facePosVisible = !s.facePosVisible;
  SettingsPanel.setState('face-pos', s.facePosVisible);
  dom.faceInfoBadge.style.display   = s.facePosVisible ? '' : 'none';
  dom.faceBoundaryBox.style.display = s.facePosVisible ? '' : 'none';
  if (!s.facePosVisible) {
    dom.positionWarning.classList.remove('visible', 'level-warning');
    s.dangerStartTime = 0;
  }
};

CalApp.toggleAccData = function (on) {
  var s = CalApp.state;
  if (typeof on === 'boolean') s.accDataVisible = on; else s.accDataVisible = !s.accDataVisible;
  SettingsPanel.setState('acc-data', s.accDataVisible);
  ['stat-avg-error', 'stat-accuracy', 'stat-samples'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = s.accDataVisible ? '' : 'none';
  });
};

CalApp.restartCalibration = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;

  CalApp.stopGazeDemo();
  CalApp.stopFaceMonitoring();

  SettingsPanel.hide();

  s.faceReference    = null;
  s.currentFaceState = null;
  s.boundaryStatus   = 'ok';
  s.isRechecking     = false;
  if (s.recheckDotEl) { s.recheckDotEl.remove(); s.recheckDotEl = null; }
  dom.recalibrateOvl.classList.remove('active');
  s.isPaused = false;

  // Reset face-pos and acc-data toggles to on
  CalApp.toggleFacePos(true);
  CalApp.toggleAccData(true);

  s.trailPts       = [];
  s.accGazeSamples = null;
  if (s.accDotEl) { s.accDotEl.remove(); s.accDotEl = null; }
  dom.trailCtx.clearRect(0, 0, dom.trailCanvas.width, dom.trailCanvas.height);

  dom.statAvgErr.textContent  = '\u2014';
  dom.statAcc.textContent     = '\u2014';
  dom.statSamples.textContent = '\u2014';

  if (typeof webgazer !== 'undefined' && typeof webgazer.clearData === 'function') {
    webgazer.clearData();
  }
  // Re-enable mouse listeners so calibration clicks can train the new model
  if (typeof webgazer !== 'undefined' && typeof webgazer.addMouseEventListeners === 'function') {
    webgazer.addMouseEventListeners();
  }

  CalApp.startCalibration();
};

// ── DOM wiring & event listeners ──────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  var dom = CalApp.dom;

  // Screen elements
  dom.screens = {
    cameraCheck: document.getElementById('camera-check-screen'),
    welcome:     document.getElementById('welcome-screen'),
    calibration: document.getElementById('calibration-screen'),
    success:     document.getElementById('success-screen'),
  };

  // ── Camera check screen ─────────────────────────────────────
  CalApp._camCheckStream = null;
  var camConfirmBtn  = document.getElementById('cam-confirm-btn');
  var cameraPreview  = document.getElementById('camera-preview');
  var camErrorMsg    = document.getElementById('cam-error-msg');
  var camRetryBtn    = document.getElementById('cam-retry-btn');

  function startCameraPreview() {
    // Handle browsers/contexts where mediaDevices isn't available (non-secure origin)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraPreview.style.display = 'none';
      camErrorMsg.hidden = false;
      camConfirmBtn.disabled = true;
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(function (stream) {
        CalApp._camCheckStream = stream;
        cameraPreview.style.display = '';
        cameraPreview.srcObject = stream;
        camErrorMsg.hidden = true;
        camConfirmBtn.disabled = false;
      })
      .catch(function () {
        cameraPreview.style.display = 'none';
        camErrorMsg.hidden = false;
        camConfirmBtn.disabled = true;
      });
  }

  startCameraPreview();

  camRetryBtn.addEventListener('click', function () {
    camErrorMsg.hidden = true;
    startCameraPreview();
  });

  camConfirmBtn.addEventListener('click', function () {
    if (CalApp._camCheckStream) {
      CalApp._camCheckStream.getTracks().forEach(function (t) { t.stop(); });
      CalApp._camCheckStream = null;
    }
    cameraPreview.srcObject = null;
    CalApp.showScreen('welcome');
  });

  // Buttons & controls
  dom.startBtn        = document.getElementById('start-btn');

  // Initialize settings panel component
  SettingsPanel.init({
    panelLabel: 'Tracking settings',
    sections: [
      { type: 'buttons', items: [
          { id: 'restart', label: '&#8635; Restart Calibration', onClick: CalApp.restartCalibration },
          { id: 'pause',   label: '&#9208; Pause Tracking',     onClick: CalApp.togglePause },
      ]},
      { type: 'divider' },
      { type: 'toggle', id: 'gaze-dot',  label: 'Gaze dot',          initial: true,  onChange: function (on) { CalApp.toggleGazeDot(on); } },
      { type: 'toggle', id: 'camera',    label: 'Camera view',       initial: true,  onChange: function (on) { CalApp.toggleCamera(on); } },
      { type: 'toggle', id: 'offset',    label: 'Offset correction', initial: true,  onChange: function (on) { CalApp.toggleOffset(on); } },
      { type: 'toggle', id: 'range',     label: 'Range check',       initial: true,  onChange: function (on) { CalApp.toggleRange(on); } },
      { type: 'divider' },
      { type: 'toggle', id: 'face-pos',  label: 'Face positioning',  initial: true,  onChange: function (on) { CalApp.toggleFacePos(on); } },
      { type: 'toggle', id: 'acc-data',  label: 'Accuracy data',     initial: true,  onChange: function (on) { CalApp.toggleAccData(on); } },
    ],
  });
  dom.pauseBtn = SettingsPanel.getButtonEl('pause');

  // Calibration screen UI
  dom.progressFill  = document.getElementById('progress-fill');
  dom.progressBadge = document.getElementById('progress-badge');
  dom.instrText     = document.getElementById('instruction-text');
  dom.instrBanner   = document.querySelector('.instruction-banner');

  // Overlays
  dom.loadingOvl      = document.getElementById('loading-overlay');
  dom.errorOvl        = document.getElementById('error-overlay');
  dom.errorTitle      = document.getElementById('error-title');
  dom.errorMsg        = document.getElementById('error-message');
  dom.errorBtn        = document.getElementById('error-btn');
  dom.recalibrateOvl  = document.getElementById('recalibrate-overlay');
  dom.recalibrateTitle    = document.getElementById('recalibrate-title');
  dom.recalibrateMsg      = document.getElementById('recalibrate-message');
  dom.recalibrateAccuracy = document.getElementById('recalibrate-accuracy');
  dom.recheckBtn          = document.getElementById('recheck-btn');
  dom.forceRecalibrateBtn = document.getElementById('force-recalibrate-btn');

  // Gaze visualization
  dom.gazeDot     = document.getElementById('gaze-dot');
  dom.trailCanvas = document.getElementById('trail-canvas');
  dom.trailCtx    = dom.trailCanvas.getContext('2d');

  // Success screen stats
  dom.statAvgErr  = document.getElementById('stat-avg-error');
  dom.statAcc     = document.getElementById('stat-accuracy');
  dom.statSamples = document.getElementById('stat-samples');

  // Face position UI
  dom.positionWarning     = document.getElementById('position-warning');
  dom.positionWarningText = document.getElementById('position-warning-text');
  dom.faceBoundaryBox     = document.getElementById('face-boundary-box');
  dom.faceInfoBadge       = document.getElementById('face-info-badge');
  dom.fiOffset            = document.getElementById('fi-offset');
  dom.fiDepth             = document.getElementById('fi-depth');
  dom.fiStatus            = document.getElementById('fi-status');

  // ── Event listeners ──────────────────────────────────────────────────

  dom.startBtn.addEventListener('click', async function () {
    CalApp.showLoading();
    try {
      await CalApp.initWebGazer();
      CalApp.hideLoading();
      CalApp.startCalibration();
    } catch (err) {
      console.error('WebGazer init error:', err);
      var t = 'Initialization Failed';
      var m = (err && err.message) ? err.message : 'An unknown error occurred.';
      if (
        (err && err.name === 'NotAllowedError') ||
        m.indexOf('Permission') !== -1 || m.indexOf('denied') !== -1
      ) {
        t = 'Camera Access Denied';
        m = 'This app needs camera access for eye tracking. Allow the permission in your browser settings and try again.';
      } else if (
        (err && err.name === 'NotFoundError') ||
        m.indexOf('Requested device not found') !== -1
      ) {
        t = 'No Camera Found';
        m = 'No webcam was detected. Connect a camera and reload the page.';
      } else if (m.indexOf('not loaded') !== -1) {
        t = 'WebGazer.js Not Found';
      } else if (m.indexOf('is not a function') !== -1) {
        m += ' \u2014 likely missing MediaPipe FaceMesh assets or incompatible WebGazer build.';
      }
      CalApp.showError(t, m);
    }
  });

  dom.errorBtn.addEventListener('click', function () {
    CalApp.hideError();
    CalApp.showScreen('welcome');
  });

  dom.recheckBtn.addEventListener('click', CalApp.performAccuracyRecheck);

  dom.forceRecalibrateBtn.addEventListener('click', function () {
    dom.recalibrateOvl.classList.remove('active');
    CalApp.state.isRechecking = false;
    CalApp.restartCalibration();
  });

  window.addEventListener('resize', function () {
    CalApp.resizeTrailCanvas();
    CalApp.state.trailPts = [];
    CalApp.drawTrail();
  });

  window.addEventListener('beforeunload', function () {
    if (typeof webgazer !== 'undefined' && typeof webgazer.end === 'function') {
      webgazer.end();
    }
  });
});
