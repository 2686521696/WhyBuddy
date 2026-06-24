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
      };
      // respond with updated
      setTimeout(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'settings', payload: mockSettings } }));
      }, 10);
    }
  },
};

function DevDashboard() {
  const [mode, setMode] = useState<PreviewMode>('detail');

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
          <Button onClick={() => window.location.reload()}>刷新预览</Button>
          <span style={{ fontSize: 11, color: '#888' }}>(总览模式下可通过左侧菜单进入“设置”测试表单)</span>
        </Space>
      </div>
      {mode === 'detail'
        ? <DashboardDetailApp payload={previewDetailPayload} />
        : <DashboardApp payload={previewOverviewPayload} />}
    </>
  );
}

createRoot(document.getElementById('app')!).render(<DevDashboard />);
