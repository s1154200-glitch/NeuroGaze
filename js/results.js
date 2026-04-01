  'use strict';

  /* ================================================================
     ADHD RESULTS ENGINE
     Normalization + Weighted Composite + UI Rendering
     ================================================================ */

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function sigmoid(value, low, high) {
    var t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  }

  function normalizeFixation(bcea, driftPct, swj, qePct) {
    if (bcea == null) return null;
    var bceaS  = sigmoid(bcea, 3.5, 10.0);
    var driftS = sigmoid(driftPct || 0, 0, 0.75);
    var swjS   = sigmoid(swj || 0, 3, 16);
    var qeS    = sigmoid(1 - (qePct != null ? qePct : 0.85), 0.40, 0.825);
    return Math.round(Math.max(0, Math.min(100, (bceaS * 0.40 + swjS * 0.25 + driftS * 0.20 + qeS * 0.15) * 100)));
  }

  function normalizeAntisaccade(errorRate, cv, meanCor) {
    if (errorRate == null) return null;
    var errS = sigmoid(errorRate, 15, 65);
    var cvS  = sigmoid(cv != null ? cv : 30, 30, 80);
    var corS = sigmoid(meanCor != null ? meanCor : 200, 200, 700);
    return Math.round(Math.max(0, Math.min(100, (errS * 0.55 + cvS * 0.30 + corS * 0.15) * 100)));
  }

  function normalizeCPT(rtv, commissionRate, omissionRate, gazeWander, decayDelta) {
    if (rtv == null && commissionRate == null) return null;
    var comS   = sigmoid(commissionRate || 0, 5, 30);
    var rtvS   = sigmoid(rtv != null ? rtv : 80, 80, 240);
    var omiS   = sigmoid(omissionRate || 0, 2, 25);
    var gazeS  = sigmoid(gazeWander || 0, 10, 50);
    var decayS = sigmoid(decayDelta || 0, 3, 20);
    return Math.round(Math.max(0, Math.min(100, (rtvS * 0.30 + comS * 0.25 + omiS * 0.20 + gazeS * 0.15 + decayS * 0.10) * 100)));
  }

  function normalizeDistractor(avgGrl, capturePct, offTaskPct) {
    if (avgGrl == null) return null;
    var grlS = Math.max(0, Math.min(100, (avgGrl - 100) / (720 - 100) * 100));
    var capS = Math.max(0, Math.min(100, ((capturePct || 50) - 50) / (80 - 50) * 100));
    var otS  = Math.max(0, Math.min(100, ((offTaskPct || 10) - 10) / (25 - 10) * 100));
    return Math.round(Math.max(0, Math.min(100, grlS * 0.50 + capS * 0.25 + otS * 0.25)));
  }

  function computeWeightedScore(fixation, antisaccade, cpt, distractor) {
    var entries = [];
    if (antisaccade != null) entries.push({ score: antisaccade, weight: 0.35 });
    if (cpt         != null) entries.push({ score: cpt,         weight: 0.30 });
    if (distractor  != null) entries.push({ score: distractor,  weight: 0.20 });
    if (fixation    != null) entries.push({ score: fixation,    weight: 0.15 });
    if (entries.length === 0) return null;
    var totalWeight = entries.reduce(function (s, e) { return s + e.weight; }, 0);
    var weighted = entries.reduce(function (s, e) {
      return s + e.score * (e.weight / totalWeight);
    }, 0);
    return Math.round(Math.max(0, Math.min(100, weighted)));
  }

  function getLatestTestByName(name) {
    try {
      var hist = JSON.parse(localStorage.getItem('neurogaze_test_history') || '[]');
      for (var i = hist.length - 1; i >= 0; i--) {
        if (hist[i].name === name) return hist[i];
      }
    } catch (_) {}
    return null;
  }

  function getLatestDR() {
    try {
      var hist = JSON.parse(localStorage.getItem('neurogaze_dr_results') || '[]');
      if (hist.length > 0) return hist[hist.length - 1];
    } catch (_) {}
    return null;
  }

  function riskColor(score) {
    if (score < 30) return '#4cd964';
    if (score < 60) return '#ff9500';
    return '#ff3b30';
  }

  function riskLabel(score) {
    if (score < 25) return 'Low';
    if (score < 50) return 'Mild';
    if (score < 75) return 'Moderate';
    return 'High';
  }

  function renderBar(containerId, name, rawLabel, score, weightPct) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (score == null) {
      el.innerHTML =
        '<div class="res-bar-label"><span class="res-bar-name">' + name + '</span>' +
        '<span class="res-bar-detail">Weight ' + weightPct + '%</span></div>' +
        '<div class="res-bar-none">Not completed</div>';
      return;
    }
    var color = riskColor(score);
    el.innerHTML =
      '<div class="res-bar-label">' +
        '<span class="res-bar-name">' + name + ' <span class="res-bar-detail">' + rawLabel + '</span></span>' +
        '<span class="res-bar-score" style="color:' + color + '">' + score + ' — ' + riskLabel(score) + '</span>' +
      '</div>' +
      '<div class="res-bar-track"><div class="res-bar-fill" style="width:0%;background:' + color + '"></div></div>' +
      '<div class="res-bar-weight">Weight: ' + weightPct + '%</div>';
    setTimeout(function () {
      var fill = el.querySelector('.res-bar-fill');
      if (fill) fill.style.width = score + '%';
    }, 80);
  }

  function animateGauge(pct) {
    var arc    = document.getElementById('res-gauge-arc');
    var needle = document.getElementById('res-gauge-needle');
    var pctEl  = document.getElementById('res-gauge-pct');
    var lblEl  = document.getElementById('res-gauge-label');
    if (!arc || !needle || !pctEl) return;

    var color = pct < 30 ? '#4cd964' : pct < 60 ? '#ff9500' : '#ff3b30';
    arc.setAttribute('stroke', color);

    var dash = 283;
    var frame = 0, frames = 60;
    (function tick() {
      frame++;
      var t = frame / frames;
      var ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      var cur = ease * pct;
      arc.setAttribute('stroke-dashoffset', dash - (cur / 100) * dash);
      needle.setAttribute('transform', 'rotate(' + (-90 + (cur / 100) * 180) + ' 100 100)');
      pctEl.textContent = Math.round(cur) + '%';
      if (frame < frames) requestAnimationFrame(tick);
    })();

    if (lblEl) {
      lblEl.textContent = pct < 25 ? 'Low Probability' : pct < 50 ? 'Mild Probability' : pct < 75 ? 'Moderate Probability' : 'High Probability';
      lblEl.style.color = color;
    }
  }

  function dominantDriver(scores) {
    var names = {
      fixation:    'baseline oculomotor instability (Fixation Stability)',
      antisaccade: 'severe inhibitory control deficits (Antisaccade)',
      cpt:         'sustained attention / response variability (CPT)',
      distractor:  'attentional stickiness / slow reorientation (Distractor Recovery)',
    };
    var best = null, bestVal = -1;
    for (var key in scores) {
      if (scores[key] != null && scores[key] > bestVal) { bestVal = scores[key]; best = key; }
    }
    return best ? names[best] : null;
  }

  /* ── Populate a test summary card ────────────────────────── */
  function populateCard(cardId, badgeId, metricsId, probId, data, metrics, probVal) {
    var card  = document.getElementById(cardId);
    var badge = document.getElementById(badgeId);
    var mEl   = document.getElementById(metricsId);
    var pEl   = document.getElementById(probId);
    if (!card) return;

    if (!data) {
      card.classList.add('res-tc-empty');
      return;
    }

    badge.textContent = 'Completed';
    badge.classList.add('completed');

    // Fill metrics
    var vals = mEl.querySelectorAll('.res-tc-val');
    for (var i = 0; i < vals.length && i < metrics.length; i++) {
      vals[i].textContent = metrics[i];
    }

    // Probability
    var pv = pEl.querySelector('.res-tc-prob-val');
    if (pv) {
      var pctNum = typeof probVal === 'number' ? probVal : 0;
      pv.textContent = Math.round(pctNum) + '%';
      pv.style.color = riskColor(pctNum);
    }
  }

  /* ── Detail-view helpers ─────────────────────────────────── */

  function dtBadgeClass(prob) {
    if (prob < 30) return 'dt-badge-td';
    if (prob < 60) return 'dt-badge-borderline';
    return 'dt-badge-adhd';
  }
  function dtBadgeText(prob) {
    if (prob < 30) return 'Typical';
    if (prob < 60) return 'Borderline';
    return 'ADHD-Range';
  }
  function dtBarClass(prob) {
    if (prob < 30) return 'td';
    if (prob < 60) return 'borderline';
    return 'adhd';
  }
  function dtHighlight(prob) {
    if (prob >= 60) return ' highlight-adhd';
    if (prob < 30) return ' highlight-td';
    return '';
  }

  function dtGaugeSVG(pct) {
    var color = riskColor(pct);
    // Semicircle arc length = π * r = π * 80 ≈ 251.33
    var arcLen = Math.PI * 80;
    var offset = arcLen * (1 - pct / 100);
    // Needle: 0% → left (180°), 50% → top (270°), 100% → right (360°)
    var angle = (180 + (pct / 100) * 180) * Math.PI / 180;
    var nx = (100 + 62 * Math.cos(angle)).toFixed(1);
    var ny = (100 + 62 * Math.sin(angle)).toFixed(1);
    return '<svg viewBox="0 0 200 120" width="240" style="overflow:visible">' +
      '<path d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="18" stroke-linecap="round"/>' +
      '<path d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke="' + color + '" stroke-width="18" stroke-linecap="round"' +
      ' stroke-dasharray="' + arcLen.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '" style="transition:stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1)"/>' +
      '<line x1="100" y1="100" x2="' + nx + '" y2="' + ny + '"' +
      ' stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity="0.9"/>' +
      '<circle cx="100" cy="100" r="5" fill="#1a1a2e"/>' +
      '<circle cx="100" cy="100" r="3.5" fill="#fff" opacity="0.9"/>' +
      '<text x="15" y="113" fill="#444" font-size="8" text-anchor="middle">0</text>' +
      '<text x="100" y="14" fill="#444" font-size="8" text-anchor="middle">50</text>' +
      '<text x="185" y="113" fill="#444" font-size="8" text-anchor="middle">100</text>' +
      '</svg>';
  }

  function dtCard(icon, title, value, valueSub, barPct, barClass, badgeClass, badgeText, threshTd, threshAdhd, desc) {
    return '<div class="dt-card' + (barPct >= 60 ? ' highlight-adhd' : barPct < 30 ? ' highlight-td' : '') + '">' +
      '<div class="dt-rc-header">' +
        '<span class="dt-rc-icon">' + icon + '</span>' +
        '<span class="dt-rc-title">' + title + '</span>' +
        '<span class="dt-rc-badge ' + badgeClass + '">' + badgeText + '</span>' +
      '</div>' +
      '<div class="dt-rc-val">' + value + (valueSub ? ' <span class="dt-rc-val-sub">' + valueSub + '</span>' : '') + '</div>' +
      '<div class="dt-bar-wrap"><div class="dt-bar ' + barClass + '" style="width:' + Math.min(100,barPct) + '%"></div></div>' +
      '<div class="dt-thresholds"><span class="dt-thresh-td">' + threshTd + '</span><span class="dt-thresh-adhd">' + threshAdhd + '</span></div>' +
      '<div class="dt-rc-desc">' + desc + '</div>' +
    '</div>';
  }

  function dtSummary(icon, title, body) {
    return '<div class="dt-summary">' +
      '<div class="dt-summary-icon">' + icon + '</div>' +
      '<div class="dt-summary-text"><h3>' + title + '</h3><p>' + body + '</p></div>' +
    '</div>';
  }

  function buildFixationDetail(d) {
    var prob = d.prob != null ? d.prob * 100 : normalizeFixation(d.bcea, d.driftPct, d.swj, d.qePct) || 0;
    var bceaPct = clamp01((d.bcea - 3.5) / (10.0 - 3.5)) * 100;
    var driftPct = d.driftPct != null ? d.driftPct * 100 : 0;
    var qePct = d.qePct != null ? d.qePct * 100 : 0;
    var swjPct = d.swj != null ? clamp01(d.swj / 8) * 100 : 0;

    var html = '<div class="dt-header"><h2>Fixation Stability Results</h2><p>Oculomotor stability during sustained fixation</p></div>';
    html += dtGaugeSection(prob);
    html += '<div class="dt-cards-grid">';
    html += dtCard('📐', 'BCEA', d.bcea != null ? d.bcea.toFixed(2) : '—', '°²', bceaPct, dtBarClass(bceaPct), dtBadgeClass(bceaPct), dtBadgeText(bceaPct), '≤ 3.5°² typical', '≥ 10.0°² ADHD-range', 'Bivariate Contour Ellipse Area — smaller values indicate tighter fixation control.');
    html += dtCard('〰️', 'Drift Fraction', driftPct.toFixed(1) + '%', '', driftPct, dtBarClass(driftPct), dtBadgeClass(driftPct), dtBadgeText(driftPct), '≤ 15% typical', '≥ 40% ADHD-range', 'Proportion of time spent in slow drifts away from fixation target.');
    html += dtCard('⚡', 'Square-Wave Jerks', d.swj != null ? d.swj : '—', 'count', swjPct, dtBarClass(swjPct), dtBadgeClass(swjPct), dtBadgeText(swjPct), '≤ 2 typical', '≥ 6 ADHD-range', 'Involuntary saccadic intrusions — elevated counts suggest frontal-oculomotor disinhibition.');
    html += dtCard('🎯', 'Quiet Eye %', qePct.toFixed(0) + '%', '', 100 - qePct, dtBarClass(100 - qePct), dtBadgeClass(100 - qePct), dtBadgeText(100 - qePct), '≥ 85% typical', '≤ 60% ADHD-range', 'Time spent within the central fixation window — lower values indicate more gaze dispersion.');
    html += '</div>';

    // Gaze scatter plot — always shown
    html += '<div class="dt-chart-section">';
    html += '<div class="dt-chart-header"><span class="dt-chart-icon">🔵</span><span class="dt-chart-title">Gaze Scatter Plot</span><span class="dt-chart-sub">Spatial distribution of gaze during fixation</span></div>';
    html += '<div class="dt-canvas-wrap"><canvas id="dt-scatter-canvas" width="560" height="280"></canvas></div>';
    html += '<div class="dt-chart-legend"><span class="dt-legend-dot dt-legend-td"></span>TD boundary (3.5°²) <span class="dt-legend-dot dt-legend-adhd" style="margin-left:16px"></span>ADHD boundary (10.0°²)</div>';
    html += '</div>';

    // Temporal stability chart — always shown
    html += '<div class="dt-chart-section">';
    html += '<div class="dt-chart-header"><span class="dt-chart-icon">📈</span><span class="dt-chart-title">Attention Stability Over Time</span><span class="dt-chart-sub">Gaze variance (BCEA) across the 30-second session</span></div>';
    html += '<div class="dt-canvas-wrap"><canvas id="dt-temporal-canvas" width="560" height="180"></canvas></div>';
    html += '</div>';

    var summIcon = prob < 30 ? '✅' : prob < 60 ? '⚠️' : '🔴';
    var summTitle = prob < 30 ? 'Stable Fixation' : prob < 60 ? 'Mildly Unstable Fixation' : 'Significantly Unstable Fixation';
    var summBody = prob < 30
      ? 'Your oculomotor fixation metrics fall within or near the neurotypical range, suggesting good sustain-fixation ability.'
      : prob < 60
        ? 'Some fixation instability detected. This may reflect subclinical attention variability or fatigue.'
        : 'Fixation metrics significantly exceed ADHD thresholds. Elevated BCEA and saccadic intrusions suggest frontal-oculomotor disinhibition.';
    html += dtSummary(summIcon, summTitle, summBody);
    return html;
  }

  function buildAntisaccadeDetail(d) {
    var prob = d.prob != null ? d.prob * 100 : normalizeAntisaccade(d.errorRate, d.cv, d.meanCor) || 0;
    var errPct = clamp01((d.errorRate - 15) / (40 - 15)) * 100;
    var latPct = d.meanLat != null ? clamp01((350 - d.meanLat) / (350 - 200)) * 100 : 0;
    var cvPct = d.cv != null ? clamp01((d.cv - 10) / (30 - 10)) * 100 : 0;
    var corPct = d.meanCor != null ? clamp01((d.meanCor - 80) / (180 - 80)) * 100 : 0;

    var html = '<div class="dt-header"><h2>Antisaccade Test Results</h2><p>Inhibitory control & error suppression</p></div>';
    html += dtGaugeSection(prob);
    html += '<div class="dt-cards-grid">';
    html += dtCard('🚫', 'Error Rate', d.errorRate != null ? d.errorRate.toFixed(1) + '%' : '—', d.totalTrials ? '(' + d.errorCount + '/' + d.totalTrials + ' trials)' : '', errPct, dtBarClass(errPct), dtBadgeClass(errPct), dtBadgeText(errPct), '≤ 15% typical', '≥ 40% ADHD-range', 'Proportion of trials where gaze moved toward the distractor instead of away.');
    html += dtCard('⏱️', 'Mean Latency', d.meanLat != null ? Math.round(d.meanLat) + 'ms' : '—', '', latPct, dtBarClass(latPct), dtBadgeClass(latPct), dtBadgeText(latPct), '≥ 350ms typical', '≤ 200ms ADHD-range', 'Average time to initiate correct antisaccade — faster may indicate impulsive responding.');
    html += dtCard('📊', 'Latency CV', d.cv != null ? d.cv.toFixed(1) + '%' : '—', '', cvPct, dtBarClass(cvPct), dtBadgeClass(cvPct), dtBadgeText(cvPct), '≤ 10% typical', '≥ 30% ADHD-range', 'Coefficient of variation in response timing — higher values indicate inconsistent inhibitory control.');
    html += dtCard('🔄', 'Mean Correction', d.meanCor != null ? Math.round(d.meanCor) + 'ms' : '—', '', corPct, dtBarClass(corPct), dtBadgeClass(corPct), dtBadgeText(corPct), '≤ 80ms typical', '≥ 180ms ADHD-range', 'Average time to correct an erroneous prosaccade — slower corrections suggest weaker error monitoring.');
    html += '</div>';

    // Latency distribution histogram — always shown
    html += '<div class="dt-chart-section">';
    html += '<div class="dt-chart-header"><span class="dt-chart-icon">📊</span><span class="dt-chart-title">Saccadic Latency Distribution</span><span class="dt-chart-sub">Response time spread' + (d.latencies && d.latencies.length ? ' across ' + d.latencies.length + ' trials' : '') + '</span></div>';
    html += '<div class="dt-canvas-wrap"><canvas id="dt-lat-hist-canvas" width="560" height="180"></canvas></div>';
    html += '<div class="dt-chart-legend"><span class="dt-legend-dot dt-legend-td"></span>Typical range (180–350ms)</div>';
    html += '</div>';

    var summIcon = prob < 30 ? '✅' : prob < 60 ? '⚠️' : '🔴';
    var summTitle = prob < 30 ? 'Good Inhibitory Control' : prob < 60 ? 'Mild Inhibitory Weakness' : 'Significant Inhibitory Deficit';
    var summBody = prob < 30
      ? 'Antisaccade performance is within the neurotypical range, indicating intact voluntary saccade suppression.'
      : prob < 60
        ? 'Some difficulty suppressing reflexive saccades detected. This may indicate mild frontal inhibitory weakness.'
        : 'High error rate and response variability suggest significant inhibitory control deficits consistent with ADHD profiles.';
    html += dtSummary(summIcon, summTitle, summBody);
    return html;
  }

  function buildCPTDetail(d) {
    var prob = d.prob != null ? d.prob * 100 : normalizeCPT(d.rtv, d.commissionRate, d.omissionRate, d.gazeWander, d.decayDelta) || 0;
    var comPct = d.commissionRate != null ? clamp01((d.commissionRate - 5) / (15 - 5)) * 100 : 0;
    var omPct = d.omissionRate != null ? clamp01((d.omissionRate - 5) / (20 - 5)) * 100 : 0;
    var rtvPct = d.rtv != null ? clamp01((d.rtv - 80) / (160 - 80)) * 100 : 0;
    var gazePct = d.gazeWander != null ? clamp01((d.gazeWander - 10) / (35 - 10)) * 100 : 0;

    var html = '<div class="dt-header"><h2>CPT (Go/No-Go) Results</h2><p>Sustained attention & impulse control</p></div>';
    html += dtGaugeSection(prob);
    html += '<div class="dt-cards-grid">';
    html += dtCard('🎯', 'Commission Rate', d.commissionRate != null ? d.commissionRate.toFixed(1) + '%' : '—', '', comPct, dtBarClass(comPct), dtBadgeClass(comPct), dtBadgeText(comPct), '≤ 5% typical', '≥ 15% ADHD-range', 'False alarms — responding to No-Go stimuli, indicating impulsive responding.');
    html += dtCard('😶', 'Omission Rate', d.omissionRate != null ? d.omissionRate.toFixed(1) + '%' : '—', '', omPct, dtBarClass(omPct), dtBadgeClass(omPct), dtBadgeText(omPct), '≤ 5% typical', '≥ 20% ADHD-range', 'Missed Go targets — failure to respond, indicating inattention lapses.');
    html += dtCard('⏱️', 'RT Variability', d.rtv != null ? d.rtv.toFixed(0) + 'ms' : '—', d.meanRt ? '(mean ' + Math.round(d.meanRt) + 'ms)' : 'σ', rtvPct, dtBarClass(rtvPct), dtBadgeClass(rtvPct), dtBadgeText(rtvPct), '≤ 80ms typical', '≥ 160ms ADHD-range', 'Standard deviation of reaction times — higher variability suggests fluctuating attention.');
    html += dtCard('👀', 'Gaze Wander', d.gazeWander != null ? d.gazeWander.toFixed(1) + '%' : '—', '', gazePct, dtBarClass(gazePct), dtBadgeClass(gazePct), dtBadgeText(gazePct), '≤ 10% typical', '≥ 35% ADHD-range', 'Proportion of trial time with gaze away from the stimulus zone.');
    html += '</div>';

    // First-half vs second-half performance split — always shown
    html += '<div class="dt-chart-section">';
    html += '<div class="dt-chart-header"><span class="dt-chart-icon">📉</span>' +
      '<span class="dt-chart-title">Performance Over Time — First vs. Second Half</span>' +
      '<span class="dt-chart-sub">Attentional decay: comparing early vs. late performance</span></div>';
    if (d.s0 && d.s1) {
      var s0 = d.s0, s1 = d.s1;
      var decayWorse = s1.omiRate > s0.omiRate + 2;
      var rtWorse = s1.avgRt !== null && s0.avgRt !== null && s1.avgRt > s0.avgRt * 1.1;
      html += '<div class="dt-halves-grid">';
      html += dtHalfCard('First Half', s0, null, false);
      html += dtHalfCard('Second Half', s1, s0, false);
      html += '</div>';
      if (decayWorse || rtWorse) {
        html += '<div class="dt-decay-note dt-decay-warning">⚠ Performance declined in the second half — omission rate ' +
          (decayWorse ? '+' + (s1.omiRate - s0.omiRate).toFixed(1) + '% higher' : 'stable') +
          (rtWorse ? (decayWorse ? ', RT ' : 'RT ') + '+' + (s1.avgRt - s0.avgRt).toFixed(0) + 'ms slower' : '') +
          '. This is consistent with attentional fatigue seen in ADHD.</div>';
      } else {
        html += '<div class="dt-decay-note dt-decay-ok">✅ Performance was consistent across both halves — no significant attentional decay detected.</div>';
      }
    } else {
      html += '<div class="dt-no-data-msg">Re-run the CPT test to see first-half vs. second-half breakdown.</div>';
    }
    html += '</div>';

    var summIcon = prob < 30 ? '✅' : prob < 60 ? '⚠️' : '🔴';
    var summTitle = prob < 30 ? 'Good Sustained Attention' : prob < 60 ? 'Mild Attention Fluctuation' : 'Significant Attention Deficit';
    var summBody = prob < 30
      ? 'CPT performance is within the neurotypical range. Sustained attention and impulse control are intact.'
      : prob < 60
        ? 'Some variability in attention and response control detected, which may reflect mild attention regulation difficulties.'
        : 'High commission/omission rates and response variability indicate significant sustained attention deficits consistent with ADHD.';
    html += dtSummary(summIcon, summTitle, summBody);
    return html;
  }

  function buildDistractorDetail(d) {
    var prob = d.adhdProb != null ? d.adhdProb : normalizeDistractor(d.avgGrl, d.capturePct, d.offTaskPct) || 0;
    var grlPct = d.avgGrl != null ? clamp01((d.avgGrl - 500) / (720 - 500)) * 100 : 0;
    var capPct = d.capturePct != null ? clamp01((d.capturePct - 10) / (50 - 10)) * 100 : 0;
    var offPct = d.offTaskPct != null ? clamp01((d.offTaskPct - 5) / (25 - 5)) * 100 : 0;

    var html = '<div class="dt-header"><h2>Distractor Recovery Results</h2><p>Gaze reorientation & attentional capture</p></div>';
    html += dtGaugeSection(prob);
    html += '<div class="dt-cards-grid">';
    html += dtCard('🔁', 'Gaze Return Latency', d.avgGrl != null ? Math.round(d.avgGrl) + 'ms' : '—', '', grlPct, dtBarClass(grlPct), dtBadgeClass(grlPct), dtBadgeText(grlPct), '≤ 500ms typical', '≥ 720ms ADHD-range', 'Average time to return gaze to the primary target after distractor onset.');
    html += dtCard('🧲', 'Capture Rate', d.capturePct != null ? d.capturePct.toFixed(0) + '%' : '—', '', capPct, dtBarClass(capPct), dtBadgeClass(capPct), dtBadgeText(capPct), '≤ 10% typical', '≥ 50% ADHD-range', 'Proportion of trials where gaze was captured by the distractor.');
    html += '<div class="dt-card dt-card-full">';
    html += '<div class="dt-rc-header"><span class="dt-rc-icon">📉</span><span class="dt-rc-title">Off-Task Gaze</span>' +
      '<span class="dt-rc-badge ' + dtBadgeClass(offPct) + '">' + dtBadgeText(offPct) + '</span></div>';
    html += '<div class="dt-rc-val">' + (d.offTaskPct != null ? d.offTaskPct.toFixed(1) + '%' : '—') + '</div>';
    html += '<div class="dt-bar-wrap"><div class="dt-bar ' + dtBarClass(offPct) + '" style="width:' + Math.min(100,offPct) + '%"></div></div>';
    html += '<div class="dt-thresholds"><span class="dt-thresh-td">≤ 5% typical</span><span class="dt-thresh-adhd">≥ 25% ADHD-range</span></div>';
    html += '<div class="dt-rc-desc">Percentage of total test time with gaze directed away from the primary task area.</div>';
    html += '</div>';
    html += '</div>';

    // Recovery timeline bar chart
    html += '<div class="dt-chart-section">';
    html += '<div class="dt-chart-header"><span class="dt-chart-icon">⏱️</span>' +
      '<span class="dt-chart-title">Recovery Profile</span>' +
      '<span class="dt-chart-sub">Relative performance across the three key metrics</span></div>';
    html += '<div class="dt-dr-profile">';
    html += dtDrProfileBar('Gaze Return Latency', d.avgGrl != null ? Math.round(d.avgGrl) + 'ms' : '—', grlPct, '500ms', '720ms');
    html += dtDrProfileBar('Capture Rate', d.capturePct != null ? d.capturePct.toFixed(0) + '%' : '—', capPct, '10%', '50%');
    html += dtDrProfileBar('Off-Task Time', d.offTaskPct != null ? d.offTaskPct.toFixed(1) + '%' : '—', offPct, '5%', '25%');
    html += '</div></div>';

    var summIcon = prob < 30 ? '✅' : prob < 60 ? '⚠️' : '🔴';
    var summTitle = prob < 30 ? 'Good Distractor Resistance' : prob < 60 ? 'Mild Attentional Capture' : 'Significant Distractor Vulnerability';
    var summBody = prob < 30
      ? 'Gaze reorientation is swift and distractor capture is low, consistent with neurotypical attentional control.'
      : prob < 60
        ? 'Moderate gaze return latency suggests some difficulty disengaging from distractors.'
        : 'Slow gaze reorientation and high capture rates indicate significant attentional stickiness consistent with ADHD profiles.';
    html += dtSummary(summIcon, summTitle, summBody);
    return html;
  }

  /* ── Shared gauge section builder ──────────────────────────── */
  function dtGaugeSection(prob) {
    return '<div class="dt-gauge-section"><div class="dt-gauge-wrap">' +
      dtGaugeSVG(prob) +
      '<div class="dt-gauge-center">' +
        '<span class="dt-gauge-pct" style="color:' + riskColor(prob) + '">' + Math.round(prob) + '%</span>' +
        '<span class="dt-gauge-label">ADHD Probability</span>' +
      '</div>' +
    '</div></div>';
  }

  /* ── CPT half-split card ────────────────────────────────────── */
  function dtHalfCard(label, s, prev, _unused) {
    var html = '<div class="dt-half-card">';
    html += '<div class="dt-half-label">' + label + '</div>';
    html += '<div class="dt-half-row"><span class="dt-half-key">Omission rate</span>';
    if (prev) {
      var diff = s.omiRate - prev.omiRate;
      var cls = Math.abs(diff) < 1.5 ? '' : diff > 0 ? ' dt-half-worse' : ' dt-half-better';
      html += '<span class="dt-half-val' + cls + '">' + s.omiRate.toFixed(1) + '%' + (Math.abs(diff) >= 1.5 ? ' (' + (diff > 0 ? '+' : '') + diff.toFixed(1) + '%)' : '') + '</span>';
    } else {
      html += '<span class="dt-half-val">' + s.omiRate.toFixed(1) + '%</span>';
    }
    html += '</div>';
    html += '<div class="dt-half-row"><span class="dt-half-key">Avg RT</span>';
    if (prev) {
      var rtDiff = s.avgRt !== null && prev.avgRt !== null ? s.avgRt - prev.avgRt : null;
      var rtCls = rtDiff === null || Math.abs(rtDiff) < 15 ? '' : rtDiff > 0 ? ' dt-half-worse' : ' dt-half-better';
      html += '<span class="dt-half-val' + rtCls + '">' + (s.avgRt !== null ? Math.round(s.avgRt) + 'ms' : '—') +
        (rtDiff !== null && Math.abs(rtDiff) >= 15 ? ' (' + (rtDiff > 0 ? '+' : '') + Math.round(rtDiff) + 'ms)' : '') + '</span>';
    } else {
      html += '<span class="dt-half-val">' + (s.avgRt !== null ? Math.round(s.avgRt) + 'ms' : '—') + '</span>';
    }
    html += '</div>';
    html += '<div class="dt-half-row"><span class="dt-half-key">Gaze wander</span>';
    if (prev) {
      var gwDiff = s.gazeWander - prev.gazeWander;
      var gwCls = Math.abs(gwDiff) < 2 ? '' : gwDiff > 0 ? ' dt-half-worse' : ' dt-half-better';
      html += '<span class="dt-half-val' + gwCls + '">' + s.gazeWander.toFixed(1) + '%' + (Math.abs(gwDiff) >= 2 ? ' (' + (gwDiff > 0 ? '+' : '') + gwDiff.toFixed(1) + '%)' : '') + '</span>';
    } else {
      html += '<span class="dt-half-val">' + s.gazeWander.toFixed(1) + '%</span>';
    }
    html += '</div>';
    html += '</div>';
    return html;
  }

  /* ── DR profile bar ─────────────────────────────────────────── */
  function dtDrProfileBar(label, valueStr, pct, tdThresh, adhdThresh) {
    var cls = dtBarClass(pct);
    return '<div class="dt-dr-bar-row">' +
      '<div class="dt-dr-bar-label"><span class="dt-dr-bar-name">' + label + '</span><span class="dt-dr-bar-val">' + valueStr + '</span></div>' +
      '<div class="dt-bar-wrap" style="margin-bottom:4px"><div class="dt-bar ' + cls + '" style="width:' + Math.min(100,pct) + '%"></div></div>' +
      '<div class="dt-thresholds"><span class="dt-thresh-td">' + tdThresh + ' typical</span><span class="dt-thresh-adhd">' + adhdThresh + ' ADHD</span></div>' +
    '</div>';
  }

  /* ── Main ────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {

    // Sidebar toggle
    var sidebar   = document.getElementById('sidebar');
    var hamburger = document.getElementById('hamburger');
    var backdrop  = document.getElementById('sidebar-backdrop');

    function closeSidebar() {
      sidebar.classList.remove('expanded');
      if (backdrop) backdrop.classList.remove('visible');
    }

    if (window.matchMedia('(min-width: 1024px)').matches) {
      sidebar.classList.add('expanded');
    }

    if (hamburger) hamburger.addEventListener('click', function () {
      sidebar.classList.toggle('expanded');
      if (backdrop) backdrop.classList.toggle('visible', sidebar.classList.contains('expanded'));
    });

    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    // ADHD Tests dropdown
    var navTests      = document.getElementById('nav-tests');
    var navGroupTests = document.getElementById('nav-group-tests');
    if (navTests) navTests.addEventListener('click', function () {
      if (!sidebar.classList.contains('expanded')) sidebar.classList.add('expanded');
      navGroupTests.classList.toggle('open');
    });

    // ADHD Trains dropdown
    var navTrains      = document.getElementById('nav-trains');
    var navGroupTrains = document.getElementById('nav-group-trains');
    if (navTrains) navTrains.addEventListener('click', function () {
      if (!sidebar.classList.contains('expanded')) sidebar.classList.add('expanded');
      navGroupTrains.classList.toggle('open');
    });

    // Date pill
    var datePill = document.getElementById('dash-date');
    if (datePill) datePill.textContent = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    // Calibration status
    var calDone = localStorage.getItem('neurogaze_cal_done') === 'true';
    var calStatusEl = document.getElementById('cal-status');
    var calDot = document.querySelector('.pill-dot');
    if (calDone && calStatusEl) { calStatusEl.textContent = 'Done'; if (calDot) calDot.classList.add('ok'); }

    // ── Retrieve latest results ───────────────────────────────
    var fixData = getLatestTestByName('Fixation Stability Test');
    var astData = getLatestTestByName('Antisaccade Test');
    var cptData = getLatestTestByName('CPT (Go/No-Go)');
    var drData  = getLatestDR();

    var hasAny = fixData || astData || cptData || drData;

    if (!hasAny) {
      document.getElementById('res-no-data').style.display = 'block';
      document.getElementById('res-content').style.display = 'none';
      return;
    }
    document.getElementById('res-no-data').style.display = 'none';
    document.getElementById('res-content').style.display = 'block';

    // ── Normalize scores ──────────────────────────────────────
    var fixScore = fixData ? (fixData.prob != null ? Math.round(fixData.prob * 100) : normalizeFixation(fixData.bcea, fixData.driftPct, fixData.swj, fixData.qePct)) : null;
    var astScore = astData ? (astData.prob != null ? Math.round(astData.prob * 100) : normalizeAntisaccade(astData.errorRate, astData.cv, astData.meanCor)) : null;
    var cptScore = cptData ? (cptData.prob != null ? Math.round(cptData.prob * 100) : normalizeCPT(cptData.rtv, cptData.commissionRate, cptData.omissionRate, cptData.gazeWander, cptData.decayDelta)) : null;
    var drScore  = drData  ? (drData.adhdProb != null ? drData.adhdProb : normalizeDistractor(drData.avgGrl, drData.capturePct, drData.offTaskPct)) : null;

    var finalScore = computeWeightedScore(fixScore, astScore, cptScore, drScore);

    // ── Populate 4 summary cards ──────────────────────────────
    populateCard('res-card-fixation', 'res-badge-fixation', 'res-metrics-fixation', 'res-prob-fixation',
      fixData,
      fixData ? [
        fixData.bcea != null ? fixData.bcea.toFixed(2) : '—',
        fixData.qePct != null ? (fixData.qePct * 100).toFixed(0) + '%' : '—',
        fixData.swj != null ? fixData.swj : '—'
      ] : [],
      fixData ? (fixData.prob != null ? fixData.prob * 100 : fixScore) : null
    );

    populateCard('res-card-antisaccade', 'res-badge-antisaccade', 'res-metrics-antisaccade', 'res-prob-antisaccade',
      astData,
      astData ? [
        astData.errorRate != null ? astData.errorRate.toFixed(1) + '%' : '—',
        astData.meanLat != null ? Math.round(astData.meanLat) + 'ms' : '—',
        astData.cv != null ? astData.cv.toFixed(1) + '%' : '—'
      ] : [],
      astData ? (astData.prob != null ? astData.prob * 100 : astScore) : null
    );

    populateCard('res-card-cpt', 'res-badge-cpt', 'res-metrics-cpt', 'res-prob-cpt',
      cptData,
      cptData ? [
        cptData.commissionRate != null ? cptData.commissionRate.toFixed(1) + '%' : '—',
        cptData.rtv != null ? cptData.rtv.toFixed(0) + 'ms' : '—',
        cptData.omissionRate != null ? cptData.omissionRate.toFixed(1) + '%' : '—'
      ] : [],
      cptData ? (cptData.prob != null ? cptData.prob * 100 : cptScore) : null
    );

    populateCard('res-card-distractor', 'res-badge-distractor', 'res-metrics-distractor', 'res-prob-distractor',
      drData,
      drData ? [
        drData.avgGrl != null ? Math.round(drData.avgGrl) + 'ms' : 'N/A',
        drData.capturePct != null ? drData.capturePct.toFixed(0) + '%' : '—',
        drData.offTaskPct != null ? drData.offTaskPct.toFixed(1) + '%' : '—'
      ] : [],
      drData ? drData.adhdProb : null
    );

    // ── Tests-used line ───────────────────────────────────────
    var testsUsed = [fixData, astData, cptData, drData].filter(Boolean).length;
    var usedEl = document.getElementById('res-tests-used');
    if (usedEl) usedEl.textContent = 'Based on ' + testsUsed + ' of 4 tests completed';

    // ── Animate gauge ─────────────────────────────────────────
    setTimeout(function () { animateGauge(finalScore || 0); }, 300);

    // ── Render breakdown bars ─────────────────────────────────
    var fixRaw = fixData ? 'BCEA ' + fixData.bcea.toFixed(2) + '°²' : '';
    var astRaw = astData ? 'Error ' + astData.errorRate.toFixed(1) + '%' : '';
    var cptRaw = cptData
      ? 'RTV ' + (cptData.rtv != null ? cptData.rtv.toFixed(0) + 'ms' : '—') +
        ' · Comm ' + (cptData.commissionRate != null ? cptData.commissionRate.toFixed(1) + '%' : '—')
      : '';
    var drRaw = drData ? 'GRL ' + (drData.avgGrl != null ? Math.round(drData.avgGrl) + 'ms' : 'N/A') : '';

    renderBar('res-bar-antisaccade', 'Antisaccade',        astRaw, astScore, 35);
    renderBar('res-bar-cpt',        'CPT Go/No-Go',       cptRaw, cptScore, 30);
    renderBar('res-bar-distractor', 'Distractor Recovery', drRaw,  drScore,  20);
    renderBar('res-bar-fixation',   'Fixation Stability',  fixRaw, fixScore, 15);

    // ── Summary ───────────────────────────────────────────────
    var scores = { fixation: fixScore, antisaccade: astScore, cpt: cptScore, distractor: drScore };
    var driver = dominantDriver(scores);
    var iconEl  = document.getElementById('res-summary-icon');
    var titleEl = document.getElementById('res-summary-title');
    var bodyEl  = document.getElementById('res-summary-body');

    if (finalScore < 25) {
      if (iconEl)  iconEl.textContent  = '✅';
      if (titleEl) titleEl.textContent = 'Low ADHD Probability';
      if (bodyEl)  bodyEl.textContent  = 'All biomarkers fall within or near the neurotypical range. No significant attentional deficits detected across the oculomotor batteries.';
    } else if (finalScore < 50) {
      if (iconEl)  iconEl.textContent  = '⚠️';
      if (titleEl) titleEl.textContent = 'Mild ADHD Indicators';
      if (bodyEl)  bodyEl.textContent  = 'Some biomarkers deviate from neurotypical baselines' +
        (driver ? ', primarily driven by ' + driver : '') +
        '. This may reflect subclinical attention variability, fatigue, or measurement noise. Consider retesting after rest.';
    } else if (finalScore < 75) {
      if (iconEl)  iconEl.textContent  = '🟠';
      if (titleEl) titleEl.textContent = 'Moderate ADHD Probability';
      if (bodyEl)  bodyEl.textContent  = 'Multiple biomarkers indicate attention regulation difficulties' +
        (driver ? ', primarily driven by ' + driver : '') +
        '. Results are consistent with subclinical or mild ADHD profiles. Clinical evaluation is recommended.';
    } else {
      if (iconEl)  iconEl.textContent  = '🔴';
      if (titleEl) titleEl.textContent = 'High ADHD Probability';
      if (bodyEl)  bodyEl.textContent  = 'High likelihood of ADHD traits' +
        (driver ? ', primarily driven by ' + driver : '') +
        '. Multiple oculomotor biomarkers significantly exceed neurotypical thresholds. Professional clinical assessment is strongly recommended.';
    }

    // ── Canvas rendering functions ────────────────────────────

    function dtSetupCanvas(canvas) {
      var dpr = window.devicePixelRatio || 1;
      var attrW = parseInt(canvas.getAttribute('width'), 10) || 560;
      var attrH = parseInt(canvas.getAttribute('height'), 10) || 280;
      var cssW = canvas.offsetWidth || attrW;
      var cssH = Math.round(cssW * attrH / attrW);
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      var ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      return { ctx: ctx, W: cssW, H: cssH };
    }

    function dtDrawNoData(canvas, msg) {
      var s = dtSetupCanvas(canvas);
      var ctx = s.ctx, W = s.W, H = s.H;
      ctx.fillStyle = 'rgba(10,10,26,0.97)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔄  ' + msg, W / 2, H / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    function dtRenderScatter(canvas, xs, ys, bcea) {
      if (!canvas) return;
      if (!xs || !xs.length) {
        dtDrawNoData(canvas, 'Re-run Fixation Stability Test to see Gaze Scatter Plot');
        return;
      }
      var s = dtSetupCanvas(canvas);
      var W = s.W, H = s.H;
      var ctx = s.ctx;
      ctx.fillStyle = 'rgba(10,10,26,0.97)';
      ctx.fillRect(0, 0, W, H);

      var cx = W / 2, cy = H / 2;

      // Compute mean and spread of stored pixel-coordinate data
      var n = xs.length;
      var sumX = 0, sumY = 0;
      for (var i = 0; i < n; i++) { sumX += xs[i]; sumY += ys[i]; }
      var mx = sumX / n, my = sumY / n;
      var varX = 0, varY = 0;
      for (var i = 0; i < n; i++) { varX += (xs[i] - mx) * (xs[i] - mx); varY += (ys[i] - my) * (ys[i] - my); }
      var sx = Math.sqrt(varX / n), sy = Math.sqrt(varY / n);
      var range = Math.max(sx, sy, 20) * 4;

      function mapX(x) { return cx + ((x - mx) / range) * (W * 0.42); }
      function mapY(y) { return cy + ((y - my) / range) * (H * 0.42); }

      // Dashed crosshair
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
      ctx.setLineDash([]);

      var scaleR = (W * 0.42) / range;  // canvas px per source px

      // Threshold reference circles using proper px→deg conversion
      // BCEA °² → sigma_deg = sqrt(BCEA/2π) → sigma_px = sigma_deg × 55
      var PX_PER_DEG = 55;
      function drawThreshCircle(threshBcea, strokeColor, fillColor) {
        var sigmaDeg = Math.sqrt(threshBcea / (2 * Math.PI));
        var sigmaPx  = sigmaDeg * PX_PER_DEG; // in source-pixel space
        var rCanvas  = Math.max(sigmaPx * scaleR, 4);
        ctx.beginPath();
        ctx.arc(cx, cy, rCanvas, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Draw ADHD first (larger) so TD renders on top
      drawThreshCircle(10.0, 'rgba(255,82,82,0.85)',   'rgba(255,82,82,0.07)');
      drawThreshCircle(3.5, 'rgba(0,230,118,0.85)',   'rgba(0,230,118,0.07)');

      // Annotate threshold circles inline if large enough; else rely on legend below
      var sigmaTD_canvas   = Math.max(Math.sqrt(3.5 / (2 * Math.PI)) * PX_PER_DEG * scaleR, 4);
      var sigmaADHD_canvas = Math.max(Math.sqrt(10.0 / (2 * Math.PI)) * PX_PER_DEG * scaleR, 4);
      if (sigmaADHD_canvas > 30) {
        // Large enough to label inline
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = 'rgba(0,230,118,0.85)';
        ctx.textAlign = 'center';
        ctx.fillText('TD', cx, cy - sigmaTD_canvas - 4);
        ctx.fillStyle = 'rgba(255,82,82,0.85)';
        ctx.fillText('ADHD', cx, cy - sigmaADHD_canvas - 4);
        ctx.textAlign = 'left';
      }

      // Gaze points
      ctx.fillStyle = 'rgba(124,92,252,0.55)';
      for (var i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(mapX(xs[i]), mapY(ys[i]), 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Centroid dot
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();

      // Top-right info box
      var infoX = W - 10;
      ctx.textAlign = 'right';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('BCEA: ' + (bcea != null ? bcea.toFixed(2) : '—') + '°²  |  n=' + n, infoX, H - 28);
      var ratio = bcea / 10.0;
      var ratioColor = bcea > 10.0 ? '#ff6b6b' : '#4cd964';
      ctx.fillStyle = ratioColor;
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(ratio.toFixed(1) + '× ADHD threshold', infoX, H - 12);
      ctx.textAlign = 'left';
    }

    function dtRenderTemporal(canvas, buckets) {
      if (!canvas) return;
      if (!buckets || !buckets.length) {
        dtDrawNoData(canvas, 'Re-run Fixation Stability Test to see Attention Stability chart');
        return;
      }
      var s = dtSetupCanvas(canvas);
      var W = s.W, H = s.H;
      var ctx = s.ctx;
      var PAD = { l: 48, r: 16, t: 14, b: 32 };
      var cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b;

      ctx.fillStyle = 'rgba(10,10,26,0.97)';
      ctx.fillRect(0, 0, W, H);

      var maxVal = Math.max(4.0, Math.max.apply(null, buckets));
      var n = buckets.length;

      function toX(i) { return PAD.l + (i / (n - 1)) * cw; }
      function toY(v) { return PAD.t + ch - (v / maxVal) * ch; }

      // Threshold lines — labeled INSIDE the chart area
      function hLine(val, color, label) {
        var y = toY(val);
        if (y < PAD.t || y > PAD.t + ch) return;
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + cw, y); ctx.stroke();
        ctx.setLineDash([]);
        // Label inside chart, right-aligned, just above the line
        ctx.fillStyle = color;
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(label, PAD.l + cw - 4, y - 3);
        ctx.textAlign = 'left';
      }
      hLine(3.5, 'rgba(0,230,118,0.75)', 'TD 3.5°²');
      hLine(10.0, 'rgba(255,82,82,0.75)', 'ADHD 10.0°²');

      // Fill area
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(0));
      for (var i = 0; i < n; i++) ctx.lineTo(toX(i), toY(buckets[i]));
      ctx.lineTo(toX(n - 1), toY(0));
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ch);
      grad.addColorStop(0, 'rgba(124,92,252,0.55)');
      grad.addColorStop(1, 'rgba(124,92,252,0.05)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        if (i === 0) ctx.moveTo(toX(i), toY(buckets[i]));
        else ctx.lineTo(toX(i), toY(buckets[i]));
      }
      ctx.strokeStyle = 'rgb(124,92,252)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // X axis labels
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      var dur = 30;
      for (var t = 0; t <= dur; t += 10) {
        var x = PAD.l + (t / dur) * cw;
        ctx.fillText(t + 's', x, H - 6);
      }

      // Y axis labels — pick ~5 nicely-spaced ticks
      var rawStep = maxVal / 4;
      var magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
      var niceSteps = [1, 2, 2.5, 5, 10];
      var step = magnitude;
      for (var si = 0; si < niceSteps.length; si++) {
        if (niceSteps[si] * magnitude >= rawStep) { step = niceSteps[si] * magnitude; break; }
      }
      ctx.textAlign = 'right';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      for (var vt = 0; vt <= maxVal * 1.01; vt += step) {
        var yt = toY(vt);
        if (yt >= PAD.t && yt <= PAD.t + ch + 1) {
          var lbl = vt < 10 ? vt.toFixed(step < 1 ? 1 : 0) : Math.round(vt).toString();
          ctx.fillText(lbl, PAD.l - 4, yt + 3);
        }
      }
      ctx.textAlign = 'left';
    }

    function dtRenderLatHist(canvas, latencies, meanLat) {
      if (!canvas) return;
      if (!latencies || !latencies.length) {
        dtDrawNoData(canvas, 'Re-run Antisaccade Test to see Latency Distribution');
        return;
      }
      var s = dtSetupCanvas(canvas);
      var W = s.W, H = s.H;
      var ctx = s.ctx;
      var PAD = { l: 36, r: 10, t: 14, b: 32 };
      var cw = W - PAD.l - PAD.r, ch = H - PAD.t - PAD.b;

      ctx.fillStyle = 'rgba(10,10,26,0.97)';
      ctx.fillRect(0, 0, W, H);

      // Bins: 0-100, 100-200, ..., 900-1000, 1000+
      var binSize = 100, minMs = 0, maxMs = 1000;
      var bins = [];
      for (var b = minMs; b < maxMs; b += binSize) bins.push(0);
      bins.push(0); // overflow
      latencies.forEach(function(v) {
        var idx = Math.min(Math.floor(v / binSize), bins.length - 1);
        bins[idx]++;
      });

      var maxCount = Math.max(1, Math.max.apply(null, bins));
      var bw = cw / bins.length;

      function barColor(binIdx) {
        var lo = binIdx * binSize;
        if (lo < 180 || lo >= 350) return 'rgba(255,82,82,0.75)';  // outside typical
        return 'rgba(0,230,118,0.75)';                              // typical 180-350ms
      }

      for (var i = 0; i < bins.length; i++) {
        if (bins[i] === 0) continue;
        var bh = (bins[i] / maxCount) * ch;
        var bx = PAD.l + i * bw;
        var by = PAD.t + ch - bh;
        ctx.fillStyle = barColor(i);
        ctx.fillRect(bx + 1, by, bw - 2, bh);
        if (bins[i] > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.font = '9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(bins[i], bx + bw / 2, by - 3);
        }
      }

      // Mean latency marker
      if (meanLat != null) {
        var mx = PAD.l + (meanLat / maxMs) * cw;
        ctx.strokeStyle = 'rgba(255,220,0,0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(mx, PAD.t); ctx.lineTo(mx, PAD.t + ch); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,220,0,0.9)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('mean ' + Math.round(meanLat) + 'ms', mx, PAD.t + 10);
      }

      // X axis labels
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      for (var b2 = 0; b2 <= maxMs; b2 += 200) {
        ctx.fillText(b2 + 'ms', PAD.l + (b2 / maxMs) * cw, H - 6);
      }
      ctx.textAlign = 'left';
    }

    // ── Detail panel: click handlers ──────────────────────────
    var resPage    = document.querySelector('.res-page');
    var detailPanel = document.getElementById('res-detail');
    var detailContent = document.getElementById('res-detail-content');
    var backBtn = document.getElementById('res-detail-back');

    var testDataMap = {
      fixation:    fixData,
      antisaccade: astData,
      cpt:         cptData,
      distractor:  drData
    };
    var testBuilders = {
      fixation:    buildFixationDetail,
      antisaccade: buildAntisaccadeDetail,
      cpt:         buildCPTDetail,
      distractor:  buildDistractorDetail
    };

    document.querySelectorAll('.res-test-card[data-test]').forEach(function (card) {
      card.addEventListener('click', function () {
        var key = card.getAttribute('data-test');
        var data = testDataMap[key];
        if (!data) return;
        var builder = testBuilders[key];
        if (!builder) return;
        detailContent.innerHTML = builder(data);
        resPage.style.display = 'none';
        detailPanel.style.display = 'flex';
        detailPanel.scrollTop = 0;

        // Render canvas charts after innerHTML is set
        if (key === 'fixation') {
          dtRenderScatter(document.getElementById('dt-scatter-canvas'), data.xs, data.ys, data.bcea);
          dtRenderTemporal(document.getElementById('dt-temporal-canvas'), data.temporalBuckets);
        }
        if (key === 'antisaccade') {
          dtRenderLatHist(document.getElementById('dt-lat-hist-canvas'), data.latencies, data.meanLat);
        }
      });
    });

    if (backBtn) {
      backBtn.addEventListener('click', function () {
        detailPanel.style.display = 'none';
        resPage.style.display = '';
      });
    }
  });
