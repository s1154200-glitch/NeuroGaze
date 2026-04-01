  'use strict';
  document.addEventListener('DOMContentLoaded', function () {

    /* ── Sidebar toggles ─────────────────────────────────────── */
    var sidebar = document.getElementById('sidebar');
    var hamburger = document.getElementById('hamburger');
    var backdrop  = document.getElementById('sidebar-backdrop');

    function closeSidebar() {
      sidebar.classList.remove('expanded');
      if (backdrop) backdrop.classList.remove('visible');
    }

    if (hamburger) hamburger.addEventListener('click', function () {
      sidebar.classList.toggle('expanded');
      if (backdrop) backdrop.classList.toggle('visible', sidebar.classList.contains('expanded'));
    });

    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    function initDropdown(btnId, groupId) {
      var btn = document.getElementById(btnId);
      var grp = document.getElementById(groupId);
      if (btn && grp) btn.addEventListener('click', function () {
        if (!sidebar.classList.contains('expanded')) sidebar.classList.add('expanded');
        grp.classList.toggle('open');
      });
    }
    initDropdown('nav-tests', 'nav-group-tests');
    initDropdown('nav-trains', 'nav-group-trains');

    /* ── Date & calibration pills ────────────────────────────── */
    var dp = document.getElementById('dash-date');
    if (dp) dp.textContent = new Date().toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
    var calDone = localStorage.getItem('neurogaze_cal_done') === 'true';
    var calEl = document.getElementById('cal-status');
    var calDot = document.querySelector('.pill-dot');
    if (calDone && calEl) { calEl.textContent = 'Done'; if (calDot) calDot.classList.add('ok'); }

    /* ── Helpers ──────────────────────────────────────────────── */
    function fmtDate(ts) {
      var d = new Date(typeof ts === 'string' ? ts : ts);
      return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
    }
    function pct(v) { return (v * 100).toFixed(1) + '%'; }
    function trend(arr, key, lowerBetter) {
      if (arr.length < 2) return 'na';
      var first = arr[0][key], last = arr[arr.length - 1][key];
      if (first == null || last == null) return 'na';
      var delta = last - first;
      if (Math.abs(delta) < 0.01) return 'flat';
      if (lowerBetter) return delta < 0 ? 'up' : 'down';
      return delta > 0 ? 'up' : 'down';
    }
    function setBadge(id, t) {
      var el = document.getElementById(id);
      if (!el) return;
      var map = { up: ['Improving','az-badge-up'], down: ['Regressing','az-badge-down'], flat: ['Stable','az-badge-flat'], na: ['Insufficient Data','az-badge-na'] };
      var m = map[t] || map.na;
      el.textContent = m[0]; el.className = 'az-badge ' + m[1];
    }
    function metricHtml(val, lbl) { return '<div class="az-metric"><div class="az-metric-val">' + val + '</div><div class="az-metric-lbl">' + lbl + '</div></div>'; }

    var chartDefaults = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: 'rgba(255,255,255,.55)', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,.35)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { ticks: { color: 'rgba(255,255,255,.35)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.06)' } }
      }
    };
    function mkDataset(label, data, color) {
      return { label: label, data: data, borderColor: color, backgroundColor: color.replace('1)', '0.08)'), tension: 0.35, pointRadius: 4, pointBackgroundColor: color, fill: true, borderWidth: 2 };
    }

    /* ── Load data ────────────────────────────────────────────── */
    var testHist = [];
    try { testHist = JSON.parse(localStorage.getItem('neurogaze_test_history') || '[]'); } catch(_){}
    var drHist = [];
    try { drHist = JSON.parse(localStorage.getItem('neurogaze_dr_results') || '[]'); } catch(_){}

    var fixData = testHist.filter(function(h){ return h.name === 'Fixation Stability Test'; });
    var astData = testHist.filter(function(h){ return h.name === 'Antisaccade Test'; });
    var cptData = testHist.filter(function(h){ return h.name === 'CPT (Go/No-Go)'; });

    var hasAny = fixData.length > 0 || astData.length > 0 || cptData.length > 0 || drHist.length > 0;
    document.getElementById('az-empty').style.display = hasAny ? 'none' : '';

    /* ── 1. Fixation Stability ───────────────────────────────── */
    if (fixData.length > 0) {
      document.getElementById('az-fixation').style.display = '';
      var labels = fixData.map(function(d){ return fmtDate(d.time); });
      new Chart(document.getElementById('chart-fixation'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            mkDataset('BCEA (°²)', fixData.map(function(d){ return +d.bcea.toFixed(2); }), 'rgba(124,92,252,1)'),
            mkDataset('SWJ Count', fixData.map(function(d){ return d.swj; }), 'rgba(255,59,48,1)'),
            mkDataset('ADHD Prob', fixData.map(function(d){ return +(d.prob*100).toFixed(1); }), 'rgba(255,149,0,1)')
          ]
        },
        options: chartDefaults
      });
      var last = fixData[fixData.length - 1];
      var t = trend(fixData, 'bcea', true);
      setBadge('fix-trend-badge', t);
      document.getElementById('fix-metrics').innerHTML =
        metricHtml(last.bcea.toFixed(2) + '°²', 'Latest BCEA') +
        metricHtml(last.swj, 'SWJ Count') +
        metricHtml((last.qePct || 0).toFixed(1) + '%', 'Quiet Eye %') +
        metricHtml((last.prob * 100).toFixed(0) + '%', 'ADHD Prob');
      var fixInsight = last.bcea < 1.5
        ? 'Your fixation stability is within the typical development (TD) range. BCEA below 1.5°² indicates well-controlled oculomotor function with minimal involuntary eye movements.'
        : last.bcea < 3.0
        ? 'Your fixation stability is in the borderline range. BCEA between 1.5–3.0°² suggests some instability — this may improve with training.'
        : 'Your fixation stability is elevated, in the ADHD-concern range (BCEA > 3.0°²). Elevated BCEA indicates difficulty maintaining steady gaze, a common oculomotor biomarker in ADHD.';
      if (fixData.length >= 2) {
        var delta = last.bcea - fixData[0].bcea;
        fixInsight += delta < -0.2 ? ' Trend: Your BCEA has improved by ' + Math.abs(delta).toFixed(2) + '°² since your first test.' : delta > 0.2 ? ' Trend: BCEA has increased by ' + delta.toFixed(2) + '°² — consider more frequent fixation training.' : ' Trend: BCEA is stable across sessions.';
      }
      document.getElementById('fix-insight').textContent = fixInsight;
    }

    /* ── 2. Antisaccade ──────────────────────────────────────── */
    if (astData.length > 0) {
      document.getElementById('az-antisaccade').style.display = '';
      var labels2 = astData.map(function(d){ return fmtDate(d.time); });
      new Chart(document.getElementById('chart-antisaccade'), {
        type: 'line',
        data: {
          labels: labels2,
          datasets: [
            mkDataset('Error Rate %', astData.map(function(d){ return +(d.errorRate*100).toFixed(1); }), 'rgba(255,59,48,1)'),
            mkDataset('Mean Latency ms', astData.map(function(d){ return Math.round(d.meanLat); }), 'rgba(76,217,100,1)'),
            mkDataset('ADHD Prob %', astData.map(function(d){ return +(d.prob*100).toFixed(1); }), 'rgba(255,149,0,1)')
          ]
        },
        options: chartDefaults
      });
      var lastA = astData[astData.length - 1];
      setBadge('ast-trend-badge', trend(astData, 'errorRate', true));
      document.getElementById('ast-metrics').innerHTML =
        metricHtml((lastA.errorRate*100).toFixed(1) + '%', 'Error Rate') +
        metricHtml(Math.round(lastA.meanLat) + ' ms', 'Mean Latency') +
        metricHtml((lastA.cv || 0).toFixed(2), 'CV') +
        metricHtml((lastA.prob*100).toFixed(0) + '%', 'ADHD Prob');
      var astInsight = lastA.errorRate < 0.2
        ? 'Inhibitory control is strong — error rate below 20% indicates effective suppression of reflexive saccades toward the distractor.'
        : lastA.errorRate < 0.4
        ? 'Moderate inhibitory control — error rate is between 20–40%. This suggests some difficulty suppressing reflexive eye movements.'
        : 'Weak inhibitory control — error rate above 40% is in the ADHD-concern range, indicating significant difficulty with saccade suppression.';
      if (astData.length >= 2) {
        var dE = lastA.errorRate - astData[0].errorRate;
        astInsight += dE < -0.05 ? ' Trend: Error rate has improved by ' + Math.abs(dE*100).toFixed(1) + '% over your sessions.' : dE > 0.05 ? ' Trend: Error rate has worsened by ' + (dE*100).toFixed(1) + '%. Consider more antisaccade practice.' : ' Trend: Error rate is stable.';
      }
      document.getElementById('ast-insight').textContent = astInsight;
    }

    /* ── 3. CPT ──────────────────────────────────────────────── */
    if (cptData.length > 0) {
      document.getElementById('az-cpt').style.display = '';
      var labels3 = cptData.map(function(d){ return fmtDate(d.time); });
      new Chart(document.getElementById('chart-cpt'), {
        type: 'line',
        data: {
          labels: labels3,
          datasets: [
            mkDataset('Commission %', cptData.map(function(d){ return +(d.commissionRate*100).toFixed(1); }), 'rgba(255,59,48,1)'),
            mkDataset('Omission %', cptData.map(function(d){ return +(d.omissionRate*100).toFixed(1); }), 'rgba(124,92,252,1)'),
            mkDataset('ADHD Prob %', cptData.map(function(d){ return +(d.prob*100).toFixed(1); }), 'rgba(255,149,0,1)')
          ]
        },
        options: chartDefaults
      });
      var lastC = cptData[cptData.length - 1];
      setBadge('cpt-trend-badge', trend(cptData, 'commissionRate', true));
      document.getElementById('cpt-metrics').innerHTML =
        metricHtml((lastC.commissionRate*100).toFixed(1) + '%', 'Commission Rate') +
        metricHtml((lastC.omissionRate*100).toFixed(1) + '%', 'Omission Rate') +
        metricHtml((lastC.rtv || 0).toFixed(0) + ' ms', 'RT Variability') +
        metricHtml((lastC.prob*100).toFixed(0) + '%', 'ADHD Prob');
      var cptInsight = lastC.commissionRate < 0.15 && lastC.omissionRate < 0.15
        ? 'Sustained attention is strong — both commission and omission error rates are below 15%, indicating good impulse control and consistent focus.'
        : lastC.commissionRate >= 0.3 || lastC.omissionRate >= 0.3
        ? 'Significant attention concern — high error rates indicate difficulty with sustained attention and impulse control, both hallmarks of ADHD.'
        : 'Moderate attention performance — some errors suggest intermittent lapses in sustained attention or impulse control.';
      if (cptData.length >= 2) {
        var dCom = lastC.commissionRate - cptData[0].commissionRate;
        cptInsight += dCom < -0.05 ? ' Trend: Commission rate improved by ' + Math.abs(dCom*100).toFixed(1) + '%.' : dCom > 0.05 ? ' Trend: Commission rate increased by ' + (dCom*100).toFixed(1) + '% — consider more go/no-go training.' : ' Trend: Commission rate is stable.';
      }
      document.getElementById('cpt-insight').textContent = cptInsight;
    }

    /* ── 4. Distractor Recovery ──────────────────────────────── */
    if (drHist.length > 0) {
      document.getElementById('az-dr').style.display = '';
      var labels4 = drHist.map(function(d){ return fmtDate(d.date); });
      new Chart(document.getElementById('chart-dr'), {
        type: 'line',
        data: {
          labels: labels4,
          datasets: [
            mkDataset('Avg GRL ms', drHist.map(function(d){ return Math.round(d.avgGrl); }), 'rgba(76,217,100,1)'),
            mkDataset('Capture %', drHist.map(function(d){ return +(d.capturePct*100).toFixed(1); }), 'rgba(124,92,252,1)'),
            mkDataset('ADHD Prob %', drHist.map(function(d){ return +(d.adhdProb*100).toFixed(1); }), 'rgba(255,149,0,1)')
          ]
        },
        options: chartDefaults
      });
      var lastD = drHist[drHist.length - 1];
      setBadge('dr-trend-badge', trend(drHist, 'avgGrl', true));
      document.getElementById('dr-metrics').innerHTML =
        metricHtml(Math.round(lastD.avgGrl) + ' ms', 'Avg GRL') +
        metricHtml((lastD.capturePct*100).toFixed(1) + '%', 'Capture Rate') +
        metricHtml((lastD.offTaskPct*100).toFixed(1) + '%', 'Off-Task %') +
        metricHtml((lastD.adhdProb > 1 ? lastD.adhdProb : lastD.adhdProb*100).toFixed(0) + '%', 'ADHD Prob');
      var drInsight = lastD.avgGrl < 400
        ? 'Gaze reorientation latency is fast (< 400 ms), indicating efficient distractor recovery and strong frontoparietal network function.'
        : lastD.avgGrl < 700
        ? 'Moderate gaze reorientation latency — recovery from distractors is slightly delayed, which may indicate mild attentional disengagement difficulty.'
        : 'Slow gaze reorientation (> 700 ms) — this is in the ADHD-concern range and suggests significant difficulty redirecting attention after distractions.';
      if (drHist.length >= 2) {
        var dG = lastD.avgGrl - drHist[0].avgGrl;
        drInsight += dG < -30 ? ' Trend: GRL improved by ' + Math.abs(Math.round(dG)) + ' ms from your first session.' : dG > 30 ? ' Trend: GRL has slowed by ' + Math.round(dG) + ' ms — consider more distractor recovery training.' : ' Trend: GRL is stable.';
      }
      document.getElementById('dr-insight').textContent = drInsight;
    }

    /* ── 5. Overall Analysis ─────────────────────────────────── */
    if (hasAny) {
      document.getElementById('az-overall').style.display = '';

      // Collect all ADHD probability entries for the radar/bar chart
      var allProbs = [];
      var radarLabels = [];
      var radarData = [];
      if (fixData.length) { var lf = fixData[fixData.length-1]; radarLabels.push('Fixation'); radarData.push(+(lf.prob*100).toFixed(1)); allProbs.push(lf.prob); }
      if (astData.length) { var la = astData[astData.length-1]; radarLabels.push('Antisaccade'); radarData.push(+(la.prob*100).toFixed(1)); allProbs.push(la.prob); }
      if (cptData.length) { var lc = cptData[cptData.length-1]; radarLabels.push('CPT'); radarData.push(+(lc.prob*100).toFixed(1)); allProbs.push(lc.prob); }
      if (drHist.length)  { var ld = drHist[drHist.length-1]; var drProbPct = ld.adhdProb > 1 ? +ld.adhdProb.toFixed(1) : +(ld.adhdProb*100).toFixed(1); radarLabels.push('Distractor Rec.'); radarData.push(drProbPct); allProbs.push(drProbPct / 100); }

      var avgProb = allProbs.reduce(function(a,b){return a+b;},0) / allProbs.length;

      new Chart(document.getElementById('chart-overall'), {
        type: 'bar',
        data: {
          labels: radarLabels,
          datasets: [{
            label: 'ADHD Probability %',
            data: radarData,
            backgroundColor: radarData.map(function(v){ return v > 60 ? 'rgba(255,59,48,0.6)' : v > 35 ? 'rgba(255,149,0,0.6)' : 'rgba(76,217,100,0.6)'; }),
            borderColor: radarData.map(function(v){ return v > 60 ? '#ff3b30' : v > 35 ? '#ff9500' : '#4cd964'; }),
            borderWidth: 2,
            borderRadius: 8,
            barPercentage: 0.5,
            maxBarThickness: 56
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: function(ctx) { return ctx.parsed.y + '% ADHD probability'; } } }
          },
          scales: {
            x: { ticks: { color: 'rgba(255,255,255,.5)', font: { size: 12 } }, grid: { display: false } },
            y: { min: 0, max: 100, ticks: { color: 'rgba(255,255,255,.35)', callback: function(v){return v+'%';} }, grid: { color: 'rgba(255,255,255,.06)' } }
          }
        }
      });

      // Overall metrics
      var testsCompleted = (fixData.length > 0 ? 1 : 0) + (astData.length > 0 ? 1 : 0) + (cptData.length > 0 ? 1 : 0) + (drHist.length > 0 ? 1 : 0);
      var totalSessions = fixData.length + astData.length + cptData.length + drHist.length;
      var riskLevel = avgProb > 0.6 ? 'High' : avgProb > 0.35 ? 'Moderate' : 'Low';
      var riskColor = avgProb > 0.6 ? '#ff3b30' : avgProb > 0.35 ? '#ff9500' : '#4cd964';

      document.getElementById('overall-metrics').innerHTML =
        '<div class="az-overall-metric"><div class="az-metric-val" style="color:' + riskColor + '">' + (avgProb*100).toFixed(0) + '%</div><div class="az-metric-lbl">Avg ADHD Probability</div></div>' +
        '<div class="az-overall-metric"><div class="az-metric-val" style="color:' + riskColor + '">' + riskLevel + '</div><div class="az-metric-lbl">Risk Level</div></div>' +
        '<div class="az-overall-metric"><div class="az-metric-val">' + testsCompleted + '/4</div><div class="az-metric-lbl">Tests Completed</div></div>' +
        '<div class="az-overall-metric"><div class="az-metric-val">' + totalSessions + '</div><div class="az-metric-lbl">Total Sessions</div></div>';

      // Overall insight
      var overallInsight;
      if (avgProb > 0.6) {
        overallInsight = 'Your composite ADHD screening score is in the high-concern range (' + (avgProb*100).toFixed(0) + '%). Multiple biomarkers suggest clinically significant attentional difficulties. This is a screening tool — please consult a qualified healthcare professional for formal evaluation.';
      } else if (avgProb > 0.35) {
        overallInsight = 'Your composite score is in the moderate range (' + (avgProb*100).toFixed(0) + '%). Some biomarkers show elevated values. Continued monitoring and targeted training are recommended. If symptoms persist, consider professional evaluation.';
      } else {
        overallInsight = 'Your composite score is in the low-concern range (' + (avgProb*100).toFixed(0) + '%). Most biomarkers fall within typical development norms. Continue periodic testing to monitor trends.';
      }
      if (testsCompleted < 4) {
        overallInsight += ' Note: Only ' + testsCompleted + ' of 4 tests have been completed — completing all tests provides a more reliable composite score.';
      }
      document.getElementById('overall-insight').textContent = overallInsight;

      // Suggestions
      var sug = [];
      // General
      if (testsCompleted < 4) sug.push({ c: 'info', t: 'Complete all 4 tests for the most accurate screening. Missing tests reduce the reliability of the composite score.' });

      // Fixation-specific
      if (fixData.length > 0) {
        var lfx = fixData[fixData.length-1];
        if (lfx.bcea > 3.0) sug.push({ c: 'bad', t: 'Fixation stability is elevated (BCEA ' + lfx.bcea.toFixed(2) + '°²). Practice the Fixation Stability training game daily for 5 minutes to strengthen oculomotor control.' });
        else if (lfx.bcea > 1.5) sug.push({ c: 'warn', t: 'Fixation stability is borderline. Try 3–5 minutes of fixation training every other day and minimise screen fatigue before testing.' });
        else sug.push({ c: 'good', t: 'Fixation stability is strong! Maintain your routine and retest periodically to ensure consistent performance.' });
      }
      // Antisaccade-specific
      if (astData.length > 0) {
        var lax = astData[astData.length-1];
        if (lax.errorRate > 0.4) sug.push({ c: 'bad', t: 'Antisaccade error rate is high (' + (lax.errorRate*100).toFixed(0) + '%). Practice inhibitory control exercises — try the Antisaccade training game and focus on looking away from the distractor.' });
        else if (lax.errorRate > 0.2) sug.push({ c: 'warn', t: 'Antisaccade performance is moderate. Practice suppressing reflexive glances — slow, deliberate saccade exercises can help.' });
        else sug.push({ c: 'good', t: 'Antisaccade control is excellent! Your ability to suppress reflexive eye movements is strong.' });
      }
      // CPT-specific
      if (cptData.length > 0) {
        var lcx = cptData[cptData.length-1];
        if (lcx.commissionRate > 0.25) sug.push({ c: 'bad', t: 'CPT commission rate is high (' + (lcx.commissionRate*100).toFixed(0) + '%), indicating impulsivity. Practice go/no-go tasks and take breaks during long focus sessions.' });
        if (lcx.omissionRate > 0.25) sug.push({ c: 'bad', t: 'CPT omission rate is high (' + (lcx.omissionRate*100).toFixed(0) + '%), indicating inattention. Short, timed focus exercises may help sustain attention.' });
        if (lcx.commissionRate <= 0.25 && lcx.omissionRate <= 0.25) sug.push({ c: 'good', t: 'CPT performance is solid — low error rates indicate good sustained attention and impulse control.' });
      }
      // DR-specific
      if (drHist.length > 0) {
        var ldx = drHist[drHist.length-1];
        var ldxGrl = ldx.avgGrl;
        if (ldxGrl > 700) sug.push({ c: 'bad', t: 'Distractor recovery is slow (GRL ' + Math.round(ldxGrl) + ' ms). Train with the Firefighter Focus game to improve gaze reorientation speed.' });
        else if (ldxGrl > 400) sug.push({ c: 'warn', t: 'Distractor recovery is moderate. Practice redirecting attention after interruptions — the training games can help build this skill.' });
        else sug.push({ c: 'good', t: 'Distractor recovery is fast! You recover focus quickly after distractions.' });
      }
      // Overall lifestyle
      if (avgProb > 0.35) {
        sug.push({ c: 'info', t: 'Lifestyle factors: Ensure 7–9 hours of sleep, regular physical exercise, and reduced screen time before testing. These significantly affect attentional performance.' });
        sug.push({ c: 'info', t: 'Remember: This is a screening tool, not a clinical diagnosis. Share your results with a healthcare professional for comprehensive evaluation.' });
      }

      var sugHtml = '';
      sug.forEach(function(s) {
        sugHtml += '<li class="sug-' + s.c + '">' + s.t + '</li>';
      });
      document.getElementById('overall-suggestions').innerHTML = sugHtml;
    }

    /* ── Dots menu toggle & delete logic ───────────────────── */
    // Toggle menu open/close
    document.addEventListener('click', function (e) {
      var dotsBtn = e.target.closest('.card-dots');
      if (dotsBtn) {
        e.stopPropagation();
        var menuId = dotsBtn.getAttribute('data-menu');
        var menu = document.getElementById(menuId);
        // Close all other menus
        document.querySelectorAll('.az-card-menu.open').forEach(function (m) {
          if (m !== menu) m.classList.remove('open');
        });
        menu.classList.toggle('open');
        return;
      }
      // Click outside closes all menus
      if (!e.target.closest('.az-card-menu')) {
        document.querySelectorAll('.az-card-menu.open').forEach(function (m) { m.classList.remove('open'); });
      }
    });

    // Delete handlers
    document.addEventListener('click', function (e) {
      var delBtn = e.target.closest('.az-del-btn');
      if (!delBtn) return;
      var target = delBtn.getAttribute('data-delete');
      var labels = { fixation: 'Fixation Stability', antisaccade: 'Antisaccade', cpt: 'CPT', dr: 'Distractor Recovery', all: 'ALL test' };
      if (!confirm('Delete all ' + labels[target] + ' data? This cannot be undone.')) return;

      if (target === 'all') {
        localStorage.removeItem('neurogaze_test_history');
        localStorage.removeItem('neurogaze_dr_results');
      } else if (target === 'dr') {
        localStorage.removeItem('neurogaze_dr_results');
      } else {
        // Filter out matching entries from neurogaze_test_history
        var nameMap = { fixation: 'Fixation Stability Test', antisaccade: 'Antisaccade Test', cpt: 'CPT (Go/No-Go)' };
        var hist = [];
        try { hist = JSON.parse(localStorage.getItem('neurogaze_test_history') || '[]'); } catch(_){}
        hist = hist.filter(function (h) { return h.name !== nameMap[target]; });
        localStorage.setItem('neurogaze_test_history', JSON.stringify(hist));
      }
      location.reload();
    });

    /* ── PDF export (off-screen clone — visible page never changes) ── */
    document.getElementById('btn-pdf').addEventListener('click', function () {
      var source = document.getElementById('analyze-root');
      var btnPdf = document.getElementById('btn-pdf');

      // 1. Deep-clone the analysis root into a hidden off-screen container
      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + source.offsetWidth + 'px;background:#fff;z-index:-1';
      var clone = source.cloneNode(true);
      clone.classList.add('pdf-mode');
      // Remove the PDF button from the clone
      var cloneBtn = clone.querySelector('#btn-pdf');
      if (cloneBtn) cloneBtn.remove();
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);

      // Copy each chart canvas as a flat image (dark bg so white labels stay visible)
      var origCanvases = source.querySelectorAll('canvas');
      var cloneCanvases = clone.querySelectorAll('canvas');
      origCanvases.forEach(function (origCanvas, i) {
        var cloneCanvas = cloneCanvases[i];
        if (!cloneCanvas) return;
        // Render chart onto a dark background so white axis text remains readable
        var tmp = document.createElement('canvas');
        tmp.width  = origCanvas.width;
        tmp.height = origCanvas.height;
        var tCtx = tmp.getContext('2d');
        tCtx.fillStyle = '#1a1a2e';
        tCtx.fillRect(0, 0, tmp.width, tmp.height);
        tCtx.drawImage(origCanvas, 0, 0);
        // Replace canvas in clone with a static <img>
        var img = document.createElement('img');
        img.src = tmp.toDataURL('image/png');
        img.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;';
        cloneCanvas.parentNode.replaceChild(img, cloneCanvas);
      });

      var opt = {
        margin:       [10, 10, 10, 10],
        filename:     'NeuroGaze-Analysis-' + new Date().toISOString().slice(0,10) + '.pdf',
        image:        { type: 'png', quality: 1 },
        html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff', allowTaint: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
      };

      html2pdf().set(opt).from(clone).save().then(function() {
        document.body.removeChild(wrapper);
      });
    });

  });
