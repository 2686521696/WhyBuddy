(function () {
  const vscode = acquireVsCodeApi();

  const els = {
    title: document.getElementById('title'),
    subtitle: document.getElementById('subtitle'),
    runBtn: document.getElementById('runBtn'),
    stopBtn: document.getElementById('stopBtn'),
    roles: document.getElementById('roles'),
    status: document.getElementById('status'),
    phase: document.getElementById('phase'),
    elapsed: document.getElementById('elapsed'),
    gate: document.getElementById('gate'),
    agent: document.getElementById('agent'),
    pipeline: document.getElementById('pipeline'),
    log: document.getElementById('log'),
    meta: document.getElementById('meta'),
  };

  const defaultPipelineSteps = [
    { key: 'INIT', label: '初始化' },
    { key: 'PROBED', label: '探测' },
    { key: 'WORKTREE_READY', label: 'Worktree' },
    { key: 'BASELINE_GATE_RESULT', label: '基线 Gate' },
    { key: 'GROK_FIX', label: 'Grok' },
    { key: 'POST_FIX_GATE_RESULT', label: '修复 Gate' },
    { key: 'GROK_REVIEW', label: 'Grok' },
    { key: 'DONE', label: '完成' },
  ];

  function resolveActiveIndex(status, steps) {
    const normalized = status || 'IDLE';
    if (normalized.startsWith('DONE_') || normalized.startsWith('HALT_')) {
      return steps.findIndex((step) => step.key === 'DONE');
    }
    if (normalized === 'BUDGET_LOOP_HEAD') {
      return steps.findIndex((step) => step.key === 'GROK_FIX' || step.key === 'CODEX_FIX');
    }
    const direct = steps.findIndex((step) => step.key === normalized);
    if (direct >= 0) return direct;
    return -1;
  }

  function renderPipeline(status, steps) {
    if (!els.pipeline) return;
    const pipelineSteps = Array.isArray(steps) && steps.length ? steps : defaultPipelineSteps;
    const normalized = status || 'IDLE';
    const done = normalized.startsWith('DONE_') || normalized.startsWith('HALT_');
    const activeIndex = resolveActiveIndex(normalized, pipelineSteps);
    els.pipeline.innerHTML = pipelineSteps.map((step, index) => {
      let cls = 'step';
      if (done && step.key === 'DONE') cls += ' active done';
      else if (activeIndex === index) cls += ' active';
      else if (activeIndex > index) cls += ' done';
      return `<span class="${cls}">${step.label}</span>`;
    }).join('');
  }

  function setGateClass(ok) {
    els.gate.classList.remove('ok', 'warn', 'err');
    if (ok === true) els.gate.classList.add('ok');
    else if (ok === false) els.gate.classList.add('err');
    else els.gate.classList.add('warn');
  }

  function setToolbarState(queueRunning) {
    if (els.runBtn) els.runBtn.disabled = Boolean(queueRunning);
    if (els.stopBtn) els.stopBtn.disabled = !queueRunning;
  }

  function render(snapshot) {
    const status = snapshot?.state?.status || 'IDLE';
    const task = snapshot?.taskLabel || '—';
    setToolbarState(snapshot?.queueRunning);
    els.title.textContent = task;
    els.subtitle.textContent = snapshot?.state?.runId ? `run ${snapshot.state.runId}` : '等待 AgentLoop 运行';
    if (els.roles) {
      const mode = snapshot?.runMode ? `模式 ${snapshot.runMode}` : '';
      const roles = snapshot?.roleText ? `工人/审查 ${snapshot.roleText}` : '';
      els.roles.textContent = [mode, roles].filter(Boolean).join(' · ');
    }
    els.status.textContent = snapshot?.phaseLabel || '空闲';
    els.phase.textContent = status;
    els.elapsed.textContent = snapshot?.elapsedText || '—';
    els.gate.textContent = snapshot?.gateText || '—';
    setGateClass(snapshot?.gateOk);
    els.agent.textContent = snapshot?.agentText || '—';
    els.log.textContent = snapshot?.agentTail || '暂无 agent 输出';
    els.meta.textContent = (snapshot?.details || []).join(' · ');
    renderPipeline(status, snapshot?.pipelineSteps);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type === 'snapshot') {
      render(message.payload);
    }
  });

  if (els.runBtn) {
    els.runBtn.addEventListener('click', () => vscode.postMessage({ type: 'runQueue' }));
  }
  if (els.stopBtn) {
    els.stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stopRun' }));
  }

  vscode.postMessage({ type: 'ready' });
})();