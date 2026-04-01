/* ============================================================
   dashboard.js — sidebar toggle, date, placeholder interactions
   ============================================================ */
'use strict';

document.addEventListener('DOMContentLoaded', function () {

  // ── Sidebar expand/collapse ─────────────────────────────────
  var sidebar   = document.getElementById('sidebar');
  var hamburger = document.getElementById('hamburger');
  hamburger.addEventListener('click', function () {
    sidebar.classList.toggle('expanded');
  });

  // ── ADHD Tests sidebar dropdown ──────────────────────────────
  var navTests      = document.getElementById('nav-tests');
  var navGroupTests = document.getElementById('nav-group-tests');
  navTests.addEventListener('click', function () {
    // Auto-expand sidebar when user opens the dropdown
    if (!sidebar.classList.contains('expanded')) {
      sidebar.classList.add('expanded');
    }
    navGroupTests.classList.toggle('open');
  });

  // ── ADHD Trains sidebar dropdown ─────────────────────────────
  var navTrains      = document.getElementById('nav-trains');
  var navGroupTrains = document.getElementById('nav-group-trains');
  navTrains.addEventListener('click', function () {
    if (!sidebar.classList.contains('expanded')) {
      sidebar.classList.add('expanded');
    }
    navGroupTrains.classList.toggle('open');
  });

  // ── Date pill ───────────────────────────────────────────────
  var datePill = document.getElementById('dash-date');
  var now = new Date();
  datePill.textContent = now.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });

  // ── Calibration status from localStorage ────────────────────
  // (The calibration page can set these keys after successful calibration.)
  var calDone     = localStorage.getItem('neurogaze_cal_done') === 'true';
  var calAccuracy = localStorage.getItem('neurogaze_cal_accuracy');
  var calTime     = localStorage.getItem('neurogaze_cal_time');

  var calStatusEl  = document.getElementById('cal-status');
  var calDot       = document.querySelector('.pill-dot');
  var calAccVal    = document.getElementById('cal-accuracy-val');
  var calLastRun   = document.getElementById('cal-last-run');
  var calStatusVal = document.getElementById('cal-status-val');
  var calBadge     = document.querySelector('.badge-action');

  if (calDone) {
    calStatusEl.textContent = 'Done';
    calDot.classList.add('ok');
    calStatusVal.textContent = 'Calibrated';
    calStatusVal.style.color = '#4cd964';
    calBadge.textContent = 'Ready';
    calBadge.style.background = 'rgba(76,217,100,0.14)';
    calBadge.style.color = '#4cd964';
    calBadge.style.borderColor = 'rgba(76,217,100,0.25)';
    if (calAccuracy) calAccVal.textContent = calAccuracy + '%';
    if (calTime) {
      var d = new Date(parseInt(calTime, 10));
      calLastRun.textContent = d.toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit'
      });
    }
  }

  // ── Test result history from localStorage ───────────────────
  var history = [];
  try {
    var raw = localStorage.getItem('neurogaze_test_history');
    if (raw) history = JSON.parse(raw);
  } catch (_) {}

  // ── OVERVIEW: 4-test ADHD probability tiles ──────────────────
  var fixHist = history.filter(function(h){ return h.name === 'Fixation Stability Test'; });
  var astHist = history.filter(function(h){ return h.name === 'Antisaccade Test'; });
  var cptHist = history.filter(function(h){ return h.name === 'CPT (Go/No-Go)'; });

  function probColor(p) { return p > 0.6 ? '#ff3b30' : p > 0.35 ? '#ff9500' : '#4cd964'; }
  function setOv(probId, prob) {
    var el = document.getElementById(probId);
    if (el) { el.textContent = Math.round(prob * 100) + '%'; el.style.color = probColor(prob); }
  }
  if (fixHist.length) { var lFix = fixHist[fixHist.length-1]; setOv('ov-fix-prob', lFix.prob); }
  if (astHist.length) { var lAst = astHist[astHist.length-1]; setOv('ov-ast-prob', lAst.prob); }
  if (cptHist.length) { var lCpt = cptHist[cptHist.length-1]; setOv('ov-cpt-prob', lCpt.prob); }

  var drResults = [];
  try { drResults = JSON.parse(localStorage.getItem('neurogaze_dr_results') || '[]'); } catch(_) {}
  if (drResults.length) {
    var lDr = drResults[drResults.length-1];
    setOv('ov-dr-prob', lDr.adhdProb > 1 ? lDr.adhdProb/100 : lDr.adhdProb);
  }

  // ── Biomarker zone markers ────────────────────────────────────
  function setZone(markerId, valId, value, maxScale, tdT, adhdT, fmt) {
    var marker = document.getElementById(markerId), valEl = document.getElementById(valId);
    if (!marker || !valEl) return;
    var col = value <= tdT ? '#4cd964' : value <= adhdT ? '#ff9500' : '#ff3b30';
    marker.style.left    = Math.min(95, Math.max(4, (value / maxScale) * 100)) + '%';
    marker.style.background = col;
    marker.style.display = '';
    valEl.textContent    = fmt(value);
    valEl.style.color    = col;
  }
  if (fixHist.length)  { var bFix = fixHist[fixHist.length-1];   setZone('bio-bcea-marker','bio-bcea-val', bFix.bcea||0,                          5,    1.5, 3.0,  function(v){ return v.toFixed(2)+'°²'; }); }
  if (astHist.length)  { var bAst = astHist[astHist.length-1];   setZone('bio-err-marker', 'bio-err-val',  bAst.errorRate||0,               100,  20,  40,   function(v){ return v.toFixed(0)+'%'; }); }
  if (cptHist.length)  { var bCpt = cptHist[cptHist.length-1];   setZone('bio-cpt-marker', 'bio-cpt-val',  bCpt.commissionRate||0,          100,  15,  30,   function(v){ return v.toFixed(0)+'%'; }); }
  if (drResults.length){ var bDr  = drResults[drResults.length-1]; setZone('bio-grl-marker','bio-grl-val',  bDr.avgGrl||0,                        1000, 400, 700,  function(v){ return Math.round(v)+' ms'; }); }

  if (history.length > 0) {
    // Timeline
    var timelineBody = document.getElementById('timeline-body');
    timelineBody.innerHTML = '';

    // Show last 6 entries, newest first
    var recent = history.slice(-6).reverse();
    recent.forEach(function (h) {
      var prob = h.prob || 0;
      var dotClass = prob < 0.35 ? 'td' : prob < 0.6 ? 'warn' : 'adhd';
      var d = h.time ? new Date(h.time) : null;
      var dateStr = d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

      var entry = document.createElement('div');
      entry.className = 'tl-entry';
      entry.innerHTML =
        '<div class="tl-dot ' + dotClass + '"></div>' +
        '<div class="tl-info">' +
          '<div class="tl-title">' + (h.name || 'Fixation Stability Test') + '</div>' +
          '<div class="tl-sub">' + dateStr + ' · BCEA ' + ((h.bcea || 0).toFixed(2)) + '°²</div>' +
        '</div>' +
        '<div class="tl-val">' + Math.round(prob * 100) + '%</div>';

      timelineBody.appendChild(entry);
    });
  }

  // ── Locked test click guard ─────────────────────────────────
  document.querySelectorAll('.test-locked').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // ── Test completion badges ────────────────────────────────────
  function markCompleted(badgeId) {
    var badge = document.getElementById(badgeId);
    if (!badge) return;
    badge.textContent = 'Completed';
    badge.className = 'test-status-badge status-completed';
  }

  // Fixation Stability, Antisaccade, CPT share neurogaze_test_history
  try {
    var testHist = JSON.parse(localStorage.getItem('neurogaze_test_history') || '[]');
    testHist.forEach(function (h) {
      if (h.name === 'Fixation Stability Test') markCompleted('badge-fixation');
      if (h.name === 'Antisaccade Test')        markCompleted('badge-antisaccade');
      if (h.name === 'CPT (Go/No-Go)')          markCompleted('badge-cpt');
    });
  } catch (_) {}

  // Distractor Recovery has its own key
  try {
    var drHist = JSON.parse(localStorage.getItem('neurogaze_dr_results') || '[]');
    if (drHist.length > 0) markCompleted('badge-distractor');
  } catch (_) {}
});
