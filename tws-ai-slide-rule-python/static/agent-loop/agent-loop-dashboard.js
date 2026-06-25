// AgentLoop Dashboard JS (python owned shell, no CDN, no external webview APIs)
// Fetches documented overview endpoint. Renders empty and error states.

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
        html += '<li><strong>' + String(id) + '</strong> ' + String(st) + task + '</li>';
      }
      html += '</ul>';
      runsEl.innerHTML = html;
    } catch (err) {
      statusEl.innerHTML = '<div class="error">Error loading dashboard: ' + (err && err.message ? err.message : String(err)) + '</div>';
      runsEl.innerHTML = '<p class="empty">Unable to load runs (error state).</p>';
    }
  }

  // initial load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRuns);
  } else {
    loadRuns();
  }

  // expose for manual/debug (browser only)
  window.agentLoopDashboardRefresh = loadRuns;
})();
