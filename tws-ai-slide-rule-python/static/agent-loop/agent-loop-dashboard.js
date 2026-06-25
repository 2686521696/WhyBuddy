// AgentLoop Dashboard JS (python owned shell, no CDN, no external webview APIs)
// Fetches documented overview endpoint. Renders empty and error states.
// Navigation shell 109: active view state via URL hash (location.hash) or documented local state.
// Menu labels (Workbench, Runs, Settings, SlideRule) are stable text for later React/AntD replacement.

(function () {
  'use strict';

  async function loadRuns() {
    var statusEl = document.getElementById('status');
    var runsEl = document.getElementById('runs');
    if (!statusEl || !runsEl) return;

    statusEl.textContent = 'Loading runs...';
    runsEl.innerHTML = '';

    try {
      var res = await fetch('/api/agent-loop/runs/overview');
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      }
      var data = await res.json();
      statusEl.textContent = '';

      if (!Array.isArray(data) || data.length === 0) {
        runsEl.innerHTML = '<p class="empty">No runs yet.</p>';
        return;
      }

      var html = '<ul>';
      for (var i = 0; i < data.length; i++) {
        var r = data[i] || {};
        var id = r.runId || r.id || 'unknown';
        var st = r.status || r.runMode || '';
        var task = r.task ? (' - ' + String(r.task).slice(0, 60)) : '';
        html += '<li data-run-id="' + String(id).replace(/"/g, '') + '" style="cursor:pointer"><strong>' + String(id) + '</strong> ' + String(st) + task + '</li>';
      }
      html += '</ul>';
      runsEl.innerHTML = html;

      // wire clicks for detail view (browser native)
      var items = runsEl.querySelectorAll('li[data-run-id]');
      for (var j = 0; j < items.length; j++) {
        items[j].onclick = function () {
          var rid = this.getAttribute('data-run-id');
          if (rid) loadDetail(rid);
        };
      }
    } catch (err) {
      statusEl.innerHTML = '<div class="error">Error loading dashboard: ' + (err && err.message ? err.message : String(err)) + '</div>';
      runsEl.innerHTML = '<p class="empty">Unable to load runs (error state).</p>';
    }
  }

  async function loadDetail(runId) {
    var detStatus = document.getElementById('detail-status');
    var detId = document.getElementById('detail-id');
    if (detId) detId.textContent = runId || '';
    if (detStatus) detStatus.textContent = 'Loading detail...';

    // activate detail view
    var views = document.querySelectorAll('.view');
    views.forEach(function (v) { v.classList.remove('active'); });
    var detView = document.getElementById('detail');
    if (detView) detView.classList.add('active');

    try {
      var res = await fetch('/api/agent-loop/runs/' + encodeURIComponent(runId));
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      var data = await res.json();
      if (detStatus) detStatus.textContent = '';
      renderDetail(data);
    } catch (err) {
      if (detStatus) detStatus.innerHTML = '<div class="error">Error loading detail: ' + (err && err.message ? err.message : String(err)) + '</div>';
      // still render empty states for sections
      renderDetail(null);
    }
  }

  function renderSection(el, titleFallback, contentHtml, emptyMsg) {
    if (!el) return;
    var body = el.querySelector('.flow-body, .timeline-body, .review-body, .diff-body, .output-body, .artifacts-body') || el;
    if (contentHtml) {
      body.innerHTML = contentHtml;
    } else {
      body.innerHTML = '<p class="empty">' + (emptyMsg || 'No data.') + '</p>';
    }
  }

  function renderDetail(d) {
    if (!d || typeof d !== 'object') d = {};

    // flow: iterations as flow summary
    var flowEl = document.getElementById('flow');
    var iters = Array.isArray(d.iterations) ? d.iterations : [];
    var flowHtml = '';
    if (iters.length > 0) {
      flowHtml = '<ul>' + iters.map(function (it) {
        return '<li>iteration ' + (it && it.iteration != null ? it.iteration : '?') + '</li>';
      }).join('') + '</ul>';
    }
    renderSection(flowEl, '', flowHtml, 'No flow data.');

    // timeline: events
    var tlEl = document.getElementById('timeline');
    var evs = Array.isArray(d.events) ? d.events : [];
    var tlHtml = '';
    if (evs.length > 0) {
      tlHtml = '<ul>' + evs.slice(0, 30).map(function (e) {
        return '<li>' + (e && e.ts ? e.ts + ' ' : '') + (e && e.status ? e.status : '') + '</li>';
      }).join('') + '</ul>';
    }
    renderSection(tlEl, '', tlHtml, 'No timeline data.');

    // review
    var revEl = document.getElementById('review');
    var rev = d.codexReview || d.grokReview || d.agentReview || null;
    var revHtml = '';
    if (rev) {
      try { revHtml = '<pre>' + JSON.stringify(rev, null, 2).slice(0, 800) + '</pre>'; } catch (_) { revHtml = String(rev); }
    }
    renderSection(revEl, '', revHtml, 'No review data.');

    // diff
    var diffEl = document.getElementById('diff');
    var arts = Array.isArray(d.artifacts) ? d.artifacts : [];
    var diffs = arts.filter(function (a) { return a && (a.kind === 'diff' || (a.id || '').indexOf('diff') === 0); });
    var diffHtml = '';
    if (diffs.length > 0) {
      diffHtml = diffs.map(function (a) {
        var c = (a && a.content) ? String(a.content).slice(0, 500) : '';
        return '<pre class="diff">' + c.replace(/</g, '&lt;') + '</pre>';
      }).join('');
    }
    renderSection(diffEl, '', diffHtml, 'No diff output.');

    // agent output (logs, bounded)
    var outEl = document.getElementById('agent-output');
    var logs = arts.filter(function (a) { return a && a.kind === 'log'; });
    var outHtml = '';
    if (logs.length > 0) {
      outHtml = logs.map(function (a) {
        var c = (a && a.content) ? String(a.content).slice(0, 400).replace(/</g, '&lt;') : '';
        return '<div class="log">' + (a.id || 'log') + ':<br><pre>' + c + '</pre></div>';
      }).join('');
    }
    renderSection(outEl, '', outHtml, 'No agent output.');

    // artifacts (do not duplicate if center already; here this is the artifacts section)
    var artEl = document.getElementById('artifacts');
    var artHtml = '';
    if (arts.length > 0) {
      artHtml = '<ul>' + arts.map(function (a) {
        return '<li>' + (a && a.id ? a.id : '?') + ' (' + (a && a.kind ? a.kind : '') + ')</li>';
      }).join('') + '</ul>';
    }
    renderSection(artEl, '', artHtml, 'No artifacts.');
  }

  function setActiveView() {
    // Active view state represented in URL hash
    var hash = (location.hash || '#runs').replace('#', '');
    var views = document.querySelectorAll('.view');
    var navLinks = document.querySelectorAll('#nav-shell a[data-nav]');
    views.forEach(function (v) { v.classList.remove('active'); });
    navLinks.forEach(function (n) { n.classList.remove('active'); });

    var target = document.getElementById(hash);
    if (!target) target = document.getElementById('runs');
    if (target) target.classList.add('active');

    var activeLink = document.querySelector('#nav-shell a[data-nav="' + (target ? target.id : 'runs') + '"]');
    if (activeLink) activeLink.classList.add('active');

    if (target && target.id === 'runs') {
      loadRuns();
    }
    // detail activated via loadDetail click (not auto-reload on hash alone to avoid unbound); back uses #runs
  }

  // initial load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setActiveView();
      // also support direct loadRuns for any legacy buttons
      if (typeof loadRuns === 'function' && !location.hash) loadRuns();
    });
  } else {
    setActiveView();
  }

  window.addEventListener('hashchange', setActiveView);

  // expose for manual/debug (browser only)
  window.agentLoopDashboardRefresh = loadRuns;
  window.loadRuns = loadRuns;
  window.loadDetail = loadDetail;
  // documented local state: setActiveView reads/writes .active classes + location.hash
})();
