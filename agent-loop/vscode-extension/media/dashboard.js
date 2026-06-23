(function () {
  const OUTCOME_META = {
    rescuePatch: { icon: 'PATCH', label: '可救补丁', cls: 'warn' },
    done: { icon: 'OK', label: '完成', cls: 'ok' },
    applied: { icon: 'OK', label: '已落地', cls: 'ok' },
    reviewed: { icon: 'REV', label: '已审查', cls: 'ok' },
    noDiff: { icon: 'NO_DIFF', label: '无新增差异', cls: 'neutral' },
    manualRescueLanded: { icon: 'RESCUE', label: '人工救回', cls: 'ok' },
    applyConflict: { icon: 'APPLY', label: '应用冲突', cls: 'warn' },
    human: { icon: 'HUMAN', label: '人工接管', cls: 'warn' },
    failed: { icon: 'FAIL', label: '失败', cls: 'err' },
    crashed: { icon: 'ERR', label: '崩溃', cls: 'err' },
    quarantined: { icon: 'HOLD', label: '隔离', cls: 'warn' },
    stopped: { icon: 'STOP', label: '已停止', cls: 'warn' },
    running: { icon: 'RUN', label: '运行中', cls: 'run' },
    stale: { icon: 'STALE', label: '运行中断', cls: 'stale' },
    pending: { icon: 'WAIT', label: '待跑', cls: 'idle' },
    disabled: { icon: 'OFF', label: '已禁用', cls: 'idle' },
  };

  const CATEGORY_META = {
    attention: { label: '需关注', cls: 'err' },
    running: { label: '进行中', cls: 'run' },
    landed: { label: '已落地', cls: 'ok' },
    pending: { label: '待跑', cls: 'neutral' },
    disabled: { label: '已禁用', cls: 'idle' },
  };
  const CATEGORY_ORDER = ['attention', 'running', 'landed', 'pending', 'disabled'];

  let lastOverviewPayload = null;
  let activeFilter = 'queue';
  let activeDetailTab = 'review';
  let activeEventFilter = 'all';
  let eventSearchQuery = '';
  let lastDetailPayload = null;
  let lastDetailIdentity = null;
  const ASSETS = window.__AGENT_LOOP_ASSETS__ || {};

  const HALT_GUIDANCE = {
    RESCUE_PATCH_AVAILABLE: '已有可救补丁：worker 产出了 diff，但 gate/review 未完成，需要人工接手修补。',
    QUEUE_VERIFIED_NO_DIFF: '队列已复核，没有新的 diff 需要落地。',
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

  function renderBrandMark() {
    const brandLogo = ASSETS.brandLogo || 'media/sliderule-brand.svg';
    return `<span class="brand-mark" aria-label="SlideRule" role="img">
      <img src="${esc(brandLogo)}" alt="" loading="eager" />
    </span>`;
  }

  function renderConsoleHeader(title, subtitle, queueRunning, back) {
    const backButton = back ? '<button class="back" data-act="showOverview">← 队列</button>' : '';
    return `<div class="console-head console-top">
      <div class="header-brand">
        ${renderBrandMark()}
        <div class="title-stack">
          ${backButton}
          <h1>${esc(title)}</h1>
          <div class="muted">${esc(subtitle || '')}</div>
        </div>
      </div>
      ${renderToolbar(queueRunning)}
    </div>`;
  }

  function groupTasks(tasks) {
    const groups = { attention: [], running: [], landed: [], pending: [], disabled: [] };
    for (const task of (tasks || [])) {
      const cat = groups[task.category] ? task.category : 'pending';
      groups[cat].push(task);
    }
    return groups;
  }

  function queueTasks(tasks) {
    return (tasks || []).filter((task) => task.enabled !== false);
  }

  function groupTotal(groups) {
    return CATEGORY_ORDER.reduce((sum, cat) => sum + groups[cat].length, 0);
  }

  function renderTriageFilters(groups, allTasks, queueItems, counts) {
    const total = countValue(counts, 'total') || groupTotal(groups);
    const queueTotal = countValue(counts, 'queueTotal') || queueItems.length;
    const categoryCounts = {
      attention: countValue(counts, 'human')
        + countValue(counts, 'failed')
        + countValue(counts, 'crashed')
        + countValue(counts, 'quarantined')
        + countValue(counts, 'applyConflict')
        + countValue(counts, 'stopped')
        || groups.attention.length,
      running: countValue(counts, 'running') || groups.running.length,
      landed: countValue(counts, 'applied')
        + countValue(counts, 'reviewed')
        + countValue(counts, 'noDiff')
        + countValue(counts, 'manualRescueLanded')
        || groups.landed.length,
      pending: countValue(counts, 'pending') || groups.pending.length,
      disabled: countValue(counts, 'disabled') || groups.disabled.length,
    };
    const queue = `<button class="filter-tab queue${activeFilter === 'queue' ? ' active' : ''}" data-filter="queue">
      <span class="filter-label">任务队列</span><span class="filter-count">${queueTotal}</span>
    </button>`;
    const all = `<button class="filter-tab all${activeFilter === 'all' ? ' active' : ''}" data-filter="all">
      <span class="filter-label">全部</span><span class="filter-count">${total}</span>
    </button>`;
    const cards = CATEGORY_ORDER.map((cat) => {
      const meta = CATEGORY_META[cat];
      return `<button class="filter-tab ${meta.cls}${activeFilter === cat ? ' active' : ''}" data-filter="${cat}">
        <span class="filter-label">${meta.label}</span><span class="filter-count">${categoryCounts[cat]}</span>
      </button>`;
    }).join('');
    return `<div class="filter-tabs">${queue}${all}${cards}</div>`;
  }

  function renderAttentionBanner(groups) {
    const n = groups.attention.length;
    if (!n || activeFilter === 'attention') return '';
    return `<button class="attention-banner" data-filter="attention">
      <b>${n} 个任务需要你关注</b><span>点击只看这些 →</span>
    </button>`;
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

  function settledCount(counts) {
    return countValue(counts, 'applied')
      + countValue(counts, 'reviewed')
      + countValue(counts, 'noDiff')
      + countValue(counts, 'manualRescueLanded')
      + countValue(counts, 'applyConflict')
      + countValue(counts, 'human')
      + countValue(counts, 'failed')
      + countValue(counts, 'crashed')
      + countValue(counts, 'quarantined')
      + countValue(counts, 'stopped');
  }

  function renderProgress(counts) {
    const total = countValue(counts, 'total');
    const settled = settledCount(counts);
    const pct = total ? Math.round((settled / total) * 100) : 0;
    return `<div class="progress-row">
      <div class="progress-meta"><span>已有结果</span><b>${settled}/${total}</b></div>
      <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
    </div>`;
  }

  function taskAgentLabel(task) {
    return task.agent || task.agentText || task.roleText || task.fixAgent || 'Codex';
  }

  function taskDiffLabel(task) {
    const bytes = Number(task.diffBytes || task.diffSize || 0);
    if (bytes) return formatBytes(bytes);
    if (task.hasDiff || task.applyStatus) return '有 diff';
    if (task.outcomeGroup === 'reviewed' || task.outcomeGroup === 'applied' || task.outcomeGroup === 'manualRescueLanded' || task.badge === 'reviewed' || task.badge === 'applied' || task.badge === 'manualRescueLanded') return '有 diff';
    return '-';
  }

  function taskUpdatedLabel(task) {
    return task.lastUpdatedText || task.updatedText || task.updatedAt || task.lastUpdatedAt || '-';
  }

  function renderTaskRow(task) {
    const badge = task.stale ? 'stale' : task.badge;
    const meta = metaFor(badge);
    const active = task.running ? ' active' : '';
    const disabled = task.enabled === false ? ' disabled' : '';
    const status = task.statusLabel || meta.label;
    const conflictFiles = (task.applyErrorFiles || task.worktreeErrorFiles || []).slice(0, 2).join(', ');
    const applyError = task.applyError || task.applyErrorKind || '';
    const extra = [
      conflictFiles ? `<span class="task-extra">${esc(conflictFiles)}</span>` : '',
      applyError ? `<span class="task-extra error">${esc(applyError)}</span>` : '',
    ].join('');
    const reEnable = task.autoDisabled
      ? `<button class="row-action" data-act="reEnable" data-id="${esc(task.id || task.task)}" title="清除自动禁用，下次队列重试">重开</button>`
      : '';
    return `<div class="queue-row${active}${disabled}" data-task="${esc(task.task)}" data-state="${esc(badge || 'pending')}">
      <span class="status-pill ${meta.cls}">${meta.icon}</span>
      <span class="task-name"><b>${esc(task.taskLabel || task.task)}</b><small>${esc(status)}${extra}</small></span>
      <span class="task-agent">${esc(taskAgentLabel(task))}</span>
      <span class="task-diff">${esc(taskDiffLabel(task))}</span>
      <span class="task-updated">${esc(taskUpdatedLabel(task))}</span>
      <span class="task-actions"><button class="row-open" data-act="openTask" data-task="${esc(task.task)}">打开</button>${reEnable}<button class="row-more" aria-label="更多">···</button></span>
    </div>`;
  }

  function renderGroupSection(cat, tasks) {
    if (!tasks.length) return '';
    const meta = CATEGORY_META[cat];
    return `<section class="task-group">
      <div class="group-head"><span class="group-dot ${meta.cls}"></span><h2>${meta.label}</h2><span class="muted">${tasks.length}</span></div>
      <div class="group-body">${tasks.map(renderTaskRow).join('')}</div>
    </section>`;
  }

  function renderQueueSections(tasks) {
    const queueGroups = groupTasks(queueTasks(tasks));
    const sections = CATEGORY_ORDER.map((cat) => renderGroupSection(cat, queueGroups[cat])).filter(Boolean).join('');
    return renderTaskTable(queueTasks(tasks), '本次任务队列为空，请检查 enabled 任务。');
  }

  function renderTaskList(groups, tasks) {
    if (activeFilter === 'queue') {
      return renderQueueSections(tasks);
    }
    if (activeFilter !== 'all') {
      const tasks = groups[activeFilter] || [];
      const meta = CATEGORY_META[activeFilter];
      return renderTaskTable(tasks, `这个分组暂时没有任务。`, meta ? meta.label : '任务');
    }
    return renderTaskTable(tasks, '队列为空，请检查 migration-queue.json。');
  }

  function renderTaskTable(tasks, emptyText, title) {
    const rows = (tasks || []).map(renderTaskRow).join('');
    const heading = title ? `<div class="panel-head"><h2>${esc(title)}</h2><span class="muted">${tasks.length} 项</span></div>` : '';
    return `<section class="panel queue-table task-table">
      ${heading}
      <div class="queue-head"><span>状态</span><span>任务名</span><span>Agent</span><span>变更</span><span>最后更新</span><span>操作</span></div>
      <div class="queue-body">${rows || `<div class="empty">${esc(emptyText)}</div>`}</div>
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

  function renderLanding(landing) {
    if (!landing || landing.status === 'QUEUE_VERIFIED_NO_DIFF') return '';
    if (Number(landing.diffBytes || 0) <= 0 && landing.status === 'PENDING_QUEUE_LANDING') return '';
    if (landing.status !== 'PENDING_QUEUE_LANDING' && !landing.appliedToMain) return '';
    const kb = landing.diffBytes ? `${Math.max(1, Math.round(landing.diffBytes / 1024))}KB` : '0';
    const taskCount = landingPatchCount(landing);
    const attentionCount = landingAttentionCount(landing);
    const branch = landing.currentBranch || landing.branch || landing.targetBranch || 'main';
    const attentionNote = attentionCount > 0
      ? `<span class="landing-note">${attentionCount} 个需关注任务未包含在补丁中</span>`
      : '';
    if (landing.appliedToMain) {
      return `<section class="landing landing-banner done">
        <div class="landing-branch"><span>当前分支</span><b>${esc(branch)}</b></div>
        <div class="landing-info"><b>已落地到 main</b><span>${taskCount} 个成功合并 · ${kb} diff</span>${attentionNote}</div>
      </section>`;
    }
    return `<section class="landing landing-banner pending">
      <div class="landing-branch"><span>当前分支</span><b>${esc(branch)}</b></div>
      <div class="landing-info"><b>待落地到 main</b><span>${taskCount} 个成功合并 · ${kb} diff</span>${attentionNote}</div>
      <div class="landing-actions">
        <button class="btn ghost" data-act="previewLanding" title="git apply --check 预演">预演</button>
        <button class="btn primary" data-act="applyLanding" title="确认后 git apply 到 main">落地到 main</button>
      </div>
    </section>`;
  }

  function landingPatchCount(landing) {
    const counted = Number(landing?.taskCounts?.patch);
    if (Number.isFinite(counted)) return counted;
    if (Array.isArray(landing?.patchTasks)) return landing.patchTasks.length;
    if (Array.isArray(landing?.tasks)) {
      const done = landing.tasks.filter((task) => task.outcome === 'done').length;
      return done || landing.tasks.length;
    }
    return 0;
  }

  function landingAttentionCount(landing) {
    const counted = Number(landing?.taskCounts?.failed);
    if (Number.isFinite(counted)) return counted;
    if (Array.isArray(landing?.tasks)) {
      return landing.tasks.filter((task) => task.outcome && task.outcome !== 'done').length;
    }
    return 0;
  }

  function renderQueueToolbar(groups, tasks, queued, counts) {
    const total = groupTotal(groups);
    return `<section class="queue-toolbar">
      <input class="queue-search" data-focus-key="queue-search" type="search" placeholder="搜索任务 / Agent / 文件..." aria-label="搜索任务" />
      ${renderTriageFilters(groups, tasks, queued, counts)}
      <div class="queue-tools" aria-label="任务筛选">
        <button class="tool-chip">按更新时间</button>
        <button class="tool-chip">有 diff</button>
        <button class="tool-chip">仅 REV</button>
      </div>
    </section>`;
  }

  function renderQueueSummary(groups, counts, queueTotal) {
    const total = countValue(counts, 'total') || groupTotal(groups);
    const settled = settledCount(counts);
    const landed = countValue(counts, 'applied') + countValue(counts, 'reviewed') + countValue(counts, 'noDiff') + countValue(counts, 'manualRescueLanded') || groups.landed.length;
    const attention = countValue(counts, 'human')
      + countValue(counts, 'failed')
      + countValue(counts, 'crashed')
      + countValue(counts, 'quarantined')
      + countValue(counts, 'applyConflict')
      + countValue(counts, 'stopped')
      || groups.attention.length;
    const disabled = countValue(counts, 'disabled') || groups.disabled.length;
    const pct = total ? Math.round((settled / total) * 100) : 0;
    return `<section class="queue-summary">
      <div class="queue-summary-title">任务队列 ${queueTotal} · 全部 ${total} · 需关注 ${attention} · 已落地 ${landed} · 已禁用 ${disabled}</div>
      <div class="queue-progress">
        <span>已运行 ${settled}/${total}</span>
        <div class="progress mini"><div class="bar" style="width:${pct}%"></div></div>
      </div>
    </section>`;
  }

  function renderOverview(payload) {
    const counts = payload.counts || { total: 0 };
    const tasks = payload.tasks || [];
    const groups = groupTasks(tasks);
    const queued = queueTasks(tasks);
    const queueTotal = Number.isFinite(Number(counts.queueTotal)) ? Number(counts.queueTotal) : queued.length;
    return `<main class="dashboard console-overview">
      ${renderConsoleHeader('AgentLoop 控制台', `${queueTotal} 个队列任务 / ${counts.total || 0} 个全部任务`, payload.queueRunning, false)}
      ${renderAttentionBanner(groups)}
      ${renderLanding(payload.landing)}
      ${renderQueueToolbar(groups, tasks, queued, counts)}
      ${renderQueueSummary(groups, counts, queueTotal)}
      ${renderCurrentRunBanner(payload.current)}
      ${renderTaskList(groups, tasks)}
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

  function renderDetailStageRail(status, steps) {
    const list = Array.isArray(steps) && steps.length ? steps : [
      { key: 'INIT', label: 'Init' },
      { key: 'WORKSPACE', label: 'Workspace' },
      { key: 'WORKTREE', label: 'Worktree' },
      { key: 'BASELINE_GATE_RESULT', label: 'Gate' },
      { key: 'CODEX_FIX', label: 'Codex' },
      { key: 'POST_FIX_GATE_RESULT', label: 'testGate' },
      { key: 'DONE', label: 'Done' },
    ];
    const terminal = (status || '').startsWith('DONE_') || (status || '').startsWith('HALT_') || status === 'STALE_INTERRUPTED';
    const activeIndex = Math.max(0, resolveActiveIndex(status, list));
    const items = list.map((step, index) => {
      let cls = 'stage-node';
      if (terminal && step.key === 'DONE') cls += ' current done';
      else if (activeIndex === index) cls += ' current';
      else if (activeIndex > index) cls += ' done';
      if ((status || '').startsWith('HALT_') && activeIndex === index) cls += ' halt';
      const marker = cls.includes('done') ? '✓' : index + 1;
      return `<div class="${cls}">
        <span class="stage-dot">${esc(marker)}</span>
        <span class="stage-label">${esc(step.label)}</span>
      </div>`;
    }).join('');
    return `<section class="detail-stage-rail">${items}</section>`;
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

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return '0';
    if (n < 1024) return `${n}B`;
    return `${Math.max(1, Math.round(n / 1024))}KB`;
  }

  function totalDiffBytes(iterations) {
    return (iterations || []).reduce((sum, it) => sum + (Number(it.diffBytes) || 0), 0);
  }

  function renderRunKpi(label, value, icon, cls) {
    return `<div class="run-kpi ${cls || ''}">
      <span class="kpi-icon">${esc(icon)}</span>
      <span class="kpi-label">${esc(label)}</span>
      <b>${esc(value || '-')}</b>
    </div>`;
  }

  function renderRunKpiCards(payload) {
    const landing = payload.landing || { status: 'PENDING_APPLY' };
    const diffSize = payload.hasDiff
      ? formatBytes((payload.diffText || '').length || totalDiffBytes(payload.iterations))
      : formatBytes(totalDiffBytes(payload.iterations));
    return `<section class="run-kpi-grid">
      ${renderRunKpi('状态', payload.status || payload.phaseLabel || '-', '✓', payload.status === 'STALE_INTERRUPTED' ? 'warn' : gateClass(payload.gateOk))}
      ${renderRunKpi('耗时', payload.elapsedText || '-', '◷')}
      ${renderRunKpi('变更', diffSize, '□')}
      ${renderRunKpi('Agent', payload.agentText || payload.roleText || '-', '▤')}
      ${renderRunKpi('门控', payload.gateText || '-', '♢', gateClass(payload.gateOk))}
      ${renderRunKpi('落地', landing.status || '-', '↧', landingClass(landing.status))}
    </section>`;
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

  function renderDetailActionButtons(payload) {
    const action = payload.taskPath
      ? `<button class="btn primary" data-act="runTask" data-task="${esc(payload.taskPath)}" title="只跑这一条任务（不改 main）">单跑此任务</button>`
      : '';
    const links = [
      payload.reportPath ? ['openReport', payload.reportPath, '最终报告'] : null,
      payload.reportJsonPath ? ['openReport', payload.reportJsonPath, '结构化报告'] : null,
      payload.landingPath ? ['openReport', payload.landingPath, '落地状态'] : null,
      payload.statePath ? ['openState', payload.statePath, 'state.json'] : null,
    ].filter(Boolean);
    const fileButtons = links.map(([act, file, label]) =>
      `<button class="btn ghost" data-act="${act}" data-path="${esc(file)}">${esc(label)}</button>`,
    ).join('');
    return `${action}${fileButtons}<button class="btn ghost" data-act="refresh" title="刷新">刷新</button>`;
  }

  function renderDetailHeader(payload) {
    const task = payload.taskLabel || '-';
    const repo = payload.repo || 'github.com/acme/backend-python';
    const commit = payload.landing?.commit || payload.commit || '-';
    const started = payload.startedAt || payload.runId || '等待运行';
    return `<section class="detail-hero v2">
      <div class="detail-hero-brand">
        ${renderBrandMark()}
        <button class="btn ghost detail-back" data-act="showOverview" title="返回队列"><span class="btn-icon">←</span><span>队列</span></button>
        <div class="detail-breadcrumbs"><span>Projects</span><span>SlideRule</span><span>Runs</span><span>${esc(task)}</span></div>
      </div>
      <div class="detail-titlebar">
        <div class="detail-title-copy">
          <h1>${esc(task)}</h1>
          <div class="detail-meta">Started ${esc(started)} · Repo: ${esc(repo)} · Commit: ${esc(commit)}</div>
        </div>
        <div class="detail-actions">${renderDetailActionButtons(payload)}</div>
      </div>
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

  function normalizeDetailTab(tab) {
    return ['review', 'diff', 'agent', 'artifacts'].includes(tab) ? tab : 'review';
  }

  function tabButtonClass(active, tab) {
    return active === tab ? 'tab active' : 'tab';
  }

  function paneClass(base, active, tab) {
    return active === tab ? `${base} active` : base;
  }

  function renderReviewPane(payload, activeTab) {
    const rounds = payload.reviewRounds || [];
    const latest = rounds[rounds.length - 1] || null;
    const needsAttention = payload.halt || payload.status === 'STALE_INTERRUPTED' || latest?.decision === 'needs_changes' || latest?.verdict === 'needs_changes';
    const attention = needsAttention
      ? `<div class="attention-box"><b>需要关注</b><ul><li>${esc(payload.halt?.status || payload.status || 'Review')}</li><li>${esc(latest?.summary || '请检查 Review、Gate 和 Agent 输出。')}</li></ul></div>`
      : '';
    const reviewJson = {
      runId: payload.runId || null,
      status: payload.status || null,
      gate: payload.gateText || null,
      landing: payload.landing?.status || null,
      reviewRounds: rounds,
    };
    return `<section class="${paneClass('workbench-pane review-pane', activeTab, 'review')}" data-pane="review">
      ${attention}
      ${renderReviewRounds(rounds)}
      <div class="json-box"><div class="code-title">Review Data (JSON)</div><pre class="log log-json wrap" data-scroll-key="review-json">${highlightJson(JSON.stringify(reviewJson, null, 2))}</pre></div>
    </section>`;
  }

  function renderDiffPane(payload, activeTab) {
    const note = payload.diffTruncated ? '<span class="muted">已截断</span>' : '';
    const body = payload.hasDiff
      ? `<pre class="log diff" data-scroll-key="diff">${highlightDiff(payload.diffText || '')}</pre>`
      : '<div class="empty">没有捕获到 diff。</div>';
    return `<section class="${paneClass('workbench-pane diff-pane', activeTab, 'diff')}" data-pane="diff">
      <div class="pane-head"><h2>Diff</h2>${note}</div>
      ${body}
    </section>`;
  }

  function renderAgentPane(payload, activeTab) {
    const log = formatAgentLog(payload.agentTail || '暂无输出');
    const codeClass = log.language === 'json' ? ' log-json wrap' : '';
    return `<section class="${paneClass('workbench-pane agent-pane', activeTab, 'agent')}" data-pane="agent">
      <div class="pane-head"><h2>Agent 输出</h2><span class="muted">${payload.agentLogKb ? `${payload.agentLogKb}KB` : ''}</span></div>
      <pre class="log${codeClass}" data-scroll-key="agent-log">${log.html}</pre>
    </section>`;
  }

  function renderArtifactsPane(payload, activeTab) {
    const links = [
      payload.reportPath ? ['openReport', payload.reportPath, 'final-report.md'] : null,
      payload.reportJsonPath ? ['openReport', payload.reportJsonPath, 'final-report.json'] : null,
      payload.landingPath ? ['openReport', payload.landingPath, 'landing.json'] : null,
      payload.statePath ? ['openState', payload.statePath, 'state.json'] : null,
    ].filter(Boolean);
    const buttons = links.map(([act, file, label]) =>
      `<button class="artifact-row" data-act="${act}" data-path="${esc(file)}"><span>${esc(label)}</span><code>${esc(file)}</code></button>`,
    ).join('');
    return `<section class="${paneClass('workbench-pane artifacts-pane', activeTab, 'artifacts')}" data-pane="artifacts">
      <div class="pane-head"><h2>Artifacts</h2><span class="muted">${links.length}</span></div>
      ${buttons || '<div class="empty">没有可打开的产物。</div>'}
    </section>`;
  }

  function renderDetailTabs(payload) {
    const activeTab = normalizeDetailTab(payload.activeTab);
    return `<section class="panel detail-tabs">
      <div class="workbench-tabs" role="tablist">
        <button class="${tabButtonClass(activeTab, 'review')}" data-tab="review">Review</button>
        <button class="${tabButtonClass(activeTab, 'diff')}" data-tab="diff">Diff</button>
        <button class="${tabButtonClass(activeTab, 'agent')}" data-tab="agent">Agent 输出</button>
        <button class="${tabButtonClass(activeTab, 'artifacts')}" data-tab="artifacts">Artifacts</button>
      </div>
      <div class="tab-panes">
        ${renderReviewPane(payload, activeTab)}
        ${renderDiffPane(payload, activeTab)}
        ${renderAgentPane(payload, activeTab)}
        ${renderArtifactsPane(payload, activeTab)}
      </div>
    </section>`;
  }

  function renderAgentLog(payload) {
    const log = formatAgentLog(payload.agentTail || '暂无输出');
    const codeClass = log.language === 'json' ? ' log-json wrap' : '';
    return `<section class="panel log-panel">
      <div class="panel-head"><h2>Agent 最新输出</h2><span class="muted">${payload.agentLogKb ? `${payload.agentLogKb}KB` : ''}</span></div>
      <pre class="log${codeClass}" data-scroll-key="agent-log">${log.html}</pre>
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
    const action = payload.taskPath
      ? `<button class="btn primary" data-act="runTask" data-task="${esc(payload.taskPath)}" title="只跑这一条任务（不改 main）">单跑此任务</button>`
      : '';
    const fileButtons = links.map(([act, file, label]) =>
      `<button class="btn ghost" data-act="${act}" data-path="${esc(file)}">${esc(label)}</button>`,
    ).join('');
    if (!action && !fileButtons) return '';
    return `<div class="links">${action}${fileButtons}</div>`;
  }

  function highlightDiff(text) {
    return esc(text).split('\n').map((line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="diff-add">${line}</span>`;
      if (line.startsWith('-') && !line.startsWith('---')) return `<span class="diff-del">${line}</span>`;
      if (line.startsWith('@@')) return `<span class="diff-hunk">${line}</span>`;
      if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
        return `<span class="diff-meta">${line}</span>`;
      }
      return line;
    }).join('\n');
  }

  function renderDiffPanel(payload) {
    if (!payload.hasDiff) return '';
    const note = payload.diffTruncated ? '<span class="muted">已截断</span>' : '';
    return `<section class="panel log-panel">
      <div class="panel-head"><h2>改动 diff</h2>${note}</div>
      <pre class="log diff" data-scroll-key="diff">${highlightDiff(payload.diffText || '')}</pre>
    </section>`;
  }

  function renderGatePanel(payload) {
    if (!payload.gateFailure) return '';
    const note = payload.gateFailureTruncated ? '<span class="muted">尾部截断</span>' : '';
    return `<section class="panel log-panel">
      <div class="panel-head"><h2>失败 Gate 输出</h2>${note}</div>
      <pre class="log" data-scroll-key="gate-output">${esc(payload.gateFailure)}</pre>
    </section>`;
  }

  function eventDotClass(status) {
    if (status.startsWith('DONE_')) return 'ok';
    if (status.startsWith('HALT_') || status === 'STALE_INTERRUPTED') return 'err';
    if (status.endsWith('_FIX') || status.endsWith('_REVIEW') || status === 'BUDGET_LOOP_HEAD' || status === 'REVIEW_NEEDS_CHANGES') return 'run';
    return 'neutral';
  }

  function normalizeEventFilter(filter) {
    return ['all', 'errors', 'gate', 'review'].includes(filter) ? filter : 'all';
  }

  function eventMatchesFilter(event, filter) {
    const status = String(event?.status || '');
    const label = String(event?.label || '');
    if (filter === 'errors') return status.startsWith('HALT_') || status === 'STALE_INTERRUPTED';
    if (filter === 'gate') return status.includes('GATE') || /gate/i.test(label);
    if (filter === 'review') return status.includes('REVIEW') || /review/i.test(label);
    return true;
  }

  function eventMatchesSearch(event, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      event?.status,
      event?.label,
      event?.timeText,
      event?.iteration ? `#${event.iteration}` : '',
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  }

  function filterEvents(events, filter, query) {
    const active = normalizeEventFilter(filter);
    return (events || []).filter((event) => eventMatchesFilter(event, active) && eventMatchesSearch(event, query));
  }

  function renderEventStream(events) {
    if (!events || !events.length) return '';
    const rows = events.map((e) => {
      const meta = [e.status, e.iteration ? `#${e.iteration}` : ''].filter(Boolean).join(' ');
      return `<div class="ev-row">
        <span class="ev-time">${esc(e.timeText || '')}</span>
        <span class="ev-dot ${eventDotClass(e.status || '')}"></span>
        <span class="ev-label">${esc(e.label || e.status || '')}</span>
        <span class="ev-meta">${esc(meta)}</span>
      </div>`;
    }).join('');
    return `<section class="panel event-stream">
      <div class="panel-head"><h2>运行事件流</h2><span class="muted">${events.length}</span></div>
      <div class="ev-body">${rows}</div>
    </section>`;
  }

  function renderEventWorkbench(events, options = {}) {
    const active = normalizeEventFilter(options.activeEventFilter || activeEventFilter);
    const query = String(options.eventSearchQuery ?? eventSearchQuery ?? '');
    const visibleEvents = filterEvents(events || [], active, query);
    const rows = visibleEvents.map((e) => {
      const meta = [e.status, e.iteration ? `#${e.iteration}` : ''].filter(Boolean).join(' ');
      return `<div class="ev-row" data-event-status="${esc(e.status || '')}" data-event-label="${esc(e.label || '')}">
        <span class="ev-time">${esc(e.timeText || '')}</span>
        <span class="ev-dot ${eventDotClass(e.status || '')}"></span>
        <span class="ev-label">${esc(e.label || e.status || '')}</span>
        <span class="ev-meta">${esc(meta)}</span>
      </div>`;
    }).join('');
    const chipClass = (filter, extra = '') => `chip${extra ? ` ${extra}` : ''}${active === filter ? ' active' : ''}`;
    return `<section class="panel event-workbench">
      <div class="event-toolbar">
        <input class="event-search" data-event-search data-focus-key="event-search" type="search" value="${esc(query)}" placeholder="搜索事件..." aria-label="搜索事件" />
        <button class="${chipClass('all')}" data-event-filter="all">All</button>
        <button class="${chipClass('errors', 'err')}" data-event-filter="errors">Errors</button>
        <button class="${chipClass('gate', 'ok')}" data-event-filter="gate">Gate</button>
        <button class="${chipClass('review')}" data-event-filter="review">Review</button>
      </div>
      <div class="ev-body">${rows || '<div class="empty">没有匹配事件。</div>'}</div>
    </section>`;
  }

  function renderDetail(payload) {
    return `<main class="dashboard run-detail detail-shell">
      ${renderDetailHeader(payload)}
      ${renderDetailStageRail(payload.status, payload.pipelineSteps)}
      ${renderHalt(payload)}
      ${renderRunKpiCards(payload)}
      <section class="detail-workbench">
        <div class="workbench-left">
          ${renderEventWorkbench(payload.events, {
            activeEventFilter: payload.activeEventFilter || activeEventFilter,
            eventSearchQuery: payload.eventSearchQuery ?? eventSearchQuery,
          })}
          ${renderEvidence(payload)}
          ${renderIterations(payload.iterations)}
        </div>
        <div class="workbench-right">
          ${renderDetailTabs(payload)}
        </div>
      </section>
      ${renderGatePanel(payload)}
    </main>`;
  }

  function captureScrollPositions(root, doc) {
    const scrollRoot = doc || document;
    const scroller = scrollRoot.scrollingElement || scrollRoot.documentElement;
    const positions = { page: scroller ? scroller.scrollTop : 0, panels: {}, focus: null };
    if (!root || typeof root.querySelectorAll !== 'function') return positions;
    for (const element of root.querySelectorAll('[data-scroll-key]')) {
      const key = element.getAttribute('data-scroll-key');
      if (key) positions.panels[key] = element.scrollTop || 0;
    }
    const active = scrollRoot.activeElement;
    if (active && typeof active.getAttribute === 'function') {
      const key = active.getAttribute('data-focus-key');
      if (key) {
        positions.focus = {
          key,
          value: typeof active.value === 'string' ? active.value : '',
          selectionStart: Number.isFinite(active.selectionStart) ? active.selectionStart : null,
          selectionEnd: Number.isFinite(active.selectionEnd) ? active.selectionEnd : null,
        };
      }
    }
    return positions;
  }

  function restoreScrollPositions(root, positions, doc) {
    const scrollRoot = doc || document;
    const scroller = scrollRoot.scrollingElement || scrollRoot.documentElement;
    if (scroller && positions) scroller.scrollTop = positions.page || 0;
    if (!root || !positions || typeof root.querySelectorAll !== 'function') return;
    for (const element of root.querySelectorAll('[data-scroll-key]')) {
      const key = element.getAttribute('data-scroll-key');
      if (key && Object.prototype.hasOwnProperty.call(positions.panels || {}, key)) {
        element.scrollTop = positions.panels[key] || 0;
      }
    }
    if (positions.focus && typeof root.querySelector === 'function') {
      const target = root.querySelector(`[data-focus-key="${positions.focus.key}"]`);
      if (target) {
        if (typeof target.value === 'string') target.value = positions.focus.value || '';
        if (
          typeof target.setSelectionRange === 'function'
          && positions.focus.selectionStart != null
          && positions.focus.selectionEnd != null
        ) {
          target.setSelectionRange(positions.focus.selectionStart, positions.focus.selectionEnd);
        }
        if (typeof target.focus === 'function') target.focus({ preventScroll: true });
      }
    }
  }

  function createRenderScheduler(options) {
    const renderNow = options.renderNow;
    const now = options.now || (() => Date.now());
    const idleMs = options.idleMs || 350;
    const setTimer = options.setTimeoutFn || ((fn, delay) => setTimeout(fn, delay));
    const clearTimer = options.clearTimeoutFn || ((timer) => clearTimeout(timer));
    let lastUserScrollAt = -Infinity;
    let pendingHtml = null;
    let pendingTimer = null;

    function clearPendingTimer() {
      if (pendingTimer != null) {
        clearTimer(pendingTimer);
        pendingTimer = null;
      }
    }

    function flushPending() {
      pendingTimer = null;
      if (pendingHtml == null) return;
      const html = pendingHtml;
      pendingHtml = null;
      renderNow(html);
    }

    function armPendingTimer(delay) {
      clearPendingTimer();
      pendingTimer = setTimer(flushPending, Math.max(0, delay));
    }

    function markUserScroll() {
      lastUserScrollAt = now();
      if (pendingHtml != null) armPendingTimer(idleMs);
    }

    function schedule(html, opts) {
      const force = Boolean(opts && opts.force);
      const elapsed = now() - lastUserScrollAt;
      const activeScroll = Number.isFinite(elapsed) && elapsed < idleMs;
      if (force || !activeScroll) {
        pendingHtml = null;
        clearPendingTimer();
        renderNow(html);
        return 'rendered';
      }
      pendingHtml = html;
      armPendingTimer(idleMs - elapsed);
      return 'deferred';
    }

    return { markUserScroll, schedule, flushPending };
  }

  const renderer = { renderOverview, renderDetail };
  window.AgentLoopDashboardRenderer = renderer;
  window.AgentLoopDashboardInternals = { captureScrollPositions, restoreScrollPositions, createRenderScheduler, filterEvents, normalizeEventFilter };

  const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage: () => {} };
  if (!app) return;

  function setAppHtml(html) {
    const scrollPositions = captureScrollPositions(app, document);
    app.innerHTML = html;
    restoreScrollPositions(app, scrollPositions, document);
  }

  const renderScheduler = createRenderScheduler({ renderNow: setAppHtml });
  let currentViewType = null;

  function scheduleAppHtml(html, viewType, force) {
    const changedView = currentViewType !== viewType;
    currentViewType = viewType;
    renderScheduler.schedule(html, { force: Boolean(force || changedView) });
  }

  function rerenderOverview() {
    if (lastOverviewPayload) scheduleAppHtml(renderOverview(lastOverviewPayload), 'overview', true);
  }

  function rerenderDetail(force = true) {
    if (!lastDetailPayload) return;
    scheduleAppHtml(renderDetail({
      ...lastDetailPayload,
      activeTab: activeDetailTab,
      activeEventFilter,
      eventSearchQuery,
    }), 'detail', force);
  }

  function markUserScroll() {
    renderScheduler.markUserScroll();
  }

  app.addEventListener('wheel', markUserScroll, { passive: true });
  app.addEventListener('touchmove', markUserScroll, { passive: true });
  app.addEventListener('scroll', markUserScroll, true);

  app.addEventListener('click', (event) => {
    const tabEl = event.target.closest('[data-tab]');
    if (tabEl) {
      const tabs = tabEl.closest('.detail-tabs');
      const next = tabEl.getAttribute('data-tab');
      if (tabs && next) {
        activeDetailTab = normalizeDetailTab(next);
        for (const button of tabs.querySelectorAll('[data-tab]')) {
          button.classList.toggle('active', button === tabEl);
        }
        for (const pane of tabs.querySelectorAll('[data-pane]')) {
          pane.classList.toggle('active', pane.getAttribute('data-pane') === next);
        }
      }
      return;
    }
    const eventFilterEl = event.target.closest('[data-event-filter]');
    if (eventFilterEl) {
      activeEventFilter = normalizeEventFilter(eventFilterEl.getAttribute('data-event-filter'));
      rerenderDetail();
      return;
    }
    const filterEl = event.target.closest('[data-filter]');
    if (filterEl) {
      const next = filterEl.getAttribute('data-filter');
      activeFilter = (activeFilter === next && next !== 'queue') ? 'queue' : next;
      rerenderOverview();
      return;
    }
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.getAttribute('data-act');
    if (act === 'openTask') {
      vscode.postMessage({ type: 'openTask', taskPath: target.getAttribute('data-task') });
    } else if (act === 'reEnable') {
      vscode.postMessage({ type: 'reEnable', taskId: target.getAttribute('data-id') });
    } else if (act === 'runTask') {
      vscode.postMessage({ type: 'runTask', task: target.getAttribute('data-task') });
    } else if (act === 'openReport') {
      vscode.postMessage({ type: 'openReport', reportPath: target.getAttribute('data-path') });
    } else if (act === 'openState') {
      vscode.postMessage({ type: 'openState', statePath: target.getAttribute('data-path') });
    } else {
      vscode.postMessage({ type: act });
    }
  });

  app.addEventListener('input', (event) => {
    const search = event.target.closest('[data-event-search]');
    if (!search) return;
    eventSearchQuery = search.value || '';
    rerenderDetail();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'overview') {
      lastOverviewPayload = message.payload || {};
      scheduleAppHtml(renderOverview(lastOverviewPayload), 'overview', false);
    } else if (message?.type === 'detail') {
      lastOverviewPayload = null;
      const detailPayload = message.payload || {};
      const identity = detailPayload.taskPath || detailPayload.taskLabel || detailPayload.runId || null;
      if (identity !== lastDetailIdentity) {
        activeDetailTab = 'review';
        activeEventFilter = 'all';
        eventSearchQuery = '';
        lastDetailIdentity = identity;
      }
      lastDetailPayload = detailPayload;
      scheduleAppHtml(renderDetail({
        ...detailPayload,
        activeTab: activeDetailTab,
        activeEventFilter,
        eventSearchQuery,
      }), 'detail', false);
    }
  });

  app.innerHTML = '<main class="dashboard"><div class="empty">加载中...</div></main>';
  vscode.postMessage({ type: 'ready' });
})();
