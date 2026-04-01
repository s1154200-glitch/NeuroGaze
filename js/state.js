/* ============================================================
   Shared constants and mutable state for the CalApp namespace.
   All other modules read/write via CalApp.state and CalApp.dom.
   ============================================================ */
'use strict';

window.CalApp = window.CalApp || {};

// ── Calibration constants ──────────────────────────────────────────────────
CalApp.CLICKS_PER_POINT = 5;

// 3×3 grid — centre dot (50 %,50 %) is saved for last so surrounding
// points are calibrated first, yielding a more accurate centre reading.
CalApp.POINTS = [
  { x: 8,  y: 10 }, { x: 50, y: 10 }, { x: 92, y: 10 },
  { x: 8,  y: 50 },                    { x: 92, y: 50 },
  { x: 8,  y: 90 }, { x: 50, y: 90 }, { x: 92, y: 90 },
  { x: 50, y: 50 }, // centre dot — calibrated last
];

// SVG ring geometry (dot is 54 px wide, circle r = 24)
CalApp.R    = 24;
CalApp.CIRC = +(2 * Math.PI * CalApp.R).toFixed(2); // ≈ 150.80

// 3 s of continuous "danger" deviation triggers an accuracy recheck
CalApp.DANGER_TRIGGER_MS = 3000;

// ── Mutable runtime state ──────────────────────────────────────────────────
CalApp.state = {
  dotEls:                  [],      // DOM elements for calibration dots
  dotClicks:               [],      // click counts per dot
  currentIdx:              0,       // which dot is currently active
  latestGaze:              null,    // last known gaze { x, y }
  clickSamples:            [],      // error distances recorded at each click
  trailPts:                [],      // gaze trail points (screen-absolute)
  isPaused:                false,
  gazeDotVisible:          true,
  cameraVisible:           true,
  accGazeSamples:          null,    // gaze samples during accuracy test
  accDotEl:                null,    // accuracy-test gold dot element
  faceReference:           null,    // reference face state captured after calibration
  currentFaceState:        null,    // latest face state from landmarks
  boundaryStatus:          'ok',    // 'ok' | 'warning' | 'danger'
  lastAccuracy:            100,     // latest accuracy percentage (0–100)
  faceMonitorTimer:        null,    // setInterval handle for face monitoring
  isRechecking:            false,   // currently doing an accuracy recheck?
  recheckDotEl:            null,    // recheck gold dot element
  recheckSamples:          null,    // gaze samples during recheck
  offsetCorrectionEnabled: true,    // apply face-position offset correction to gaze
  rangeCheckEnabled:       true,    // warn / recheck when face leaves calibration range
  facePosVisible:          true,    // show face-boundary-box + face-info-badge
  accDataVisible:          true,    // show accuracy stats in the HUD
  settingsPanelOpen:       false,   // settings panel visibility state
  dangerStartTime:         0,       // timestamp when "danger" status began
};

// ── DOM reference bag (populated in calibration-ui.js at DOMContentLoaded) ───────────
CalApp.dom = {};
