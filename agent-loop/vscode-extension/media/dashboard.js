(function () {
  const OUTCOME_META = {
    done: { icon: 'OK', label: '完成', cls: 'ok' },
    failed: { icon: 'FAIL', label: '失败', cls: 'err' },
    crashed: { icon: 'ERR', label: '崩溃', cls: 'err' },
    quarantined: { icon: 'HOLD', label: '隔离', cls: 'warn' },
    running: { icon: 'RUN', label: '运行中', cls: 'run' },
    stale: { icon: 'STALE', label: '运行中断', cls: 'stale' },
    pending: { icon: 'WAIT', label: '待跑', cls: 'idle' },
    disabled: { icon: 'OFF', label: '已禁用', cls: 'idle' },
  };

  const HALT_GUIDANCE = {
    HALT_NO_SUCCESS_CRITERIA: '任务缺少非空的成功标准。补齐判定标准后再入队。',
    HALT_BUDGET: '达到最大修复轮次后仍未通过。可以提高 max iterations 重跑，或人工接手。',
    HALT_NO_PROGRESS: '修复后 gate 仍红，并且有效失败数没有下降。请打开 gate 日志人工核对。',
    HALT_NO_CHANGES: '修复 agent 运行了，但没有产生有效 diff。请检查任务描述或 agent 输出。',
    HALT_AGENT_NOT_FOUND: '本次运行需要的 agent 没有找到。',
    HALT_HUMAN: '需要人工接管：可能是审查 blocked、agent 失败或超时。',
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function metaFor(key) {
    return OUTCOME_META[key] || OUTCOME_META.pending;
  }

  function countValue(counts, key) {
    return Number(counts && counts[key]) || 0;
  }

  function renderToolbar(queueRunning) {
    const run = queueRunning ? '' : '<button class="btn primary" data-act="runQueue" title="运行队列">运行队列</button>';
    const stop = queueRunning ? '<button class="btn danger" data-act="stopRun" title="停止当前运行">停止</button>' : '';
    return `<div class="toolbar">${run}${stop}<button class="btn ghost" data-act="refresh" title="刷新">刷新</button></div>`;
  }

  function renderConsoleHeader(title, subtitle, queueRunning, back) {
    const backButton = back ? '<button class="back" data-act="showOverview">← 队列</button>' : '';
    return `<div class="console-head">
      <div class="title-stack">
        ${backButton}
        <h1>${esc(title)}</h1>
        <div class="muted">${esc(subtitle || '')}</div>
      </div>
      ${renderToolbar(queueRunning)}
    </div>`;
  }

  function renderQueueStats(counts) {
    const order = ['done', 'failed', 'crashed', 'quarantined', 'running', 'pending'];
    return `<div class="stat-grid">${order.map((key) => {
      const meta = metaFor(key);
      return `<div class="stat ${meta.cls}" data-state="${key}">
        <span class="stat-value">${countValue(counts, key)}</span>
        <span class="stat-label">${meta.label}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function renderCurrentRunBanner(current) {
    if (!current) {
      return '<div class="notice neutral"><b>空闲</b><span>当前没有活动运行。</span></div>';
    }
    const stale = Boolean(current.staleRun);
    const cls = stale ? 'stale' : 'run';
    const status = stale ? '运行中断' : current.phaseLabel;
    return `<div class="notice ${cls}" data-state="${stale ? 'stale' : 'running'}">
      <b>${esc(status)}</b>
      <span>${esc(current.taskLabel)} / ${esc(current.elapsedText || '-')}</span>
    </div>`;
  }

  function renderProgress(counts) {
    const total = countValue(counts, 'total');
    const settled = countValue(counts, 'done') + countValue(counts, 'failed') + countValue(counts, 'crashed') + countValue(counts, 'quarantined');
    const pct = total ? Math.round((settled / total) * 100) : 0;
    return `<div class="progress-row">
      <div class="progress-meta"><span>已有结果</span><b>${settled}/${total}</b></div>
      <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
    </div>`;
  }

  function renderTaskTable(tasks) {
    const rows = (tasks || []).map((task) => {
      const badge = task.stale ? 'stale' : task.badge;
      const meta = metaFor(badge);
      const active = task.running ? ' active' : '';
      const enabled = task.enabled === false ? ' disabled' : '';
      const status = task.statusLabel || meta.label;
      return `<button class="queue-row${active}${enabled}" data-act="openTask" data-task="${esc(task.task)}" data-state="${esc(badge || 'pending')}">
        <span class="status-pill ${meta.cls}">${meta.icon}</span>
        <span class="task-name">${esc(task.taskLabel || task.task)}</span>
        <span class="task-status">${esc(status)}</span>
      </button>`;
    }).join('');

    return `<section class="panel queue-table">
      <div class="panel-head"><h2>任务队列</h2><span class="muted">${(tasks || []).length} 项</span></div>
      <div class="queue-head"><span>状态</span><span>任务</span><span>最近结果</span></div>
      <div class="queue-body">${rows || '<div class="empty">队列为空，请检查 migration-queue.json。</div>'}</div>
    </section>`;
  }

  function renderOverviewInspector(current, tasks) {
    const selected = current || {};
    const stale = Boolean(selected.staleRun);
    const activeTask = (tasks || []).find((task) => task.running || task.stale) || (tasks || [])[0] || null;
    const title = selected.taskLabel || activeTask?.taskLabel || activeTask?.task || '等待选择任务';
    const state = stale ? '运行中断' : (selected.phaseLabel || activeTask?.statusLabel || '暂无活动运行');
    const badge = stale ? 'stale' : (activeTask?.badge || 'pending');
    const meta = metaFor(badge);
    return `<aside class="overview-inspector">
      <section class="panel inspector-card">
        <div class="panel-head"><h2>任务快照</h2><span class="status-pill ${meta.cls}">${meta.icon}</span></div>
        <div class="inspector-title">${esc(title)}</div>
        <div class="inspector-state ${stale ? 'stale' : ''}">${esc(state)}</div>
        <dl class="inspector-list">
          <div><dt>耗时</dt><dd>${esc(selected.elapsedText || '-')}</dd></div>
          <div><dt>最近结果</dt><dd>${esc(activeTask?.statusLabel || meta.label)}</dd></div>
          <div><dt>队列状态</dt><dd>${stale ? '旧 run 未更新' : '等待操作'}</dd></div>
        </dl>
      </section>
    </aside>`;
  }

  function renderOverview(payload) {
    const counts = payload.counts || { total: 0 };
    return `<main class="dashboard console-overview">
      ${renderConsoleHeader('AgentLoop 控制台', `${counts.total || 0} 个任务 / queue health`, payload.queueRunning, false)}
      ${renderQueueStats(counts)}
      ${renderProgress(counts)}
      ${renderCurrentRunBanner(payload.current)}
      <section class="workbench-split">
        ${renderTaskTable(payload.tasks || [])}
        ${renderOverviewInspector(payload.current, payload.tasks || [])}
      </section>
    </main>`;
  }

  function resolveActiveIndex(status, steps) {
    const normalized = status || 'IDLE';
    if (normalized === 'STALE_INTERRUPTED') return steps.findIndex((step) => step.key === 'DONE');
    if (normalized.startsWith('DONE_') || normalized.startsWith('HALT_')) return steps.findIndex((step) => step.key === 'DONE');
    if (normalized === 'BUDGET_LOOP_HEAD' || normalized === 'REVIEW_NEEDS_CHANGES') {
      return steps.findIndex((step) => step.key === 'GROK_FIX' || step.key === 'CODEX_FIX');
    }
    return steps.findIndex((step) => step.key === normalized);
  }

  function renderPipeline(status, steps) {
    const list = Array.isArray(steps) && steps.length ? steps : [];
    const terminal = (status || '').startsWith('DONE_') || (status || '').startsWith('HALT_') || status === 'STALE_INTERRUPTED';
    const activeIndex = resolveActiveIndex(status, list);
    const items = list.map((step, index) => {
      let cls = 'timeline-step';
      if (terminal && step.key === 'DONE') cls += ' active done';
      else if (activeIndex === index) cls += ' active';
      else if (activeIndex > index) cls += ' done';
      const marker = cls.includes('done') ? '✓' : '';
      return `<span class="${cls}"><span class="timeline-dot">${marker}</span><span class="timeline-label">${esc(step.label)}</span></span>`;
    }).join('');
    return `<section class="timeline">${items}</section>`;
  }

  function gateClass(ok) {
    if (ok === true) return 'ok';
    if (ok === false) return 'err';
    return 'warn';
  }

  function landingClass(status) {
    if (status === 'COMMITTED' || status === 'MAIN_GATE_GREEN') return 'ok';
    if (status === 'APPLIED_TO_MAIN') return 'warn';
    return 'idle';
  }

  function renderMetric(label, value, cls) {
    return `<div class="metric ${cls || ''}"><span>${esc(label)}</span><b>${esc(value || '-')}</b></div>`;
  }

  function renderStatusCards(payload) {
    const landing = payload.landing || { status: 'PENDING_APPLY' };
    const policy = payload.guardPolicy || payload.finalReport?.guardPolicy || null;
    return `<section class="metric-grid">
      ${renderMetric('阶段', payload.phaseLabel)}
      ${renderMetric('状态码', payload.status, payload.status === 'STALE_INTERRUPTED' ? 'stale' : '')}
      ${renderMetric('耗时', payload.elapsedText)}
      ${renderMetric('Gate', payload.gateText, gateClass(payload.gateOk))}
      ${renderMetric('Agent', payload.agentText)}
      ${renderMetric('落地状态', landing.status, landingClass(landing.status))}
      ${renderMetric('护栏', policy ? '已加载' : '默认测试护栏')}
    </section>`;
  }

  function renderEvidence(payload) {
    const landing = payload.landing || {};
    const details = (payload.details || []).map((line) => `<li>${esc(line)}</li>`).join('');
    const commit = landing.commit ? `<li>commit: <code>${esc(landing.commit)}</code></li>` : '';
    return `<section class="panel evidence">
      <div class="panel-head"><h2>证据</h2><span class="muted">${esc(payload.runMode || '-')}</span></div>
      <ul class="evidence-list">
        <li>runId: <code>${esc(payload.runId || '-')}</code></li>
        <li>gate: ${esc(payload.gateText || '-')}</li>
        <li>landing: ${esc(landing.status || 'PENDING_APPLY')}</li>
        ${commit}
        ${details}
      </ul>
    </section>`;
  }

  function renderHalt(payload) {
    if (!payload.halt && payload.status !== 'STALE_INTERRUPTED') return '';
    if (payload.status === 'STALE_INTERRUPTED') {
      return `<section class="notice stale"><b>运行中断</b><span>这个 run 长时间没有更新，面板不会继续把它当作正在运行。</span></section>`;
    }
    const status = payload.halt.status;
    const reason = payload.halt.reason ? ` / ${payload.halt.reason}` : '';
    return `<section class="notice err"><b>${esc(status)}${esc(reason)}</b><span>${esc(HALT_GUIDANCE[status] || '运行已停止，请打开 state.json 或报告查看原因。')}</span></section>`;
  }

  function renderIterations(iterations) {
    const rows = (iterations || []).map((it) => {
      const gate = it.gateOk === true ? '<span class="tag ok">Gate 绿</span>'
        : it.gateOk === false ? `<span class="tag err">Gate 红${it.failureCount != null ? ` (${it.failureCount})` : ''}</span>`
        : '<span class="tag warn">Gate 未跑</span>';
      const kb = it.diffBytes ? `${Math.max(1, Math.round(it.diffBytes / 1024))}KB` : '0';
      const guard = it.guard ? '<span class="tag err">护栏命中</span>' : '';
      return `<div class="evidence-row"><span class="idx">#${esc(it.iteration)}</span>${gate}<span class="tag">diff ${kb}</span><span class="tag">尝试 ${esc(it.attempts || 0)}</span>${guard}</div>`;
    }).join('');
    return `<section class="panel iterations"><div class="panel-head"><h2>修复迭代</h2></div>${rows || '<div class="empty">没有修复迭代。</div>'}</section>`;
  }

  function verdictClass(decision, verdict) {
    if (decision === 'pass' || verdict === 'pass') return 'ok';
    if (decision === 'needs_changes' || verdict === 'needs_changes') return 'warn';
    return 'err';
  }

  function renderReviewRounds(rounds) {
    const cards = (rounds || []).map((round) => {
      const findings = (round.findings || []).map((finding) =>
        `<li><span class="sev ${esc(finding.severity || '')}">${esc(finding.severity || '?')}</span> <code>${esc(finding.path || '-')}</code> ${esc(finding.message || '')}</li>`,
      ).join('');
      return `<article class="review">
        <div class="review-head"><span class="tag ${verdictClass(round.decision, round.verdict)}">${esc(round.verdict || round.decision || '?')}</span><span class="muted">第 ${esc(round.round)} 轮</span></div>
        ${round.summary ? `<p>${esc(round.summary)}</p>` : ''}
        ${findings ? `<ul class="findings">${findings}</ul>` : ''}
      </article>`;
    }).join('');
    return `<section class="panel"><div class="panel-head"><h2>Review</h2></div>${cards || '<div class="empty">没有审查轮次。</div>'}</section>`;
  }

  function renderAgentLog(payload) {
    const log = formatAgentLog(payload.agentTail || '暂无输出');
    const codeClass = log.language === 'json' ? ' log-json wrap' : '';
    return `<section class="panel log-panel">
      <div class="panel-head"><h2>Agent 最新输出</h2><span class="muted">${payload.agentLogKb ? `${payload.agentLogKb}KB` : ''}</span></div>
      <pre class="log${codeClass}">${log.html}</pre>
    </section>`;
  }

  function formatAgentLog(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return { language: 'text', html: '' };
    try {
      const parsed = JSON.parse(text);
      return { language: 'json', html: highlightJson(JSON.stringify(parsed, null, 2)) };
    } catch {
      // Keep plain logs unchanged.
    }
    return { language: 'text', html: esc(text) };
  }

  function highlightJson(json) {
    return json.replace(
      /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (match, stringToken, colon, literal) => {
        if (stringToken) {
          const cls = colon ? 'key' : 'string';
          return `<span class="json-token ${cls}">${esc(stringToken)}</span>${colon || ''}`;
        }
        if (literal) return `<span class="json-token literal">${esc(literal)}</span>`;
        return `<span class="json-token number">${esc(match)}</span>`;
      },
    );
  }

  function renderLinks(payload) {
    const links = [
      payload.reportPath ? ['openReport', payload.reportPath, '最终报告'] : null,
      payload.reportJsonPath ? ['openReport', payload.reportJsonPath, '结构化报告'] : null,
      payload.landingPath ? ['openReport', payload.landingPath, '落地状态'] : null,
      payload.statePath ? ['openState', payload.statePath, 'state.json'] : null,
    ].filter(Boolean);
    if (!links.length) return '';
    return `<div class="links">${links.map(([act, file, label]) =>
      `<button class="btn ghost" data-act="${act}" data-path="${esc(file)}">${esc(label)}</button>`,
    ).join('')}</div>`;
  }

  function renderDetail(payload) {
    const subtitle = `${payload.runId || '等待运行'} / ${payload.runMode || '-'} / ${payload.roleText || ''}`;
    return `<main class="dashboard run-detail">
      <section class="detail-hero">
        ${renderConsoleHeader(payload.taskLabel || '-', subtitle, false, true)}
      </section>
      ${renderPipeline(payload.status, payload.pipelineSteps)}
      ${renderHalt(payload)}
      ${renderStatusCards(payload)}
      <section class="detail-main-grid">
        <div class="detail-column detail-side-column">
          ${renderEvidence(payload)}
          ${renderIterations(payload.iterations)}
        </div>
        <div class="detail-column detail-wide-column">
          ${renderReviewRounds(payload.reviewRounds)}
        </div>
      </section>
      ${renderAgentLog(payload)}
      ${renderLinks(payload)}
    </main>`;
  }

  const renderer = { renderOverview, renderDetail };
  window.AgentLoopDashboardRenderer = renderer;

  const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage: () => {} };
  if (!app) return;

  app.addEventListener('click', (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.getAttribute('data-act');
    if (act === 'openTask') {
      vscode.postMessage({ type: 'openTask', taskPath: target.getAttribute('data-task') });
    } else if (act === 'openReport') {
      vscode.postMessage({ type: 'openReport', reportPath: target.getAttribute('data-path') });
    } else if (act === 'openState') {
      vscode.postMessage({ type: 'openState', statePath: target.getAttribute('data-path') });
    } else {
      vscode.postMessage({ type: act });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'overview') {
      app.innerHTML = renderOverview(message.payload || {});
    } else if (message?.type === 'detail') {
      app.innerHTML = renderDetail(message.payload || {});
    }
  });

  app.innerHTML = '<main class="dashboard"><div class="empty">加载中...</div></main>';
  vscode.postMessage({ type: 'ready' });
})();
