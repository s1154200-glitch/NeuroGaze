/* ============================================================
   WebGazer initialisation.
   CalApp.initWebGazer() configures and starts WebGazer.
   Call once before beginning calibration.
   ============================================================ */
'use strict';

window.CalApp = window.CalApp || {};

/**
 * Configure and start WebGazer.
 * Throws a descriptive Error if webgazer.js is missing or the camera
 * permission is denied.
 */
CalApp.initWebGazer = async function () {
  if (typeof webgazer === 'undefined') {
    throw new Error(
      'webgazer.js is not loaded. Ensure "webgazer.js" is in the same folder as this HTML file.'
    );
  }

  // Fix MediaPipe FaceMesh assets path (load from CDN when local files are absent)
  if (webgazer.params && typeof webgazer.params === 'object') {
    webgazer.params.faceMeshSolutionPath =
      'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';
  }

  // Configuration — each call guarded for version compatibility
  if (typeof webgazer.setRegression          === 'function') webgazer.setRegression('ridge');
  if (typeof webgazer.setTracker             === 'function') webgazer.setTracker('TFFacemesh');
  if (typeof webgazer.applyKalmanFilter      === 'function') webgazer.applyKalmanFilter(true);
  if (typeof webgazer.saveDataAcrossSessions === 'function') webgazer.saveDataAcrossSessions(true);
  if (typeof webgazer.showPredictionPoints   === 'function') webgazer.showPredictionPoints(false);
  // Keep the video preview visible so the user can see their face alignment
  if (typeof webgazer.showVideoPreview       === 'function') webgazer.showVideoPreview(true);
  if (typeof webgazer.showFaceOverlay        === 'function') webgazer.showFaceOverlay(true);
  if (typeof webgazer.showFaceFeedbackBox    === 'function') webgazer.showFaceFeedbackBox(false);

  // Base gaze listener — captures latestGaze for error computation during calibration
  webgazer.setGazeListener(function (data) {
    if (!data) return;
    CalApp.state.latestGaze = { x: data.x, y: data.y };
  });

  await webgazer.begin();
};
