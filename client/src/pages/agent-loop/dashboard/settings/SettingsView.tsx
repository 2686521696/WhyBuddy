import { Tabs, Typography } from 'antd';
import { useMemo } from 'react';
import type { AgentLoopSettingsViewModel } from '../dashboardTypes';
import { CliConfigForm } from './CliConfigPanel';
import { LlmKeyForm } from './LlmKeysPanel';
import { QueueDefaultsView } from './QueueDefaultsPanel';
import { DiagnosticsView } from './DiagnosticsPanel';
import { ProfileCrudView } from './ProfilesPanel';
import { RedactedImportExport } from './RedactedImportExport';
import { SettingsLayout, SettingsPanel } from './SettingsLayout';

const { Text } = Typography;

// The orchestrating SettingsView; delegates panel impl to sibling modules.
export function SettingsView({
  data,
  onSave,
  providerTests,
  onTestProvider,
  workerCliTests,
  onTestWorkerCli,
  queueDefaultsData,
  queuePreview,
  onPreviewQueue,
  queueApply,
  onApplyQueue,
  exportedSettings,
  importResult,
  onExportSettings,
  onImportSettings,
  diagnosticsData,
  onRefreshDiagnostics,
  profilesData,
  onListProfiles,
  onCreateProfile,
  onRenameProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onSelectProfile,
}: {
  data: AgentLoopSettingsViewModel | null;
  onSave: (v: any) => void;
  providerTests?: any[];
  onTestProvider?: (p: string) => void;
  workerCliTests?: any[];
  onTestWorkerCli?: (w: string) => void;
  queueDefaultsData?: any;
  queuePreview?: any;
  onPreviewQueue?: (p: any) => void;
  queueApply?: any;
  onApplyQueue?: (p: any) => void;
  exportedSettings?: any;
  importResult?: any;
  onExportSettings?: () => void;
  onImportSettings?: (text: string) => void;
  diagnosticsData?: any;
  onRefreshDiagnostics?: () => void;
  profilesData?: any;
  onListProfiles?: () => void;
  onCreateProfile?: (n: string, v?: any) => void;
  onRenameProfile?: (o: string, n: string) => void;
  onDuplicateProfile?: (n: string, nn: string) => void;
  onDeleteProfile?: (n: string) => void;
  onSelectProfile?: (n: string) => void;
}) {
  const activeProfile = data?.activeProfile || 'local';
  const fixAgent = data?.fixAgent || '-';
  const reviewAgent = data?.reviewAgent || '-';

  const tabItems = useMemo(() => [
    {
      key: 'cli',
      label: 'CLI 配置',
      children: (
        <SettingsPanel title="CLI 基础配置" description="配置 AgentLoop CLI 的运行参数与工作环境。">
          <CliConfigForm initial={data?.nonSensitive} onSave={onSave} queueRunning={data?.queueRunning} activeProfile={data?.activeProfile} />
        </SettingsPanel>
      ),
    },
    {
      key: 'keys',
      label: 'LLM Keys',
      children: (
        <SettingsPanel title="LLM Keys 状态" description="管理模型提供方状态与本地 Worker CLI 健康检查。">
          <LlmKeyForm initial={data || {}} onSave={onSave} providerTests={providerTests} onTestProvider={onTestProvider} workerCliTests={workerCliTests} onTestWorkerCli={onTestWorkerCli} queueRunning={data?.queueRunning} />
        </SettingsPanel>
      ),
    },
    {
      key: 'queue',
      label: '队列默认值',
      children: (
        <SettingsPanel title="队列默认值" description="预览并应用队列层默认参数，只写入受支持字段。">
          <QueueDefaultsView data={queueDefaultsData} preview={queuePreview} onPreview={onPreviewQueue || (() => {})} applyResult={queueApply} onApply={onApplyQueue || (() => {})} settingsData={data} />
        </SettingsPanel>
      ),
    },
    {
      key: 'diagnostics',
      label: 'Diagnostics',
      children: (
        <SettingsPanel title="Diagnostics（只读）" description="查看运行环境、配置来源与关键能力状态。">
          <DiagnosticsView data={diagnosticsData} onRefresh={onRefreshDiagnostics || (() => {})} />
        </SettingsPanel>
      ),
    },
    {
      key: 'profiles',
      label: 'Profiles',
      children: (
        <SettingsPanel title="Profiles 管理" description="维护不同运行场景的非敏感配置 Profile。">
          <ProfileCrudView
            data={profilesData}
            queueRunning={data?.queueRunning}
            activeProfile={data?.activeProfile}
            onList={onListProfiles || (() => {})}
            onCreate={onCreateProfile || (() => {})}
            onRename={onRenameProfile || (() => {})}
            onDuplicate={onDuplicateProfile || (() => {})}
            onDelete={onDeleteProfile || (() => {})}
            onSelect={onSelectProfile || (() => {})}
          />
        </SettingsPanel>
      ),
    },
  ], [data, onSave, providerTests, onTestProvider, workerCliTests, onTestWorkerCli, queueDefaultsData, queuePreview, onPreviewQueue, queueApply, onApplyQueue, diagnosticsData, onRefreshDiagnostics, profilesData, onListProfiles, onCreateProfile, onRenameProfile, onDuplicateProfile, onDeleteProfile, onSelectProfile]);

  const footer = (
    <SettingsPanel title="设置导入 / 导出（redacted）" description="可导出当前 CLI 配置，或从文件导入配置以快速恢复环境。" className="native-settings-footer-card">
      <RedactedImportExport
        exportedSettings={exportedSettings}
        importResult={importResult}
        onExportSettings={onExportSettings}
        onImportSettings={onImportSettings}
      />
      <Text type="secondary" className="native-settings-safety-note">
        敏感 Key 使用安全存储，导出内容只包含非敏感配置与 key 状态；写入后建议重新加载 CLI 或重新启动运行。
      </Text>
    </SettingsPanel>
  );

  return (
    <SettingsLayout
      title="AgentLoop 设置中心"
      summary={{ activeProfile, fixAgent, reviewAgent }}
      tabs={<Tabs className="native-settings-tabs" defaultActiveKey="cli" items={tabItems} />}
      footer={footer}
    />
  );
}

export default SettingsView;
