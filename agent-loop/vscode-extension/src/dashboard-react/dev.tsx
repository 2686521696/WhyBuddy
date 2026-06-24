import { Button, Segmented, Space } from 'antd';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardApp, DashboardDetailApp } from './DashboardApp';
import './dashboard-react.css';
import { previewDetailPayload, previewOverviewPayload } from './devPayload';
import { normalizeSaveSettingsPayload, redactSettingsMessageForLog } from '../settingsMessages';

type PreviewMode = 'detail' | 'overview';

window.__AGENT_LOOP_ASSETS__ = {
  brandLogo: '/media/sliderule-brand.svg',
};
let mockSettings: any = {
  nonSensitive: {
    fixAgent: 'grok',
    reviewAgent: 'codex',
    workerMaxTurns: 128,
    workerMaxRetries: 2,
    queuePath: 'agent-loop/scripts/migration-queue.json',
    worktreeScope: 'queue',
  },
  keys: { grokApiKey: '', openaiApiKey: '', anthropicApiKey: '' },
  baseUrl: '',
  injectToWorker: true,
  queueRunning: false,
  activeProfile: 'local',
  profiles: {
    local: { fixAgent: 'grok', reviewAgent: 'codex' },
    proxy: { fixAgent: 'grok', reviewAgent: 'grok', baseUrl: 'http://127.0.0.1:8080' },
    ci: { fixAgent: 'codex', reviewAgent: 'none', workerMaxTurns: 32 },
  },
};
let mockProfiles: any = {
  profiles: { ...mockSettings.profiles },
  activeProfile: 'local',
};

window.__AGENT_LOOP_VSCODE_API__ = {
  postMessage(message: any) {
    console.info('[AgentLoop preview command]', redactSettingsMessageForLog(message));
    if (message?.type === 'getSettings') {
      // Simulate response
      setTimeout(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', payload: mockSettings } }));
      }, 10);
    }
    if (message?.type === 'saveSettings') {
      const data = normalizeSaveSettingsPayload(message);
      const newKeys = { ...mockSettings.keys };
      if (typeof data.grokApiKey === 'string') {
        newKeys.grokApiKey = data.grokApiKey ? 'configured' : '';
      }
      if (typeof data.openaiApiKey === 'string') {
        newKeys.openaiApiKey = data.openaiApiKey ? 'configured' : '';
      }
      if (typeof data.anthropicApiKey === 'string') {
        newKeys.anthropicApiKey = data.anthropicApiKey ? 'configured' : '';
      }
      const nonSensitiveUpdate: Record<string, unknown> = {};
      const nonSecretKeys = ['fixAgent', 'reviewAgent', 'workerMaxTurns', 'workerMaxRetries', 'queuePath', 'worktreeScope', 'baseUrl', 'injectToWorker'] as const;
      for (const key of nonSecretKeys) {
        if (key in data) {
          nonSensitiveUpdate[key] = data[key];
        }
      }
      mockSettings = {
        ...mockSettings,
        nonSensitive: { ...mockSettings.nonSensitive, ...nonSensitiveUpdate },
        keys: newKeys,
        baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : mockSettings.baseUrl,
        injectToWorker: typeof data.injectToWorker === 'boolean' ? data.injectToWorker : mockSettings.injectToWorker,
        queueRunning: typeof data.queueRunning === 'boolean' ? data.queueRunning : mockSettings.queueRunning,
        activeProfile: mockSettings.activeProfile,
      };
      // respond with updated
      setTimeout(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', payload: mockSettings } }));
      }, 10);
    }
    if (message?.type === 'testProvider') {
      const prov = (message.provider || (message.payload && message.payload.provider) || 'grok') as 'grok' | 'openai' | 'anthropic';
      const keyName = (prov + 'ApiKey') as 'grokApiKey' | 'openaiApiKey' | 'anthropicApiKey';
      const hasKey = mockSettings.keys && mockSettings.keys[keyName] === 'configured';
      setTimeout(() => {
        const payload = hasKey
          ? { provider: prov, status: 'ok', durationMs: 87, reason: 'ok', checkedAt: new Date().toISOString(), duration: 87 }
          : { provider: prov, status: 'skipped', durationMs: 0, reason: 'missing key', checkedAt: new Date().toISOString(), duration: 0 };
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'providerHealth', payload } }));
      }, 10);
    }
    if (message?.type === 'testWorkerCli') {
      const w = (message.worker || (message.payload && message.payload.worker) || 'grok') as 'grok' | 'codex';
      setTimeout(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'workerCliHealth', payload: { worker: w, status: 'ok', durationMs: 17, reason: 'ok' } } }));
      }, 8);
    }
    if (message?.type === 'getQueueDefaults') {
      setTimeout(() => {
        const payload = {
          defaults: { fixAgent: 'grok', reviewAgent: 'codex', workerMaxTurns: 128, workerMaxRetries: 2, skipReview: false, useWorktree: true, worktreeScope: 'queue', maxIterations: 3 },
          supportedKeys: ['fixAgent', 'reviewAgent', 'workerMaxTurns', 'workerMaxRetries', 'skipReview', 'useWorktree', 'worktreeScope', 'maxIterations'],
          queuePath: 'agent-loop/scripts/migration-queue.json',
        };
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'queueDefaults', payload } }));
      }, 5);
    }
    if (message?.type === 'previewQueueDefaults') {
      const proposed = (message && (message.proposed || (message.payload && message.payload.proposed))) || {};
      setTimeout(() => {
        const hasUnsupported = Object.keys(proposed).some((k: string) => ['workerEnv'].includes(k) || !['fixAgent','reviewAgent','workerMaxTurns','workerMaxRetries','skipReview','useWorktree','worktreeScope','maxIterations'].includes(k));
        if (hasUnsupported) {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'queuePreview', payload: { ok: false, error: 'redacted error' } } }));
        } else {
          const before = { fixAgent: 'grok', reviewAgent: 'codex', workerMaxTurns: 128, workerMaxRetries: 2, skipReview: false, useWorktree: true, worktreeScope: 'queue', maxIterations: 3 };
          const after = { ...before, ...proposed };
          const diff = Object.keys(after).filter(k => JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k])).map(k => ({ key: k, before: (before as any)[k], after: (after as any)[k] }));
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'queuePreview', payload: { ok: true, before, after, diff } } }));
        }
      }, 5);
    }
    if (message?.type === 'applyQueueDefaults') {
      const proposed = (message && (message.proposed || (message.payload && message.payload.proposed))) || {};
      setTimeout(() => {
        const hasUnsupported = Object.keys(proposed).some((k: string) => ['workerEnv'].includes(k) || !['fixAgent','reviewAgent','workerMaxTurns','workerMaxRetries','skipReview','useWorktree','worktreeScope','maxIterations'].includes(k));
        if (hasUnsupported) {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'queueApply', payload: { ok: false, error: 'redacted error' } } }));
        } else {
          const before = { fixAgent: 'grok', reviewAgent: 'codex', workerMaxTurns: 128, workerMaxRetries: 2, skipReview: false, useWorktree: true, worktreeScope: 'queue', maxIterations: 3 };
          const after = { ...before, ...proposed };
          const diff = Object.keys(after).filter(k => JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k])).map(k => ({ key: k, before: (before as any)[k], after: (after as any)[k] }));
          const applied = { ...proposed };
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'queueApply', payload: { ok: true, before, after, diff, applied } } }));
          // simulate refresh of current
          setTimeout(() => {
            const payload = { defaults: after, supportedKeys: ['fixAgent','reviewAgent','workerMaxTurns','workerMaxRetries','skipReview','useWorktree','worktreeScope','maxIterations'], queuePath: 'agent-loop/scripts/migration-queue.json' };
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'queueDefaults', payload } }));
          }, 5);
        }
      }, 5);
    }
    if (message?.type === 'exportSettings') {
      setTimeout(() => {
        const exp = {
          schemaVersion: 1,
          activeProfile: mockSettings.activeProfile || 'local',
          profiles: { fixAgent: mockSettings.nonSensitive.fixAgent, reviewAgent: mockSettings.nonSensitive.reviewAgent },
          nonSensitive: { ...mockSettings.nonSensitive, activeProfile: mockSettings.activeProfile || 'local' },
          keys: { ...mockSettings.keys },
        };
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'settingsExported', payload: exp } }));
      }, 5);
    }
    if (message?.type === 'importSettings') {
      const raw = (message && (message.payload || message)) || {};
      setTimeout(() => {
        const ver = raw && raw.schemaVersion;
        let hasSecret = false;
        try {
          const s = JSON.stringify(raw);
          hasSecret = /sk-|Bearer |x-api-key|private key/i.test(s) && !/configured/i.test(s);
        } catch {}
        if (ver !== 1 || hasSecret) {
          const err = ver !== 1 ? 'unsupported schema version' : 'contains secret-looking keys';
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'importSettingsResult', payload: { ok: false, error: err } } }));
        } else {
          // apply non-sensitive only to mock
          const ns = raw.nonSensitive || {};
          const prof = raw.profiles || {};
          if (prof.fixAgent) mockSettings.nonSensitive.fixAgent = prof.fixAgent;
          if (prof.reviewAgent) mockSettings.nonSensitive.reviewAgent = prof.reviewAgent;
          if (raw.activeProfile) mockSettings.activeProfile = raw.activeProfile;
          Object.keys(ns).forEach((k) => {
            if (['fixAgent','reviewAgent','workerMaxTurns','workerMaxRetries','queuePath','worktreeScope','baseUrl','injectToWorker','activeProfile'].includes(k)) {
              (mockSettings.nonSensitive as any)[k] = (ns as any)[k];
            }
          });
          if (ns.activeProfile) mockSettings.activeProfile = ns.activeProfile;
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'importSettingsResult', payload: { ok: true } } }));
          setTimeout(() => {
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', payload: mockSettings } }));
          }, 5);
        }
      }, 5);
    }
    if (message?.type === 'getDiagnostics') {
      setTimeout(() => {
        const payload = {
          generatedAt: new Date().toISOString(),
          effectiveConfig: { fixAgent: 'grok', reviewAgent: 'codex', workerMaxTurns: 128, workerMaxRetries: 2, queuePath: 'agent-loop/scripts/migration-queue.json', worktreeScope: 'queue', baseUrl: '', injectToWorker: true },
          configSources: { fixAgent: 'default', reviewAgent: 'default', workerMaxTurns: 'default', workerMaxRetries: 'default', queuePath: 'default', worktreeScope: 'default', baseUrl: 'default', injectKeysToWorker: 'default' },
          keys: { grokApiKey: 'configured', openaiApiKey: '', anthropicApiKey: '' },
          queuePath: 'agent-loop/scripts/migration-queue.json',
          repoRoot: '/workspace/repo',
          lastRunState: { runId: '2026-06-24Txx', status: 'DONE_REVIEWED', task: 'agent-loop/tasks/demo.md' },
          lastRunStatus: { runId: '2026-06-24Txx', status: 'DONE_REVIEWED', task: 'agent-loop/tasks/demo.md' },
          providerHealth: { grok: { provider: 'grok', status: 'ok', durationMs: 42, reason: 'ok', checkedAt: new Date().toISOString() } },
          warnings: [
            { category: 'ready', message: 'provider key(s) configured' },
            { category: 'ready', message: 'key injection enabled' },
            { category: 'ready', message: 'queue file present at resolved path' },
            { category: 'ready', message: 'last run state: DONE_REVIEWED' },
            { category: 'skipped', message: 'sample skipped warning' },
            { category: 'failed', message: 'sample failed (demo)' },
            { category: 'unknown', message: 'sample unknown' },
          ],
        };
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'diagnostics', payload } }));
      }, 5);
    }
    if (message?.type === 'listProfiles') {
      setTimeout(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'profiles', payload: { ...mockProfiles } } }));
      }, 2);
    }
    if (message?.type === 'createProfile') {
      const nm = (message && (message.name || (message.payload && message.payload.name))) || '';
      const vals = (message && (message.values || (message.payload && message.payload.values))) || {};
      setTimeout(() => {
        const n = String(nm).trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32).replace(/^[-_]+|[-_]+$/g, '');
        if (!n || mockProfiles.profiles[n]) {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'profileError', payload: { error: 'invalid or exists' } } }));
          return;
        }
        const cleaned: any = {};
        ['fixAgent','reviewAgent','workerMaxTurns','workerMaxRetries','worktreeScope','baseUrl','queuePath'].forEach((k) => { if (k in vals) cleaned[k] = vals[k]; });
        mockProfiles.profiles[n] = cleaned;
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'profiles', payload: { ...mockProfiles } } }));
      }, 2);
    }
    if (message?.type === 'renameProfile') {
      const o = (message && (message.oldName || (message.payload && message.payload.oldName))) || '';
      const nn = (message && (message.newName || (message.payload && message.payload.newName))) || '';
      setTimeout(() => {
        const oldN = String(o).trim(); const newN = String(nn).trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,32).replace(/^[-_]+|[-_]+$/g,'');
        if (!oldN || !newN || !mockProfiles.profiles[oldN] || mockProfiles.profiles[newN]) {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'profileError', payload: { error: 'invalid name' } } }));
          return;
        }
        mockProfiles.profiles[newN] = mockProfiles.profiles[oldN];
        delete mockProfiles.profiles[oldN];
        if (mockProfiles.activeProfile === oldN) mockProfiles.activeProfile = newN;
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'profiles', payload: { ...mockProfiles } } }));
      }, 2);
    }
    if (message?.type === 'duplicateProfile') {
      const nm = (message && (message.name || (message.payload && message.payload.name))) || '';
      const nn = (message && (message.newName || (message.payload && message.payload.newName))) || '';
      setTimeout(() => {
        const n = String(nm); const newN = String(nn).trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,32).replace(/^[-_]+|[-_]+$/g,'');
        if (!n || !newN || !mockProfiles.profiles[n] || mockProfiles.profiles[newN]) {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'profileError', payload: { error: 'invalid' } } }));
          return;
        }
        mockProfiles.profiles[newN] = { ...mockProfiles.profiles[n] };
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'profiles', payload: { ...mockProfiles } } }));
      }, 2);
    }
    if (message?.type === 'deleteProfile') {
      const nm = (message && (message.name || (message.payload && message.payload.name))) || '';
      setTimeout(() => {
        const n = String(nm);
        const keys = Object.keys(mockProfiles.profiles);
        if (keys.length <= 1 || !mockProfiles.profiles[n]) {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'profileError', payload: { error: 'cannot delete last or not found' } } }));
          return;
        }
        delete mockProfiles.profiles[n];
        if (mockProfiles.activeProfile === n) {
          mockProfiles.activeProfile = Object.keys(mockProfiles.profiles)[0] || 'local';
        }
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'profiles', payload: { ...mockProfiles } } }));
      }, 2);
    }
    if (message?.type === 'selectProfile') {
      const nm = (message && (message.name || (message.payload && message.payload.name))) || '';
      setTimeout(() => {
        const n = String(nm).trim();
        if (!n || !mockProfiles.profiles[n]) {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'profileError', payload: { error: 'not found' } } }));
          return;
        }
        if (mockSettings.queueRunning) {
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'saveBlocked', payload: { reason: 'queueRunning', message: '队列运行中，禁止切换 profile。' } } }));
          return;
        }
        mockProfiles.activeProfile = n;
        // copy values to current
        const p = mockProfiles.profiles[n] || {};
        mockSettings.activeProfile = n;
        if (p.fixAgent) mockSettings.nonSensitive.fixAgent = p.fixAgent;
        if (p.reviewAgent) mockSettings.nonSensitive.reviewAgent = p.reviewAgent;
        if (p.workerMaxTurns !== undefined) mockSettings.nonSensitive.workerMaxTurns = p.workerMaxTurns;
        if (p.workerMaxRetries !== undefined) mockSettings.nonSensitive.workerMaxRetries = p.workerMaxRetries;
        if (p.worktreeScope) mockSettings.nonSensitive.worktreeScope = p.worktreeScope;
        if (p.baseUrl !== undefined) mockSettings.baseUrl = p.baseUrl;
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'profiles', payload: { ...mockProfiles } } }));
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', payload: mockSettings } }));
      }, 3);
    }
  },
};

function DevDashboard() {
  const [mode, setMode] = useState<PreviewMode>('detail');
  const [devRunning, setDevRunning] = useState(false);

  const toggleRunning = () => {
    const next = !devRunning;
    setDevRunning(next);
    // update mock and push fresh settings so UI reacts to queueRunning (for 107 dev toggle)
    mockSettings = { ...mockSettings, queueRunning: next };
    setTimeout(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', payload: mockSettings } }));
    }, 5);
  };

  return (
    <>
      <div className="native-dev-toolbar">
        <Space>
          <Segmented
            value={mode}
            onChange={(value) => setMode(value as PreviewMode)}
            options={[
              { label: '详情', value: 'detail' },
              { label: '总览', value: 'overview' },
            ]}
          />
          <Button onClick={toggleRunning}>{devRunning ? '停止模拟运行 (queueRunning=false)' : '模拟激活运行 (queueRunning=true)'}</Button>
          <Button onClick={() => window.location.reload()}>刷新预览</Button>
          <span style={{ fontSize: 11, color: '#888' }}>Dev preview mocks 107: settings + health + import/export + diagnostics + queue (no real VSCode/keys/net)</span>
        </Space>
      </div>
      {mode === 'detail'
        ? <DashboardDetailApp payload={previewDetailPayload} />
        : <DashboardApp payload={previewOverviewPayload} />}
    </>
  );
}

createRoot(document.getElementById('app')!).render(<DevDashboard />);
