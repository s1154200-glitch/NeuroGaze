/* ============================================================
   Face landmark tracking, gaze offset correction, boundary
   monitoring, and accuracy recheck logic.

   Reusable by any page that needs real-time face-position-
   corrected gaze data from WebGazer's TFFaceMesh tracker.
   ============================================================ */
'use strict';

window.CalApp = window.CalApp || {};

// ── Core face landmark helpers ────────────────────────────────────────────

/** Get 3-D face landmark positions from WebGazer's TFFaceMesh tracker. */
CalApp.getFaceLandmarks = function () {
  try {
    if (typeof webgazer === 'undefined') return null;
    var tracker = webgazer.getTracker();
    if (tracker && typeof tracker.getPositions === 'function') {
      var positions = tracker.getPositions();
      if (positions && positions.length >= 468) return positions;
    }
    return null;
  } catch (e) { return null; }
};

/** Compute a face-state summary from 468 MediaPipe face-mesh landmarks. */
CalApp.computeFaceState = function (landmarks) {
  if (!landmarks || landmarks.length < 468) return null;
  var nose    = landmarks[1];
  var leInner = landmarks[133], leOuter = landmarks[33];
  var reInner = landmarks[362], reOuter = landmarks[263];
  var leCenter = [
    (leInner[0] + leOuter[0]) / 2,
    (leInner[1] + leOuter[1]) / 2,
  ];
  var reCenter = [
    (reInner[0] + reOuter[0]) / 2,
    (reInner[1] + reOuter[1]) / 2,
  ];
  var ipd = Math.sqrt(
    (reCenter[0] - leCenter[0]) * (reCenter[0] - leCenter[0]) +
    (reCenter[1] - leCenter[1]) * (reCenter[1] - leCenter[1])
  );
  // Face bounding box from key face-oval landmarks
  var anchors = [10, 338, 297, 332, 284, 251, 389, 356, 454,
                 323, 361, 288, 397, 365, 379, 378, 400, 377,
                 152, 148, 176, 149, 150, 136, 172, 58, 132,
                 93, 234, 127, 162, 21, 54, 103, 67, 109];
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (var i = 0; i < anchors.length; i++) {
    var lm = landmarks[anchors[i]];
    if (lm[0] < minX) minX = lm[0];
    if (lm[0] > maxX) maxX = lm[0];
    if (lm[1] < minY) minY = lm[1];
    if (lm[1] > maxY) maxY = lm[1];
  }
  // Average z-depth from nose-area landmarks
  var depthLM  = [1, 2, 98, 327, 4];
  var depthSum = 0;
  for (var j = 0; j < depthLM.length; j++) {
    depthSum += (landmarks[depthLM[j]][2] || 0);
  }
  return {
    noseTipX: nose[0], noseTipY: nose[1], noseTipZ: nose[2] || 0,
    ipd:      ipd,
    faceBoxX: minX,    faceBoxY: minY,
    faceBoxW: maxX - minX,       faceBoxH: maxY - minY,
    avgDepth: depthSum / depthLM.length,
  };
};

/**
 * Capture a stable reference face state by averaging ~20 samples
 * collected over ~1 second, then invoke callback(avgState | null).
 */
CalApp.captureFaceReference = function (callback) {
  var samples = [], attempts = 0;
  var iv = setInterval(function () {
    attempts++;
    var faceState = CalApp.computeFaceState(CalApp.getFaceLandmarks());
    if (faceState) samples.push(faceState);
    if (samples.length >= 20 || attempts >= 40) {
      clearInterval(iv);
      if (samples.length === 0) { callback(null); return; }
      var avg = { noseTipX: 0, noseTipY: 0, noseTipZ: 0,
                  ipd: 0, faceBoxX: 0, faceBoxY: 0,
                  faceBoxW: 0, faceBoxH: 0, avgDepth: 0 };
      for (var i = 0; i < samples.length; i++) {
        avg.noseTipX += samples[i].noseTipX;
        avg.noseTipY += samples[i].noseTipY;
        avg.noseTipZ += samples[i].noseTipZ;
        avg.ipd      += samples[i].ipd;
        avg.faceBoxX += samples[i].faceBoxX;
        avg.faceBoxY += samples[i].faceBoxY;
        avg.faceBoxW += samples[i].faceBoxW;
        avg.faceBoxH += samples[i].faceBoxH;
        avg.avgDepth += samples[i].avgDepth;
      }
      var n = samples.length;
      avg.noseTipX /= n; avg.noseTipY /= n; avg.noseTipZ /= n;
      avg.ipd      /= n; avg.faceBoxX /= n; avg.faceBoxY /= n;
      avg.faceBoxW /= n; avg.faceBoxH /= n; avg.avgDepth /= n;
      callback(avg);
    }
  }, 50);
};

// ── Real-time gaze correction ─────────────────────────────────────────────

/**
 * Apply real-time gaze correction based on face position and depth offset
 * relative to the reference state captured at calibration time.
 * Returns { x, y } in screen pixel coordinates.
 */
CalApp.computeGazeCorrection = function (rawX, rawY) {
  var s = CalApp.state;
  if (!s.faceReference || !s.offsetCorrectionEnabled) return { x: rawX, y: rawY };
  var lm        = CalApp.getFaceLandmarks();
  var faceState = CalApp.computeFaceState(lm);
  if (!faceState) return { x: rawX, y: rawY };
  s.currentFaceState = faceState;

  var ref    = s.faceReference;
  var dNoseX = faceState.noseTipX - ref.noseTipX;
  var dNoseY = faceState.noseTipY - ref.noseTipY;

  var videoEl = document.getElementById('webgazerVideoFeed');
  var videoW  = (videoEl && videoEl.videoWidth)  ? videoEl.videoWidth  : 640;
  var videoH  = (videoEl && videoEl.videoHeight) ? videoEl.videoHeight : 480;
  var scaleX  = window.innerWidth  / videoW;
  var scaleY  = window.innerHeight / videoH;

  // Webcam is mirrored: head moves right → image moves left
  var posCorrectX = -dNoseX * scaleX * 1.5;
  var posCorrectY = -dNoseY * scaleY * 1.5;

  // Depth correction via inter-pupillary distance ratio
  var depthRatio  = ref.ipd / Math.max(faceState.ipd, 0.1);
  var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  var depthCorrectX = (rawX - cx) * (depthRatio - 1) * 0.5;
  var depthCorrectY = (rawY - cy) * (depthRatio - 1) * 0.5;

  // 3-D z-coordinate depth fine-tuning
  var zDelta    = faceState.noseTipZ - ref.noseTipZ;
  var zCorrectX = (rawX - cx) * zDelta * 0.002;
  var zCorrectY = (rawY - cy) * zDelta * 0.002;

  return {
    x: rawX + posCorrectX + depthCorrectX + zCorrectX,
    y: rawY + posCorrectY + depthCorrectY + zCorrectY,
  };
};

// ── Face boundary monitoring ──────────────────────────────────────────────

/** Check face deviation from reference; returns 'ok' | 'warning' | 'danger'. */
CalApp.checkFaceBoundary = function () {
  var s = CalApp.state;
  if (!s.faceReference || !s.currentFaceState) return 'ok';
  var fs = s.currentFaceState, r = s.faceReference;
  var posDeviation = Math.sqrt(
    Math.pow((fs.noseTipX - r.noseTipX) / Math.max(r.faceBoxW, 1), 2) +
    Math.pow((fs.noseTipY - r.noseTipY) / Math.max(r.faceBoxH, 1), 2)
  );
  var depthDeviation = Math.abs(fs.ipd - r.ipd) / Math.max(r.ipd, 1);
  var total = posDeviation + depthDeviation;
  if (total > 0.5)  return 'danger';
  if (total > 0.25) return 'warning';
  return 'ok';
};

/** Update the boundary-box overlay and face-info badge to reflect status. */
CalApp.updateBoundaryUI = function (status) {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  s.boundaryStatus = status;

  // Position the boundary box at the calibration-time face location within
  // the camera preview. Landmarks are in raw (unmirrored) video pixel space;
  // the displayed video is CSS-mirrored, so x-coords are flipped:
  //   screen_x = rect.right − landmark_x * scaleX
  var videoEl = document.getElementById('webgazerVideoFeed');
  if (videoEl && dom.faceBoundaryBox && s.faceReference &&
      s.faceReference.faceBoxX !== undefined) {
    var rect    = videoEl.getBoundingClientRect();
    var videoW  = videoEl.videoWidth  || 640;
    var videoH  = videoEl.videoHeight || 480;
    var scaleX  = rect.width  / videoW;
    var scaleY  = rect.height / videoH;
    var scrLeft   = rect.right - (s.faceReference.faceBoxX + s.faceReference.faceBoxW) * scaleX;
    var scrTop    = rect.top   +  s.faceReference.faceBoxY * scaleY;
    var scrWidth  = s.faceReference.faceBoxW * scaleX;
    var scrHeight = s.faceReference.faceBoxH * scaleY;
    dom.faceBoundaryBox.style.left   = (scrLeft   - 4) + 'px';
    dom.faceBoundaryBox.style.top    = (scrTop    - 4) + 'px';
    dom.faceBoundaryBox.style.width  = (scrWidth  + 8) + 'px';
    dom.faceBoundaryBox.style.height = (scrHeight + 8) + 'px';
    dom.faceBoundaryBox.classList.remove('warning', 'danger');
    if (status === 'warning') dom.faceBoundaryBox.classList.add('warning');
    if (status === 'danger')  dom.faceBoundaryBox.classList.add('danger');
  }

  // Update face-info badge
  if (s.faceReference && s.currentFaceState) {
    var posOff = Math.sqrt(
      Math.pow(s.currentFaceState.noseTipX - s.faceReference.noseTipX, 2) +
      Math.pow(s.currentFaceState.noseTipY - s.faceReference.noseTipY, 2)
    );
    var depthPct = ((s.currentFaceState.ipd / Math.max(s.faceReference.ipd, 0.1)) * 100).toFixed(0);
    dom.fiOffset.textContent = posOff.toFixed(1) + 'px';
    dom.fiDepth.textContent  = depthPct + '%';
    dom.fiOffset.className   = 'fi-val ' + status;
    dom.fiDepth.className    = 'fi-val ' + status;
    dom.fiStatus.textContent = status === 'ok' ? 'OK'
                             : status === 'warning' ? 'Shifted' : 'Out of Range';
    dom.fiStatus.className   = 'fi-val ' + status;
  }

  // Warning banner
  if (!s.rangeCheckEnabled) {
    dom.positionWarning.classList.remove('visible', 'level-warning');
    s.dangerStartTime = 0;
  } else if (status === 'warning') {
    dom.positionWarningText.textContent = '\u26A0 Head position shifted \u2014 move back for better accuracy';
    dom.positionWarning.classList.add('visible', 'level-warning');
    s.dangerStartTime = 0;
  } else if (status === 'danger') {
    dom.positionWarningText.textContent = '\u26D4 Head too far from calibration position \u2014 accuracy affected';
    dom.positionWarning.classList.add('visible');
    dom.positionWarning.classList.remove('level-warning');
    if (s.dangerStartTime === 0) {
      s.dangerStartTime = Date.now();
    } else if (Date.now() - s.dangerStartTime > CalApp.DANGER_TRIGGER_MS && !s.isRechecking) {
      CalApp.triggerAccuracyRecheck();
    }
  } else {
    dom.positionWarning.classList.remove('visible', 'level-warning');
    s.dangerStartTime = 0;
  }
};

/** Start polling face boundary deviation (call when gaze demo begins). */
CalApp.startFaceMonitoring = function () {
  CalApp.stopFaceMonitoring();
  var s   = CalApp.state;
  var dom = CalApp.dom;
  dom.faceBoundaryBox.classList.add('visible');
  dom.faceInfoBadge.classList.add('visible');
  s.faceMonitorTimer = setInterval(function () {
    if (s.isPaused || s.isRechecking) return;
    var faceState = CalApp.computeFaceState(CalApp.getFaceLandmarks());
    if (faceState) {
      s.currentFaceState = faceState;
      CalApp.updateBoundaryUI(CalApp.checkFaceBoundary());
    }
  }, 200);
};

CalApp.stopFaceMonitoring = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  if (s.faceMonitorTimer) { clearInterval(s.faceMonitorTimer); s.faceMonitorTimer = null; }
  dom.faceBoundaryBox.classList.remove('visible', 'warning', 'danger');
  dom.faceInfoBadge.classList.remove('visible');
  dom.positionWarning.classList.remove('visible', 'level-warning');
  s.dangerStartTime = 0;
};

// ── Accuracy recheck ──────────────────────────────────────────────────────

/** Show the recalibration overlay prompting the user to look at the centre. */
CalApp.triggerAccuracyRecheck = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  if (s.isRechecking) return;
  s.isRechecking    = true;
  s.dangerStartTime = 0;
  dom.recalibrateTitle.textContent    = 'Accuracy Check Required';
  dom.recalibrateMsg.textContent      = 'Your face has moved significantly from the calibration position. Look at the center dot to verify accuracy.';
  dom.recalibrateAccuracy.style.display = 'none';
  dom.recheckBtn.textContent  = 'Look at Center \u0026 Recheck';
  dom.recheckBtn.style.display = '';
  dom.recalibrateOvl.classList.add('active');
};

/** Show a gold dot at centre for 3 s and collect gaze samples. */
CalApp.performAccuracyRecheck = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  dom.recalibrateOvl.classList.remove('active');

  s.recheckDotEl = document.createElement('div');
  s.recheckDotEl.className = 'recheck-dot';
  document.body.appendChild(s.recheckDotEl);
  requestAnimationFrame(function () { s.recheckDotEl.classList.add('visible'); });

  s.recheckSamples = [];
  webgazer.setGazeListener(function (data) {
    if (!data) return;
    s.latestGaze = { x: data.x, y: data.y };
    if (Array.isArray(s.recheckSamples)) s.recheckSamples.push({ x: data.x, y: data.y });
    var corrected = CalApp.computeGazeCorrection(data.x, data.y);
    dom.gazeDot.style.left = corrected.x + 'px';
    dom.gazeDot.style.top  = corrected.y + 'px';
  });

  var remaining = 3;
  (function tick() {
    dom.positionWarningText.textContent =
      'Look at the gold dot \u2014 measuring accuracy\u2026 ' + remaining + 's';
    dom.positionWarning.classList.add('visible', 'level-warning');
    remaining--;
    if (remaining < 0) {
      dom.positionWarning.classList.remove('visible', 'level-warning');
      if (s.recheckDotEl) { s.recheckDotEl.remove(); s.recheckDotEl = null; }
      CalApp.evaluateRecheck();
      return;
    }
    setTimeout(tick, 1000);
  })();
};

/** Evaluate recheck samples and either resume or force full recalibration. */
CalApp.evaluateRecheck = function () {
  var s   = CalApp.state;
  var dom = CalApp.dom;
  var cx  = window.innerWidth  / 2;
  var cy  = window.innerHeight / 2;

  var samples = s.recheckSamples || [];
  s.recheckSamples = null;
  if (samples.length > 10) samples = samples.slice(Math.floor(samples.length * 0.4));

  if (samples.length === 0) {
    s.isRechecking = false;
    CalApp.startGazeDemo();
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

  if (acc >= 80) {
    // Accuracy still OK — refresh face reference and resume demo
    CalApp.captureFaceReference(function (ref) { if (ref) s.faceReference = ref; });
    s.isRechecking = false;
    dom.statAcc.textContent = acc.toFixed(1) + '%';
    CalApp.startGazeDemo();
  } else {
    // Accuracy below 80 % — force full recalibration
    dom.recalibrateTitle.textContent    = 'Recalibration Required';
    dom.recalibrateMsg.textContent      = 'Accuracy has dropped to ' + acc.toFixed(1) +
      '%, below the 80% threshold. A full recalibration is needed.';
    dom.recalibrateAccuracy.textContent = acc.toFixed(1) + '%';
    dom.recalibrateAccuracy.style.display = '';
    dom.recheckBtn.style.display = 'none';
    dom.recalibrateOvl.classList.add('active');
  }
};
