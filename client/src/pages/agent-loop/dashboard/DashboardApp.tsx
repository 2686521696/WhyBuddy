import {
  CheckCircleFilled,
  ClockCircleOutlined,
  DownloadOutlined,
  FileDoneOutlined,
  LeftOutlined,
  PlayCircleFilled,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  SnippetsOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Graph, type GraphData } from '@antv/g6';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Menu,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useRef, useState } from 'react';

export type ViewKey = 'workbench' | 'settings';
import type { DetailPayload, OverviewPayload, OverviewTask } from './dashboardTypes';
import { postCommand } from './bridge';

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;

const PAGE_SIZE = 6;
const CATEGORY_ORDER = ['queue', 'all', 'attention', 'running', 'landed', 'pending', 'disabled'] as const;

type FilterKey = typeof CATEGORY_ORDER[number];

const FILTER_LABELS: Record<FilterKey, string> = {
  queue: '任务队列',
  all: '全部任务',
  attention: '需关注',
  running: '进行中',
  landed: '已落地',
  pending: '待跑',
  disabled: '已禁用',
};

const STATUS_TONE: Record<string, string> = {
  done: 'success',
  applied: 'success',
  reviewed: 'success',
  manualRescueLanded: 'success',
  noDiff: 'default',
  running: 'processing',
  pending: 'default',
  disabled: 'default',
  stale: 'warning',
  stopped: 'warning',
  applyConflict: 'warning',
  rescuePatch: 'warning',
  human: 'warning',
  failed: 'error',
  crashed: 'error',
  quarantined: 'warning',
};

const CODE_TOKEN_CLASS_NAMES: Record<string, string> = {
  key: 'native-code-token native-code-key',
  string: 'native-code-token native-code-string',
  number: 'native-code-token native-code-number',
  boolean: 'native-code-token native-code-boolean',
  null: 'native-code-token native-code-null',
  punctuation: 'native-code-token native-code-punctuation',
};

function countValue(counts: OverviewPayload['counts'], key: string): number {
  return Number(counts?.[key]) || 0;
}

function queueTasks(tasks: OverviewTask[]): OverviewTask[] {
  return tasks.filter((task) => task.enabled !== false);
}

function taskCategory(task: OverviewTask): FilterKey {
  if (task.running) return 'running';
  if (task.enabled === false) return 'disabled';
  if (task.category && CATEGORY_ORDER.includes(task.category as FilterKey)) {
    return task.category as FilterKey;
  }
  const badge = task.outcomeGroup || task.badge || task.outcome || 'pending';
  if (['failed', 'crashed', 'quarantined', 'stale', 'human', 'rescuePatch', 'applyConflict', 'stopped'].includes(badge)) {
    return 'attention';
  }
  if (['done', 'applied', 'reviewed', 'manualRescueLanded', 'noDiff'].includes(badge)) {
    return 'landed';
  }
  return 'pending';
}

function statusColor(task: OverviewTask): string {
  return STATUS_TONE[task.outcomeGroup || task.badge || task.outcome || 'pending'] || 'default';
}

function statusLabel(task: OverviewTask): string {
  if (task.statusLabel) return task.statusLabel;
  const key = task.outcomeGroup || task.badge || task.outcome || 'pending';
  const labels: Record<string, string> = {
    done: '完成',
    applied: '已落地',
    reviewed: '已审查',
    noDiff: '无新增 diff',
    manualRescueLanded: '人工救回',
    running: '运行中',
    pending: '待跑',
    disabled: '已禁用',
    stale: '运行中断',
    stopped: '已停止',
    applyConflict: '应用冲突',
    rescuePatch: '可救援补丁',
    human: '人工接管',
    failed: '失败',
    crashed: '崩溃',
    quarantined: '隔离',
  };
  return labels[key] || key;
}

function taskLabel(task: OverviewTask): string {
  return task.taskLabel || task.task.split('/').pop()?.replace(/\.md$/, '') || task.task;
}

function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes) || 0;
  if (value <= 0) return '-';
  if (value < 1024) return `${value} B`;
  return `${Math.round(value / 1024)} KB`;
}

function formatAgentPair(task: OverviewTask): string {
  const parts = [task.fixAgent, task.reviewAgent]
    .filter(Boolean)
    .map((agent) => titleCaseAgent(agent, ''));
  return parts.length > 0 ? parts.join(' / ') : '-';
}

function sumDiffBytes(iterations: Array<Record<string, unknown>>): number {
  return iterations.reduce((sum, iteration) => sum + (Number(iteration.diffBytes) || 0), 0);
}

function compactText(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function jsonPreview(value: unknown): string {
  if (typeof value === 'string') return value || '暂无内容';
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function statusTone(status: string | null | undefined): 'success' | 'processing' | 'warning' | 'error' | 'default' {
  const text = String(status || '').toLowerCase();
  if (text.includes('done') || text.includes('green') || text.includes('pass')) return 'success';
  if (text.includes('fix') || text.includes('review') || text.includes('run')) return 'processing';
  if (text.includes('halt') || text.includes('pending') || text.includes('stale')) return 'warning';
  if (text.includes('fail') || text.includes('crash') || text.includes('red')) return 'error';
  return 'default';
}

function titleCaseAgent(value: unknown, fallback: string): string {
  const text = compactText(value, fallback).toLowerCase();
  if (!text || text === '-') return fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function blockCount(payload: DetailPayload): number {
  const statusBlock = String(payload.status || '').startsWith('HALT_') || payload.status === 'STALE_INTERRUPTED' ? 1 : 0;
  const eventBlocks = (payload.events || []).filter((event) => {
    const status = String(event.status || '').toUpperCase();
    return status.startsWith('HALT_') || status.includes('FAIL') || status.includes('ERROR');
  }).length;
  return Math.max(statusBlock, eventBlocks);
}

function filterTasks(tasks: OverviewTask[], filter: FilterKey, query: string): OverviewTask[] {
  const base = filter === 'queue'
    ? queueTasks(tasks)
    : filter === 'all'
      ? tasks
      : tasks.filter((task) => taskCategory(task) === filter);
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return base;
  return base.filter((task) => {
    const haystack = [
      task.id,
      task.task,
      task.taskLabel,
      task.statusLabel,
      task.outcome,
      task.outcomeGroup,
      task.agent,
      task.fixAgent,
      task.reviewAgent,
      task.branch,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(trimmed);
  });
}

function filterCount(tasks: OverviewTask[], filter: FilterKey, counts: OverviewPayload['counts']): number {
  if (filter === 'queue') return countValue(counts, 'queueTotal') || queueTasks(tasks).length;
  if (filter === 'all') return countValue(counts, 'total') || tasks.length;
  return tasks.filter((task) => taskCategory(task) === filter).length;
}

function BrandMark() {
  const brandLogo = window.__AGENT_LOOP_ASSETS__?.brandLogo || 'media/sliderule-brand.svg';
  return (
    <span className="native-brand-mark" aria-label="SlideRule" role="img">
      <img src={brandLogo} alt="" />
    </span>
  );
}

function DashboardSidebar({ currentView, onViewChange }: { currentView: ViewKey; onViewChange: (view: ViewKey) => void }) {
  return (
    <Sider width={224} theme="light" className="native-sidebar">
      <div className="native-brand">
        <BrandMark />
      </div>
      <Menu
        mode="inline"
        selectedKeys={[currentView]}
        onClick={(info) => {
          const key = info.key as ViewKey;
          if (key === 'workbench' || key === 'settings') {
            onViewChange(key);
          }
        }}
        items={[
          { key: 'workbench', label: '工作台' },
          { key: 'settings', label: '设置' },
        ]}
      />
    </Sider>
  );
}

function OverviewHeader({ payload }: { payload: OverviewPayload }) {
  const queueRunning = Boolean(payload.queueRunning);
  const queueTotal = countValue(payload.counts, 'queueTotal') || queueTasks(payload.tasks || []).length;
  const total = countValue(payload.counts, 'total') || (payload.tasks || []).length;

  return (
    <Card>
      <Row align="middle" justify="space-between" gutter={[16, 16]}>
        <Col flex="auto">
          <Title level={3}>AgentLoop 控制台</Title>
          <Text type="secondary">{queueTotal} 个队列任务 / {total} 个全部任务</Text>
        </Col>
        <Col>
          <Space wrap>
            <Tag color={queueRunning ? 'processing' : 'default'}>{queueRunning ? '运行中' : '待命'}</Tag>
            {queueRunning ? (
              <Button danger onClick={() => postCommand('stopRun')}>停止</Button>
            ) : (
              <Button type="primary" onClick={() => postCommand('runQueue')}>运行队列</Button>
            )}
            <Button onClick={() => postCommand('refresh')}>刷新</Button>
          </Space>
        </Col>
      </Row>
    </Card>
  );
}

function SummaryStats({ payload }: { payload: OverviewPayload }) {
  const counts = payload.counts || {};
  const tasks = payload.tasks || [];
  const queueTotal = countValue(counts, 'queueTotal') || queueTasks(tasks).length;
  const total = countValue(counts, 'total') || tasks.length;
  const landed = countValue(counts, 'done')
    + countValue(counts, 'applied')
    + countValue(counts, 'reviewed')
    + countValue(counts, 'manualRescueLanded')
    + countValue(counts, 'noDiff');

  return (
    <Row gutter={[16, 16]}>
      <Col xs={12} lg={6}>
        <Card>
          <Statistic title="队列任务" value={queueTotal} />
        </Card>
      </Col>
      <Col xs={12} lg={6}>
        <Card>
          <Statistic title="全部任务" value={total} />
        </Card>
      </Col>
      <Col xs={12} lg={6}>
        <Card>
          <Statistic title="运行中" value={countValue(counts, 'running')} />
        </Card>
      </Col>
      <Col xs={12} lg={6}>
        <Card>
          <Statistic title="已落地" value={landed} />
        </Card>
      </Col>
    </Row>
  );
}

function QueueTable({ tasks }: { tasks: OverviewTask[] }) {
  const columns: ColumnsType<OverviewTask> = [
    {
      title: '状态',
      key: 'status',
      render: (_, task) => <Tag color={statusColor(task)}>{statusLabel(task)}</Tag>,
    },
    {
      title: '任务',
      key: 'task',
      render: (_, task) => (
        <Space direction="vertical" size={0}>
          <Typography.Link onClick={() => postCommand('openTask', { taskPath: task.task, runId: task.id })}>
            {taskLabel(task)}
          </Typography.Link>
          <Text type="secondary" className="native-task-path" ellipsis={{ tooltip: task.task }}>
            {task.task}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Agent',
      key: 'agent',
      render: (_, task) => task.agent || formatAgentPair(task),
    },
    {
      title: '分支',
      key: 'branch',
      render: (_, task) => task.branch || '-',
    },
    {
      title: '变更',
      key: 'diff',
      render: (_, task) => formatBytes(task.diffBytes),
    },
    {
      title: '最后更新',
      key: 'updated',
      render: (_, task) => task.lastUpdatedText || '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_, task) => (
        <Space>
          <Button size="small" onClick={() => postCommand('openTask', { taskPath: task.task, runId: task.id })}>详情</Button>
          {task.enabled === false && task.id ? (
            <Button size="small" onClick={() => postCommand('reEnable', { taskId: task.id })}>启用</Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <Table
      rowKey={(task) => task.id || task.task}
      columns={columns}
      dataSource={tasks}
      pagination={{ pageSize: PAGE_SIZE }}
    />
  );
}

function CurrentRun({ current }: { current: OverviewPayload['current'] }) {
  if (!current) {
    return <Alert type="info" showIcon message="当前没有运行中的任务" />;
  }
  const baseDesc = `${current.phaseLabel || current.status || '-'} · ${current.elapsedText || '-'}`;
  const prof = (current as any).profileName ? ` · 激活 Profile: ${(current as any).profileName}` : '';
  return (
    <Alert
      type={current.staleRun ? 'warning' : 'info'}
      showIcon
      message={current.taskLabel || '当前运行'}
      description={`${baseDesc}${prof}`}
    />
  );
}

function SidePanel({ payload }: { payload: OverviewPayload }) {
  const counts = payload.counts || {};
  const tasks = payload.tasks || [];
  const total = countValue(counts, 'total') || tasks.length || 1;
  const landed = countValue(counts, 'done')
    + countValue(counts, 'applied')
    + countValue(counts, 'reviewed')
    + countValue(counts, 'manualRescueLanded')
    + countValue(counts, 'noDiff');
  const progress = Math.min(100, Math.round((landed / total) * 100));

  return (
    <Space direction="vertical" size="middle" className="native-side">
      <Card title="当前任务">
        <CurrentRun current={payload.current || null} />
      </Card>
      <Card>
        <Space direction="vertical" size="middle" className="native-side">
          <Statistic title="待处理" value={filterCount(tasks, 'pending', counts)} />
          <Statistic title="需关注" value={filterCount(tasks, 'attention', counts)} />
          <Progress percent={progress} status={progress >= 100 ? 'success' : 'active'} />
        </Space>
      </Card>
    </Space>
  );
}

export function DashboardApp({ payload }: { payload: OverviewPayload }) {
  const [filter, setFilter] = useState<FilterKey>('queue');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewKey>('workbench');
  const [settingsData, setSettingsData] = useState<any>(null);
  const [providerTests, setProviderTests] = useState<any[]>([]);
  const [workerCliTests, setWorkerCliTests] = useState<any[]>([]);
  const [queueDefaultsData, setQueueDefaultsData] = useState<any>(null);
  const [queuePreview, setQueuePreview] = useState<any>(null);
  const [queueApply, setQueueApply] = useState<any>(null);
  const [exportedSettings, setExportedSettings] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [diagnosticsData, setDiagnosticsData] = useState<any>(null);
  const [profilesData, setProfilesData] = useState<any>(null);

  const tasks = payload.tasks || [];
  const visibleTasks = useMemo(() => filterTasks(tasks, filter, query), [tasks, filter, query]);
  const tabItems = CATEGORY_ORDER.map((key) => ({
    key,
    label: `${FILTER_LABELS[key]} ${filterCount(tasks, key, payload.counts)}`,
  }));

  // Load settings data when switching to settings view
  useEffect(() => {
    if (view === 'settings') {
      postCommand('getSettings');
      postCommand('getQueueDefaults');
      postCommand('getDiagnostics');
      postCommand('listProfiles');
    }
  }, [view]);

  // Receive settings from extension (or mock in dev)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'settings') {
        setSettingsData(msg.payload);
      }
      if (msg?.type === 'saveBlocked' && msg.payload) {
        message.warning(msg.payload.message || '操作被阻止（队列运行中）');
      }
      if (msg?.type === 'providerHealth' && msg.payload) {
        setProviderTests((prev) => {
          const filtered = prev.filter((p: any) => p.provider !== msg.payload.provider);
          return [...filtered, msg.payload];
        });
      }
      if (msg?.type === 'workerCliHealth' && msg.payload) {
        setWorkerCliTests((prev) => {
          const filtered = prev.filter((p: any) => p.worker !== msg.payload.worker);
          return [...filtered, msg.payload];
        });
      }
      if (msg?.type === 'queueDefaults' && msg.payload) {
        setQueueDefaultsData(msg.payload);
      }
      if (msg?.type === 'queuePreview' && msg.payload) {
        setQueuePreview(msg.payload);
      }
      if (msg?.type === 'queueApply' && msg.payload) {
        setQueueApply(msg.payload);
      }
      if (msg?.type === 'settingsExported' && msg.payload) {
        setExportedSettings(msg.payload);
      }
      if (msg?.type === 'importSettingsResult' && msg.payload) {
        setImportResult(msg.payload);
        if (msg.payload.ok) {
          postCommand('getSettings');
        }
      }
      if (msg?.type === 'diagnostics' && msg.payload) {
        setDiagnosticsData(msg.payload);
      }
      if (msg?.type === 'profiles' && msg.payload) {
        setProfilesData(msg.payload);
      }
      if (msg?.type === 'profileError' && msg.payload) {
        message.error(msg.payload.error || 'profile op failed');
      }
      if (msg?.type === 'cancelResult' && msg.payload) {
        const r = msg.payload;
        if (r && r.status === 'queued-cancel') {
          // Explicit UI copy: queued/advisory cancel from bridge is not a real process kill.
          message.warning(r.message || '取消为 queued-cancel 占位（bridge 不支持进程终止，非真实停止）');
        } else if (r && r.status === 'error') {
          message.error(r.message || '取消请求失败');
        }
        // Other/future real cancel statuses: forward-compatible, no misleading stop-success UI.
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleSaveSettings = (values: Record<string, unknown>) => {
    postCommand('saveSettings', values);
  };

  const handlePreviewQueueDefaults = (proposed: Record<string, unknown>) => {
    setQueuePreview(null);
    setQueueApply(null);
    postCommand('previewQueueDefaults', { proposed });
  };

  const handleApplyQueueDefaults = (proposed: Record<string, unknown>) => {
    setQueueApply(null);
    postCommand('applyQueueDefaults', { proposed });
  };

  const handleExportSettings = () => {
    setExportedSettings(null);
    setImportResult(null);
    postCommand('exportSettings');
  };

  const handleImportSettings = (text: string) => {
    setImportResult(null);
    let parsed: any;
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      setImportResult({ ok: false, error: 'malformed JSON' });
      return;
    }
    postCommand('importSettings', parsed);
  };

  const handleListProfiles = () => {
    postCommand('listProfiles');
  };

  const handleCreateProfile = (name: string, values?: Record<string, unknown>) => {
    postCommand('createProfile', { name, values: values || {} });
  };

  const handleRenameProfile = (oldName: string, newName: string) => {
    postCommand('renameProfile', { oldName, newName });
  };

  const handleDuplicateProfile = (name: string, newName: string) => {
    postCommand('duplicateProfile', { name, newName });
  };

  const handleDeleteProfile = (name: string) => {
    postCommand('deleteProfile', { name });
  };

  const handleSelectProfile = (name: string) => {
    postCommand('selectProfile', { name });
  };

  const workbenchContent = (
    <Space direction="vertical" size="middle" className="native-stack">
      <OverviewHeader payload={payload} />
      <SummaryStats payload={payload} />
      <Row gutter={[16, 16]} align="top">
        <Col xs={24} xl={18}>
          <Card
            title="任务列表"
            extra={<Input.Search placeholder="搜索任务" allowClear onChange={(event) => setQuery(event.target.value)} />}
          >
            <Tabs
              activeKey={filter}
              items={tabItems}
              onChange={(next) => setFilter(next as FilterKey)}
            />
            <QueueTable tasks={visibleTasks} />
          </Card>
        </Col>
        <Col xs={24} xl={6}>
          <SidePanel payload={payload} />
        </Col>
      </Row>
    </Space>
  );

  return (
    <ConfigProvider
      prefixCls="agent-ant"
      csp={window.__AGENT_LOOP_CSP_NONCE__ ? { nonce: window.__AGENT_LOOP_CSP_NONCE__ } : undefined}
    >
      <Layout className="native-dashboard">
        <DashboardSidebar currentView={view} onViewChange={setView} />
        <Layout className="native-main">
          <Header className="native-header">
            <Breadcrumb items={[{ title: 'AgentLoop' }, { title: view === 'settings' ? '设置' : '工作台' }]} />
          </Header>
          <Content className="native-content">
            {view === 'workbench' ? workbenchContent : <SettingsView data={settingsData} onSave={handleSaveSettings} providerTests={providerTests} onTestProvider={(provider) => postCommand('testProvider', { provider })} workerCliTests={workerCliTests} onTestWorkerCli={(w) => postCommand('testWorkerCli', { worker: w })} queueDefaultsData={queueDefaultsData} queuePreview={queuePreview} onPreviewQueue={handlePreviewQueueDefaults} queueApply={queueApply} onApplyQueue={handleApplyQueueDefaults} exportedSettings={exportedSettings} importResult={importResult} onExportSettings={handleExportSettings} onImportSettings={handleImportSettings} diagnosticsData={diagnosticsData} onRefreshDiagnostics={() => postCommand('getDiagnostics')} profilesData={profilesData} onListProfiles={handleListProfiles} onCreateProfile={handleCreateProfile} onRenameProfile={handleRenameProfile} onDuplicateProfile={handleDuplicateProfile} onDeleteProfile={handleDeleteProfile} onSelectProfile={handleSelectProfile} />}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

type SettingsData = {
  nonSensitive?: {
    fixAgent?: string;
    reviewAgent?: string;
    workerMaxTurns?: number;
    workerMaxRetries?: number;
    queuePath?: string;
    worktreeScope?: string;
  };
  keys?: {
    grokApiKey?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
  };
  baseUrl?: string;
  injectToWorker?: boolean;
  queueRunning?: boolean;
  activeProfile?: string | null;
  profiles?: Record<string, any>;
  queueDefaults?: {
    defaults?: Record<string, unknown>;
    supportedKeys?: string[];
    queuePath?: string;
  };
};

function CliConfigForm({ initial, onSave, queueRunning, activeProfile }: { initial: SettingsData['nonSensitive']; onSave: (v: any) => void; queueRunning?: boolean; activeProfile?: string | null }) {
  const [form] = Form.useForm();
  const isRunning = Boolean(queueRunning);
  const runtimeLocked = (f: string) => isRunning && ['fixAgent', 'reviewAgent', 'queuePath', 'worktreeScope'].includes(f);

  useEffect(() => {
    if (initial) {
      form.setFieldsValue({
        fixAgent: initial.fixAgent || 'grok',
        reviewAgent: initial.reviewAgent || 'codex',
        workerMaxTurns: initial.workerMaxTurns ?? 128,
        workerMaxRetries: initial.workerMaxRetries ?? 2,
        queuePath: initial.queuePath || 'agent-loop/scripts/migration-queue.json',
        worktreeScope: initial.worktreeScope || 'queue',
      });
    }
  }, [initial, form]);

  const handleFinish = (values: any) => {
    // client-side guard; backend also enforces with structured result
    if (runtimeLocked('fixAgent') || runtimeLocked('reviewAgent') || runtimeLocked('queuePath') || runtimeLocked('worktreeScope')) {
      message.warning('队列运行中，运行时 profile 字段已禁用');
      return;
    }
    onSave(values);
    message.success('CLI 配置已保存');
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} style={{ maxWidth: 520 }}>
      {isRunning ? (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`队列运行中 (激活 Profile: ${activeProfile || '未知'})，运行时字段已锁定`} description="已锁定: fixAgent, reviewAgent, queuePath, worktreeScope（影响运行 profile/worker 配置）。workerMaxTurns / workerMaxRetries 为安全非运行时字段，可正常编辑。" />
      ) : null}
      <Form.Item label="默认修复 Worker" name="fixAgent">
        <Select disabled={runtimeLocked('fixAgent')}>
          <Select.Option value="grok">Grok</Select.Option>
          <Select.Option value="codex">Codex</Select.Option>
        </Select>
      </Form.Item>

      <Form.Item label="默认 Review Worker" name="reviewAgent">
        <Select disabled={runtimeLocked('reviewAgent')}>
          <Select.Option value="codex">Codex</Select.Option>
          <Select.Option value="grok">Grok</Select.Option>
          <Select.Option value="none">None（跳过审查）</Select.Option>
        </Select>
      </Form.Item>

      <Form.Item label="最大执行轮次" name="workerMaxTurns">
        <InputNumber min={1} style={{ width: '100%' }} disabled={false} />
      </Form.Item>

      <Form.Item label="最大重试次数" name="workerMaxRetries">
        <InputNumber min={0} style={{ width: '100%' }} disabled={false} />
      </Form.Item>

      <Form.Item label="队列文件路径" name="queuePath">
        <Input placeholder="agent-loop/scripts/migration-queue.json" disabled={runtimeLocked('queuePath')} />
      </Form.Item>

      <Form.Item label="工作树模式" name="worktreeScope">
        <Select disabled={runtimeLocked('worktreeScope')}>
          <Select.Option value="queue">queue</Select.Option>
          <Select.Option value="task">task</Select.Option>
        </Select>
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" disabled={runtimeLocked('fixAgent') || runtimeLocked('reviewAgent')}>保存 CLI 配置</Button>
      </Form.Item>
    </Form>
  );
}

function LlmKeyForm({ initial, onSave, providerTests, onTestProvider, workerCliTests, onTestWorkerCli, queueRunning }: { initial: SettingsData; onSave: (v: any) => void; providerTests?: any[]; onTestProvider?: (p: string) => void; workerCliTests?: any[]; onTestWorkerCli?: (w: string) => void; queueRunning?: boolean; }) {
  const [form] = Form.useForm();
  const isRunning = Boolean(queueRunning);
  const baseUrlLocked = isRunning; // baseUrl is runtime-locked per guard

  useEffect(() => {
    if (initial) {
      form.setFieldsValue({
        baseUrl: initial.baseUrl || '',
        injectToWorker: initial.injectToWorker !== false,
      });
    }
  }, [initial, form]);

  const getKeyStatus = (key?: string) => key === 'configured' ? <Tag color="success">已配置 (redacted)</Tag> : <Tag>未配置</Tag>;

  const handleFinish = (values: any) => {
    // Never include secret key values: /settings only persists non-secrets; UI must not report false success for keys
    const payload: any = {
      baseUrl: values.baseUrl,
      injectToWorker: values.injectToWorker,
    };
    const hadKeyAttempt = !!(values.grokApiKey || values.openaiApiKey || values.anthropicApiKey);

    onSave(payload);
    if (hadKeyAttempt) {
      message.warning('LLM key 值未持久化（此 web 切片仅 /settings 非秘密后端）；不报告保存成功。');
    } else {
      message.success('配置已保存');
    }
    // clear password fields after save for security feel
    form.setFieldsValue({ grokApiKey: '', openaiApiKey: '', anthropicApiKey: '' });
  };

  const handleClear = (keyName: string) => {
    // Block secret clear/save: do not forward to nonsecret backend; do not report persisted success/cleared
    if (['grokApiKey', 'openaiApiKey', 'anthropicApiKey'].includes(keyName)) {
      message.warning('LLM key 清除在此 web 切片中不支持（无持久化）；仅显示 configured 状态。');
      form.setFieldsValue({ [keyName]: '' });
      return;
    }
    const payload: any = { [keyName]: '' };
    onSave(payload);
    message.success('已清除');
  };

  const handleTest = (provider: string) => {
    if (onTestProvider) {
      onTestProvider(provider);
    }
  };

  const getTestResult = (provider: string) => {
    return (providerTests || []).find((r: any) => r.provider === provider);
  };

  const renderResult = (provider: string) => {
    const r = getTestResult(provider);
    if (!r) return null;
    const tone = r.status === 'ok' ? 'success' : r.status === 'skipped' ? 'default' : 'error';
    let timeStr = '';
    try { if (r.checkedAt) timeStr = ' ' + new Date(r.checkedAt).toLocaleTimeString(); } catch {}
    return (
      <div style={{ marginTop: 4, fontSize: 12 }}>
        <Tag color={tone}>{r.status}</Tag>
        <span>{r.durationMs}ms · {r.reason}{timeStr} (cached)</span>
      </div>
    );
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} style={{ maxWidth: 620 }}>
      <Alert type="warning" showIcon message="LLM Keys 保存/清除在此 web 切片不支持（/settings 为 non-secret 后端）；仅显示状态，持久化操作被阻断。" style={{ marginBottom: 12 }} />
      <Form.Item label="Grok API Key / Token">
        <Space>
          {getKeyStatus(initial?.keys?.grokApiKey)}
          <Button size="small" danger disabled title="LLM key 持久化/清除在此 web 切片不支持">清除</Button>
          <Button size="small" onClick={() => handleTest('grok')}>测试</Button>
        </Space>
        <Form.Item name="grokApiKey" noStyle>
          <Input.Password placeholder="（此 web 切片不支持输入保存）" disabled />
        </Form.Item>
        {renderResult('grok')}
      </Form.Item>

      <Form.Item label="OpenAI API Key">
        <Space>
          {getKeyStatus(initial?.keys?.openaiApiKey)}
          <Button size="small" danger disabled title="LLM key 持久化/清除在此 web 切片不支持">清除</Button>
          <Button size="small" onClick={() => handleTest('openai')}>测试</Button>
        </Space>
        <Form.Item name="openaiApiKey" noStyle>
          <Input.Password placeholder="（此 web 切片不支持输入保存）" disabled />
        </Form.Item>
        {renderResult('openai')}
      </Form.Item>

      <Form.Item label="Anthropic API Key">
        <Space>
          {getKeyStatus(initial?.keys?.anthropicApiKey)}
          <Button size="small" danger disabled title="LLM key 持久化/清除在此 web 切片不支持">清除</Button>
          <Button size="small" onClick={() => handleTest('anthropic')}>测试</Button>
        </Space>
        <Form.Item name="anthropicApiKey" noStyle>
          <Input.Password placeholder="（此 web 切片不支持输入保存）" disabled />
        </Form.Item>
        {renderResult('anthropic')}
      </Form.Item>

      <Form.Item label="Worker CLI 健康 (本地 grok/codex 命令探针)">
        <Space>
          <Button size="small" onClick={() => onTestWorkerCli && onTestWorkerCli('grok')}>Probe grok</Button>
          <Button size="small" onClick={() => onTestWorkerCli && onTestWorkerCli('codex')}>Probe codex</Button>
        </Space>
        {(() => {
          const gr = (workerCliTests || []).find((r: any) => r.worker === 'grok');
          const cr = (workerCliTests || []).find((r: any) => r.worker === 'codex');
          const tone = (st: string) => st === 'ok' ? 'success' : (st === 'skipped' ? 'default' : (st === 'timeout' ? 'warning' : 'error'));
          return (
            <div style={{ marginTop: 4, fontSize: 12 }}>
              {gr && <div><Tag color={tone(gr.status)}>{gr.worker}</Tag> {gr.status} {gr.durationMs}ms · {gr.reason}</div>}
              {cr && <div><Tag color={tone(cr.status)}>{cr.worker}</Tag> {cr.status} {cr.durationMs}ms · {cr.reason}</div>}
            </div>
          );
        })()}
      </Form.Item>

      <Form.Item label="代理地址 / Base URL" name="baseUrl">
        <Input placeholder="https://api.example.com/v1" disabled={baseUrlLocked} />
      </Form.Item>

      <Form.Item label="将 Keys 注入到 Worker 环境" name="injectToWorker" valuePropName="checked">
        <Switch />
      </Form.Item>

      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit">保存非秘密设置</Button>
          <Button danger onClick={async () => {
            // Do not pass key empties (would be stripped anyway); do not report secret clear success
            await onSave({ baseUrl: form.getFieldValue('baseUrl'), injectToWorker: form.getFieldValue('injectToWorker') });
            message.warning('LLM keys 清除不支持（web /settings 切片无秘密持久化能力）；仅状态显示。');
            form.setFieldsValue({ grokApiKey: '', openaiApiKey: '', anthropicApiKey: '' });
          }}>清除全部 Keys</Button>
        </Space>
      </Form.Item>

      <Text type="secondary" style={{ fontSize: 12 }}>
        此 web 切片仅显示 LLM key configured 状态（来自 /settings）；保存/清除持久化不受支持。点击“测试”触发 provider health check。
      </Text>

      {(providerTests && providerTests.length > 0) && (
        <div style={{ marginTop: 12, padding: 8, background: '#fafafa', border: '1px solid #eee' }}>
          <Text strong style={{ fontSize: 12 }}>最近 Provider 健康检查 (会话缓存)</Text>
          {providerTests.map((r: any, idx: number) => (
            <div key={idx} style={{ fontSize: 12, marginTop: 2 }}>
              {r.provider} · {r.status} · {r.durationMs}ms · {r.reason} {r.checkedAt ? ('@' + new Date(r.checkedAt).toLocaleTimeString()) : ''} (cached)
            </div>
          ))}
        </div>
      )}
    </Form>
  );
}

function SettingsView({ data, onSave, providerTests, onTestProvider, workerCliTests, onTestWorkerCli, queueDefaultsData, queuePreview, onPreviewQueue, queueApply, onApplyQueue, exportedSettings, importResult, onExportSettings, onImportSettings, diagnosticsData, onRefreshDiagnostics, profilesData, onListProfiles, onCreateProfile, onRenameProfile, onDuplicateProfile, onDeleteProfile, onSelectProfile }: { data: SettingsData | null; onSave: (v: any) => void; providerTests?: any[]; onTestProvider?: (p: string) => void; workerCliTests?: any[]; onTestWorkerCli?: (w: string) => void; queueDefaultsData?: any; queuePreview?: any; onPreviewQueue?: (p: any) => void; queueApply?: any; onApplyQueue?: (p: any) => void; exportedSettings?: any; importResult?: any; onExportSettings?: () => void; onImportSettings?: (text: string) => void; diagnosticsData?: any; onRefreshDiagnostics?: () => void; profilesData?: any; onListProfiles?: () => void; onCreateProfile?: (n: string, v?: any) => void; onRenameProfile?: (o: string, n: string) => void; onDuplicateProfile?: (n: string, nn: string) => void; onDeleteProfile?: (n: string) => void; onSelectProfile?: (n: string) => void; }) {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Title level={4} style={{ marginBottom: 0 }}>AgentLoop 设置中心</Title>
      {data && (
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="活跃 Profile">{(data as any)?.activeProfile || 'local'}</Descriptions.Item>
          <Descriptions.Item label="Fix Agent">{data.nonSensitive?.fixAgent || '-'}</Descriptions.Item>
          <Descriptions.Item label="Review Agent">{data.nonSensitive?.reviewAgent || '-'}</Descriptions.Item>
        </Descriptions>
      )}
      <Tabs
        defaultActiveKey="cli"
        items={[
          {
            key: 'cli',
            label: 'CLI 配置',
            children: <CliConfigForm initial={data?.nonSensitive} onSave={onSave} queueRunning={(data as any)?.queueRunning} activeProfile={(data as any)?.activeProfile} />,
          },
          {
            key: 'keys',
            label: 'LLM Keys',
            children: <LlmKeyForm initial={data || {}} onSave={onSave} providerTests={providerTests} onTestProvider={onTestProvider} workerCliTests={workerCliTests} onTestWorkerCli={onTestWorkerCli} queueRunning={(data as any)?.queueRunning} />,
          },
          {
            key: 'queue',
            label: '队列默认值',
            children: <QueueDefaultsView data={queueDefaultsData} preview={queuePreview} onPreview={onPreviewQueue || (() => {})} applyResult={queueApply} onApply={onApplyQueue || (() => {})} settingsData={data} />,
          },
          {
            key: 'diagnostics',
            label: 'Diagnostics',
            children: <DiagnosticsView data={diagnosticsData} onRefresh={onRefreshDiagnostics || (() => {})} />,
          },
          {
            key: 'profiles',
            label: 'Profiles',
            children: <ProfileCrudView
              data={profilesData}
              queueRunning={(data as any)?.queueRunning}
              activeProfile={(data as any)?.activeProfile}
              onList={onListProfiles || (() => {})}
              onCreate={onCreateProfile || (() => {})}
              onRename={onRenameProfile || (() => {})}
              onDuplicate={onDuplicateProfile || (() => {})}
              onDelete={onDeleteProfile || (() => {})}
              onSelect={onSelectProfile || (() => {})}
            />,
          },
        ]}
      />
      <div style={{ marginTop: 24, color: '#888', fontSize: 12 }}>
        非敏感配置通过 /api/agent-loop/settings 持久化；LLM key 仅暴露 configured 状态（此 web 切片不支持秘密保存/清除）。队列 defaults 支持预览后确认 apply 写入；仅 owned 支持键；secrets 拒绝；写后 JSON + tasks 校验。
      </div>

      {/* Settings import/export redaction UI (schema v1, activeProfile + non-secret + key status only; secrets never exported or imported raw). Uses AntD Upload + download buttons for file-like controls (107). */}
      <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid #eee' }}>
        <Title level={5}>设置导入/导出（redacted）</Title>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={() => onExportSettings && onExportSettings()}>导出设置（仅 activeProfile、非敏感、key 状态）</Button>
          <Upload
            accept=".json,application/json"
            showUploadList={false}
            beforeUpload={(file) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                const txt = (e.target && (e.target as any).result) || '';
                if (txt) onImportSettings && onImportSettings(String(txt));
              };
              reader.readAsText(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>导入设置（文件上传）</Button>
          </Upload>
        </Space>
        {exportedSettings && (
          <div style={{ marginTop: 8 }}>
            <Text strong>导出内容（secret 字段为状态，非明文）:</Text>
            <pre style={{ background: '#fafafa', padding: 8, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(exportedSettings, null, 2)}</pre>
            <Space size={8}>
              <Button size="small" onClick={() => { try { navigator.clipboard?.writeText(JSON.stringify(exportedSettings, null, 2)); message.success('已复制 redacted export'); } catch {} }}>复制导出</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => {
                try {
                  const dataStr = JSON.stringify(exportedSettings, null, 2);
                  const blob = new Blob([dataStr], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'agentloop-settings-redacted.json';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  message.success('已下载 redacted payload');
                } catch {}
              }}>下载文件</Button>
            </Space>
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>schemaVersion: {exportedSettings.schemaVersion}；activeProfile + keys 只含 configured/'' 状态</Text>
          </div>
        )}
        {importResult && (
          <div style={{ marginTop: 8 }}>
            {importResult.ok ? (
              <Alert type="success" showIcon message="导入成功（仅应用了非敏感配置）" />
            ) : (
              <Alert type="error" showIcon message={importResult.error || '导入失败'} description="schema 校验或 secret 检测失败，未写入任何 secret" />
            )}
          </div>
        )}
      </div>
    </Space>
  );
}

function QueueDefaultsView({ data, preview, onPreview, applyResult, onApply, settingsData }: { data: any; preview: any; onPreview: (proposed: Record<string, unknown>) => void; applyResult?: any; onApply?: (proposed: Record<string, unknown>) => void; settingsData?: any }) {
  const [proposedText, setProposedText] = useState('{\n  "workerMaxTurns": 256\n}');
  const current = (data && data.defaults) || {};
  const supported = (data && data.supportedKeys) || [];

  const doPreview = () => {
    try {
      const parsed = JSON.parse(proposedText || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        onPreview(parsed);
      } else {
        message.error('proposed 必须是对象');
      }
    } catch {
      message.error('proposed JSON 无效');
    }
  };

  const doApply = () => {
    try {
      const parsed = JSON.parse(proposedText || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        onApply && onApply(parsed);
      } else {
        message.error('proposed 必须是对象');
      }
    } catch {
      message.error('proposed JSON 无效');
    }
  };

  const doSyncFromSettings = () => {
    const ns = (settingsData && (settingsData.nonSensitive || settingsData)) || {};
    const prop: Record<string, unknown> = {};
    const sup = new Set(supported);
    for (const [k, v] of Object.entries(ns)) {
      if (sup.has(k) && k !== 'workerEnv') {
        prop[k] = v;
      }
    }
    if (Object.keys(prop).length === 0) {
      // fallback common supported keys from settings shape
      if (ns.fixAgent !== undefined) prop.fixAgent = ns.fixAgent;
      if (ns.reviewAgent !== undefined) prop.reviewAgent = ns.reviewAgent;
      if (ns.workerMaxTurns !== undefined) prop.workerMaxTurns = ns.workerMaxTurns;
      if (ns.workerMaxRetries !== undefined) prop.workerMaxRetries = ns.workerMaxRetries;
      if (ns.worktreeScope !== undefined) prop.worktreeScope = ns.worktreeScope;
    }
    const json = JSON.stringify(prop, null, 2) || '{}';
    setProposedText(json);
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        onPreview(parsed);
      }
    } catch {}
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <Title level={5}>队列 defaults（仅支持键，当前值）</Title>
      <pre style={{ background: '#fafafa', padding: 8, fontSize: 12, maxHeight: 240, overflow: 'auto' }}>
        {JSON.stringify(current, null, 2)}
      </pre>
      <Text type="secondary" style={{ fontSize: 12 }}>supported: {supported.join(', ')}</Text>

      <div style={{ marginTop: 16 }}>
        <Text strong>预览 patch（dry-run，仅支持键；不含 workerEnv）</Text>
        <Input.TextArea
          rows={5}
          value={proposedText}
          onChange={(e) => setProposedText(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 6 }}
        />
        <Space style={{ marginTop: 8 }}>
          <Button onClick={doSyncFromSettings}>从 Settings 同步并预览 diff</Button>
          <Button onClick={doPreview}>预览 structured diff（不写入）</Button>
          {preview && preview.ok && onApply && (
            <Button type="primary" onClick={doApply}>确认应用（写入队列文件）</Button>
          )}
        </Space>
      </div>

      {preview && (
        <div style={{ marginTop: 12, padding: 8, background: preview.ok ? '#f6ffed' : '#fff1f0', border: '1px solid #eee' }}>
          {preview.ok === false ? (
            <Alert type="error" showIcon message={preview.error || 'redacted error'} />
          ) : (
            <>
              <Text strong>Preview result (before/after diff for supported keys):</Text>
              {Array.isArray(preview.diff) && preview.diff.length > 0 ? (
                <Table
                  size="small"
                  style={{ marginTop: 4 }}
                  columns={[
                    { title: 'Key', dataIndex: 'key', key: 'key' },
                    { title: 'Before', dataIndex: 'before', key: 'before', render: (v: unknown) => JSON.stringify(v) },
                    { title: 'After', dataIndex: 'after', key: 'after', render: (v: unknown) => JSON.stringify(v) },
                  ]}
                  dataSource={(preview.diff || []).map((d: any, i: number) => ({ ...d, key: d.key || String(i) }))}
                  pagination={false}
                  rowKey="key"
                />
              ) : (
                <div style={{ fontSize: 12 }}>no diff (values match)</div>
              )}
              <div style={{ fontSize: 12, marginTop: 4 }}>before keys: {Object.keys(preview.before || {}).join(', ')}</div>
              <div style={{ fontSize: 12 }}>after keys: {Object.keys(preview.after || {}).join(', ')}</div>
            </>
          )}
        </div>
      )}

      {applyResult && (
        <div style={{ marginTop: 12, padding: 8, background: applyResult.ok ? '#f6ffed' : '#fff1f0', border: '1px solid #eee' }}>
          {applyResult.ok === false ? (
            <Alert type="error" showIcon message={(applyResult.rolledBack ? 'rolled back: ' : '') + (applyResult.error || 'redacted error')} />
          ) : (
            <>
              <Text strong>Apply result (written + validated):</Text>
              {Array.isArray(applyResult.diff) && applyResult.diff.length > 0 ? (
                <Table
                  size="small"
                  style={{ marginTop: 4 }}
                  columns={[
                    { title: 'Key', dataIndex: 'key', key: 'key' },
                    { title: 'Before', dataIndex: 'before', key: 'before', render: (v: unknown) => JSON.stringify(v) },
                    { title: 'After', dataIndex: 'after', key: 'after', render: (v: unknown) => JSON.stringify(v) },
                  ]}
                  dataSource={(applyResult.diff || []).map((d: any, i: number) => ({ ...d, key: d.key || String(i) }))}
                  pagination={false}
                  rowKey="key"
                />
              ) : (
                <div style={{ fontSize: 12 }}>no diff</div>
              )}
              <div style={{ fontSize: 12, marginTop: 4 }}>applied: {JSON.stringify(applyResult.applied || {})}</div>
              <div style={{ fontSize: 12 }}>after keys: {Object.keys(applyResult.after || {}).join(', ')}</div>
            </>
          )}
        </div>
      )}

      <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
        预览确认后 apply 仅写入 owned 支持键；workerEnv/secrets 拒绝；写后强制 JSON 校验 + tasks 数组保留；失败时回滚。
      </Text>
    </div>
  );
}

function DiagnosticsView({ data, onRefresh }: { data: any; onRefresh: () => void }) {
  const d = data || {};
  const eff = d.effectiveConfig || {};
  const srcs = d.configSources || {};
  const keys = d.keys || {};
  const warns: Array<{ category: string; message: string }> = Array.isArray(d.warnings) ? d.warnings : [];
  const catColor = (c: string) => (c === 'ready' ? 'success' : c === 'failed' ? 'error' : c === 'skipped' ? 'default' : 'warning');
  const handleCopy = () => {
    try {
      const text = JSON.stringify(d, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          message.success('已复制红acted diagnostics artifact JSON');
        }).catch(() => {
          message.info('复制到剪贴板（手动）');
        });
      } else {
        message.info('复制到剪贴板（手动）');
      }
    } catch {
      message.info('复制到剪贴板（手动）');
    }
  };
  return (
    <div style={{ maxWidth: 720 }}>
      <Space style={{ marginBottom: 8 }}>
        <Title level={5} style={{ margin: 0 }}>Diagnostics（只读）</Title>
        <Button size="small" onClick={onRefresh}>刷新</Button>
        <Button size="small" onClick={handleCopy}>Copy JSON</Button>
      </Space>
      <div style={{ marginBottom: 12 }}>
        <Text strong>Repo root:</Text> <Text code>{d.repoRoot || '-'}</Text>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Text strong>Queue path:</Text> <Text code>{d.queuePath || '-'}</Text>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Text strong>Key status:</Text>{' '}
        {Object.keys(keys).map((k) => (
          <Tag key={k} color={keys[k] === 'configured' ? 'success' : undefined}>{k}:{keys[k] || 'unset'}</Tag>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <Text strong>Effective config:</Text>
        <pre style={{ background: '#fafafa', padding: 8, fontSize: 11, maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(eff, null, 2)}</pre>
      </div>
      <div style={{ marginBottom: 8 }}>
        <Text strong>Config sources:</Text>
        <pre style={{ background: '#fafafa', padding: 8, fontSize: 11, maxHeight: 120, overflow: 'auto' }}>{JSON.stringify(srcs, null, 2)}</pre>
      </div>
      <div style={{ marginBottom: 8 }}>
        <Text strong>Last run state:</Text>
        <pre style={{ background: '#fafafa', padding: 8, fontSize: 11, maxHeight: 100, overflow: 'auto' }}>{JSON.stringify(d.lastRunState || null, null, 2)}</pre>
      </div>
      <div>
        <Text strong>Warnings (categorized):</Text>
        {warns.length === 0 ? (
          <Empty description="无警告" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ marginTop: 4 }}>
            {warns.map((w, i) => (
              <div key={i} style={{ marginBottom: 2 }}>
                <Tag color={catColor(w.category)}>{w.category}</Tag>
                <Text>{w.message}</Text>
              </div>
            ))}
          </div>
        )}
      </div>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 12 }}>
        所有数据已通过 redaction helper；不执行网络检查；只读。
      </Text>
    </div>
  );
}

function ProfileCrudView({ data, queueRunning, activeProfile, onList, onCreate, onRename, onDuplicate, onDelete, onSelect }: { data?: any; queueRunning?: boolean; activeProfile?: string | null; onList: () => void; onCreate: (n: string, v?: any) => void; onRename: (o: string, n: string) => void; onDuplicate: (n: string, nn: string) => void; onDelete: (n: string) => void; onSelect: (n: string) => void; }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState('');
  const [dupOpen, setDupOpen] = useState(false);
  const [dupTarget, setDupTarget] = useState('');
  const [form] = Form.useForm();
  const [renameForm] = Form.useForm();
  const [dupForm] = Form.useForm();

  const profiles: Record<string, any> = (data && data.profiles) || {};
  const active = (data && data.activeProfile) || activeProfile || 'local';
  const isRunning = Boolean(queueRunning);
  const entries = Object.keys(profiles).sort();

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ name: '', fixAgent: 'grok', reviewAgent: 'codex', workerMaxTurns: 128, workerMaxRetries: 2, worktreeScope: 'queue' });
    setCreateOpen(true);
  };

  const submitCreate = () => {
    const vals = form.getFieldsValue();
    const n = (vals.name || '').trim();
    if (!n) {
      message.error('profile name required');
      return;
    }
    const v: any = {};
    ['fixAgent', 'reviewAgent', 'workerMaxTurns', 'workerMaxRetries', 'worktreeScope', 'baseUrl', 'queuePath'].forEach(k => { if (vals[k] !== undefined) v[k] = vals[k]; });
    if (vals.injectKeysToWorker !== undefined) v.injectKeysToWorker = vals.injectKeysToWorker;
    onCreate(n, v);
    setCreateOpen(false);
  };

  const openRename = (n: string) => {
    setRenameTarget(n);
    renameForm.resetFields();
    renameForm.setFieldsValue({ newName: n });
    setRenameOpen(true);
  };

  const submitRename = () => {
    const vals = renameForm.getFieldsValue();
    const nn = (vals.newName || '').trim();
    if (!nn || nn === renameTarget) {
      setRenameOpen(false);
      return;
    }
    onRename(renameTarget, nn);
    setRenameOpen(false);
  };

  const openDup = (n: string) => {
    setDupTarget(n);
    dupForm.resetFields();
    dupForm.setFieldsValue({ newName: n + '-copy' });
    setDupOpen(true);
  };

  const submitDup = () => {
    const vals = dupForm.getFieldsValue();
    const nn = (vals.newName || '').trim();
    if (!nn) {
      message.error('new name required');
      return;
    }
    onDuplicate(dupTarget, nn);
    setDupOpen(false);
  };

  const doDelete = (n: string) => {
    if (entries.length <= 1) {
      message.error('cannot delete last profile');
      return;
    }
    if (n === active) {
      // still allow delete, handler will switch
    }
    onDelete(n);
  };

  const doSelect = (n: string) => {
    if (n === active) return;
    if (isRunning) {
      message.warning('队列运行中，禁止切换 profile');
      return;
    }
    onSelect(n);
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Space style={{ marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0 }}>Settings Profiles</Title>
        <Button size="small" onClick={onList}>刷新</Button>
        <Button size="small" type="primary" onClick={openCreate} disabled={isRunning}>创建</Button>
      </Space>

      {isRunning ? (
        <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={`队列运行中 (激活 Profile: ${active || '未知'})，禁止切换/删除 profile。`} />
      ) : null}

      <List
        bordered
        dataSource={entries}
        renderItem={(name: string) => {
          const p = profiles[name] || {};
          const isActive = name === active;
          const summary = [p.fixAgent, p.reviewAgent].filter(Boolean).join(' / ') || '-';
          return (
            <List.Item
              actions={[
                !isActive ? <Button key="sel" size="small" onClick={() => doSelect(name)} disabled={isRunning}>选择</Button> : <Tag key="act" color="blue">当前</Tag>,
                <Button key="ren" size="small" onClick={() => openRename(name)} disabled={isRunning}>重命名</Button>,
                <Button key="dup" size="small" onClick={() => openDup(name)}>复制</Button>,
                <Button key="del" size="small" danger disabled={isRunning || entries.length <= 1} onClick={() => doDelete(name)}>删除</Button>,
              ]}
            >
              <Space>
                <Text strong>{name}</Text>
                {isActive ? <Tag color="success">active</Tag> : null}
                <Tag>{summary}</Tag>
                {p.baseUrl ? <Tag>{p.baseUrl}</Tag> : null}
              </Space>
            </List.Item>
          );
        }}
      />

      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
        仅非敏感配置；不可删除最后一个 profile；运行中禁止切换与删除。
      </Text>

      <Modal title="创建 Profile" open={createOpen} onOk={submitCreate} onCancel={() => setCreateOpen(false)} okText="创建" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: 'name required' }, { pattern: /^[a-zA-Z0-9_-]+$/, message: 'invalid chars (use a-z0-9_-)'} ]}>
            <Input placeholder="my-profile" />
          </Form.Item>
          <Form.Item label="Fix Agent" name="fixAgent">
            <Select><Select.Option value="grok">grok</Select.Option><Select.Option value="codex">codex</Select.Option></Select>
          </Form.Item>
          <Form.Item label="Review Agent" name="reviewAgent">
            <Select><Select.Option value="codex">codex</Select.Option><Select.Option value="grok">grok</Select.Option><Select.Option value="none">none</Select.Option></Select>
          </Form.Item>
          <Form.Item label="Max Turns" name="workerMaxTurns"><InputNumber min={1} /></Form.Item>
          <Form.Item label="Max Retries" name="workerMaxRetries"><InputNumber min={0} /></Form.Item>
          <Form.Item label="Worktree Scope" name="worktreeScope">
            <Select><Select.Option value="queue">queue</Select.Option><Select.Option value="task">task</Select.Option></Select>
          </Form.Item>
          <Form.Item label="Base URL" name="baseUrl"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`重命名 ${renameTarget}`} open={renameOpen} onOk={submitRename} onCancel={() => setRenameOpen(false)} okText="重命名" cancelText="取消">
        <Form form={renameForm} layout="vertical">
          <Form.Item label="新名称" name="newName" rules={[{ required: true }, { pattern: /^[a-zA-Z0-9_-]+$/, message: 'invalid profile name' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`复制 ${dupTarget}`} open={dupOpen} onOk={submitDup} onCancel={() => setDupOpen(false)} okText="复制" cancelText="取消">
        <Form form={dupForm} layout="vertical">
          <Form.Item label="新名称" name="newName" rules={[{ required: true }, { pattern: /^[a-zA-Z0-9_-]+$/, message: 'invalid profile name' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function DetailChrome({ children }: { children: React.ReactNode }) {
  // In detail view, settings is accessible but clicking it will be handled at overview level for v1
  const handleViewChange = (v: 'workbench' | 'settings') => {
    if (v === 'settings') {
      // Switch to overview settings by posting and user can switch
      postCommand('showOverview');
      // After overview loads, user can click settings again; for simplicity we stay in workbench here
    }
  };

  return (
    <ConfigProvider
      prefixCls="agent-ant"
      csp={window.__AGENT_LOOP_CSP_NONCE__ ? { nonce: window.__AGENT_LOOP_CSP_NONCE__ } : undefined}
    >
      <Layout className="native-dashboard native-detail-dashboard">
        <DashboardSidebar currentView={'workbench'} onViewChange={handleViewChange} />
        <Layout className="native-main">
          <Header className="native-header">
            <Breadcrumb items={[{ title: 'AgentLoop' }, { title: 'Run' }]} />
          </Header>
          <Content className="native-content">
            {children}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

function metricItems(payload: DetailPayload) {
  return [
    { key: 'iteration', title: '迭代次数', value: String((payload.iterations || []).length), icon: '#' },
    { key: 'events', title: '事件总数', value: String((payload.events || []).length), icon: 'E' },
    { key: 'elapsed', title: '耗时', value: compactText(payload.elapsedText), icon: 'T' },
    { key: 'blocks', title: '阻断次数', value: String(blockCount(payload)), icon: '!' },
    { key: 'status', title: '最终状态', value: compactText(payload.phaseLabel || payload.status), icon: 'OK', tone: statusTone(payload.status) },
  ];
}

function DetailHero({ payload }: { payload: DetailPayload }) {
  const finalStatus = compactText(payload.phaseLabel || payload.status);
  return (
    <section className="native-detail-hero">
      <div className="native-run-head">
        <Space direction="vertical" size={10} className="native-run-title">
          <div className="native-title-line">
            <Button
              className="native-back-button"
              icon={<LeftOutlined />}
              onClick={() => postCommand('showOverview')}
              size="small"
            >
              返回
            </Button>
            <Title level={3}>{compactText(payload.taskLabel, 'AgentLoop Run')}</Title>
          </div>
          <Space wrap>
            <Tag>Queue</Tag>
            <Tag color={statusTone(payload.status)}>{finalStatus}</Tag>
            {payload.landing?.status ? <Tag color="success">{compactText(payload.landing.status)}</Tag> : null}
            {(payload as any).profileName ? <Tag color="blue">Profile: {(payload as any).profileName}</Tag> : null}
          </Space>
          <Text type="secondary">
            Started {compactText(payload.runId)} · RunId: {compactText(payload.runId)} · Commit: {compactText(payload.commit)}
          </Text>
        </Space>
        <Space wrap className="native-run-actions">
          <Button type="primary" onClick={() => postCommand('runTask', { task: payload.taskPath })}>单跑此任务</Button>
          {payload.reportPath ? <Button onClick={() => postCommand('openReport', { reportPath: payload.reportPath })}>最终报告</Button> : null}
          {payload.reportJsonPath ? <Button onClick={() => postCommand('openReport', { reportPath: payload.reportJsonPath })}>结构化报告</Button> : null}
          {payload.landingPath ? <Button onClick={() => postCommand('openReport', { reportPath: payload.landingPath })}>落地状态</Button> : null}
          {payload.statePath ? <Button onClick={() => postCommand('openState', { statePath: payload.statePath })}>state.json</Button> : null}
          <Button onClick={() => postCommand('refresh')}>刷新</Button>
        </Space>
      </div>
      <div className="native-hero-kpis">
        <div className="native-metric-grid">
          {metricItems(payload).map((item) => (
            <div className={`native-metric native-metric-${item.tone || 'default'}`} key={item.key}>
              <span className="native-metric-icon">{item.icon}</span>
              <span className="native-metric-copy">
                <Text type="secondary">{item.title}</Text>
                <Text strong ellipsis={{ tooltip: item.value }}>{item.value}</Text>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DetailProgress({ payload }: { payload: DetailPayload }) {
  const steps = payload.pipelineSteps || [];
  if (!steps.length) return null;
  const activeIndex = Math.max(0, steps.findIndex((step) => step.active));
  const doneCount = steps.filter((step) => step.done).length;
  const completed = Math.max(doneCount, activeIndex >= 0 ? activeIndex + 1 : 0);
  const progressPercent = Math.min(100, Math.round((completed / steps.length) * 100));
  return (
    <Card className="native-step-card" styles={{ body: { padding: '14px 18px' } }}>
      <Space direction="vertical" size="small" className="native-stack">
        <Space className="native-progress-head" size="middle">
          <Text type="secondary">整体进度</Text>
          <Text strong>{progressPercent}%</Text>
          <span className="native-progress-track">
            <Progress percent={progressPercent} showInfo={false} />
          </span>
        </Space>
        <div className="native-flow-lane">
          <AgentLoopFlow payload={payload} />
        </div>
        <Steps
          className="native-steps"
          size="small"
          current={activeIndex}
          items={steps.map((step) => ({
            title: compactText(step.label || step.key),
            status: step.done ? 'finish' : step.active ? 'process' : 'wait',
          }))}
        />
      </Space>
    </Card>
  );
}

type FlowNodeState = 'done' | 'active' | 'wait' | 'halt';
type FlowNodeTone = 'blue' | 'green' | 'purple';
type FlowNode = {
  id: string;
  title: string;
  subtitle: string;
  state: FlowNodeState;
  tone: FlowNodeTone;
};

type G6FlowData = {
  nodes: Array<{ id: string; style: Record<string, unknown> }>;
  edges: Array<Record<string, unknown>>;
};

const FLOW_WIDTH = 950;
const FLOW_HEIGHT = 126;
const FLOW_NODE_WIDTH = 136;
const FLOW_NODE_HEIGHT = 58;

const FLOW_NODE_TONES: Record<FlowNodeTone, { fill: string; stroke: string; label: string; badge: string }> = {
  blue: { fill: '#f7fbff', stroke: '#cfe0f8', label: '#1d4f8f', badge: '#2f7dff' },
  green: { fill: '#f3fff6', stroke: '#9be6aa', label: '#166534', badge: '#22b14c' },
  purple: { fill: '#fbf8ff', stroke: '#c9a7ff', label: '#5b32a3', badge: '#7b61d1' },
};

function flowNodeToneStyle(node: FlowNode): Record<string, unknown> {
  const tone = FLOW_NODE_TONES[node.tone];
  const isActive = node.state === 'active';
  const isHalt = node.state === 'halt';
  return {
    fill: isHalt ? '#fff7f6' : tone.fill,
    stroke: isHalt ? '#ff7875' : isActive ? '#2474ee' : tone.stroke,
    lineWidth: isActive ? 1.8 : 1,
    radius: 8,
    shadowBlur: isActive ? 10 : 8,
    shadowColor: isActive ? 'rgba(36, 116, 238, 0.18)' : 'rgba(36, 116, 238, 0.08)',
    labelFill: isHalt ? '#cf1322' : tone.label,
    badgeBackgroundFill: isHalt ? '#ff4d4f' : node.state === 'wait' ? '#a9b9cc' : tone.badge,
  };
}

function productStageState(status: string | null | undefined): { index: number; done?: boolean; halt?: boolean } {
  const value = String(status || '');
  if (value.startsWith('DONE_') || value === 'MANUAL_RESCUE_LANDED') return { index: 5, done: true };
  if (value === 'HALT_NO_SUCCESS_CRITERIA') return { index: 0, halt: true };
  if (value.startsWith('HALT_') || value === 'STALE_INTERRUPTED') {
    return { index: value.includes('REVIEW') ? 4 : 2, halt: true };
  }
  if (value === 'INIT' || value === 'PROBED' || value === 'RESUMED' || value === 'WORKTREE_READY') return { index: 0 };
  if (value === 'BASELINE_GATE_RESULT') return { index: 1 };
  if (value === 'POST_FIX_GATE_RESULT') return { index: 3 };
  if (value.endsWith('_REVIEW')) return { index: 4 };
  if (value.endsWith('_FIX') || value === 'BUDGET_LOOP_HEAD' || value === 'REVIEW_NEEDS_CHANGES') return { index: 2 };
  return { index: 0 };
}

function buildFlowNodes(payload: DetailPayload): FlowNode[] {
  const worker = titleCaseAgent(payload.fixAgent || 'grok', 'Grok');
  const reviewer = titleCaseAgent(payload.reviewAgent || 'codex', 'Codex');
  const state = productStageState(payload.status);
  return [
    { id: 'admission', title: '任务准入', subtitle: '条件检查', state: flowNodeState(0, state), tone: 'blue' },
    { id: 'baseline', title: '基线 Gate', subtitle: '环境约束', state: flowNodeState(1, state), tone: 'blue' },
    { id: 'worker', title: `Worker (${worker})`, subtitle: '修复代码', state: flowNodeState(2, state), tone: 'blue' },
    { id: 'fix-gate', title: '修复 Gate', subtitle: '验证测试', state: flowNodeState(3, state), tone: 'blue' },
    { id: 'reviewer', title: `Reviewer (${reviewer})`, subtitle: '复查验收', state: flowNodeState(4, state), tone: 'purple' },
    { id: 'delivered', title: '已交付', subtitle: '可合并', state: flowNodeState(5, state), tone: 'green' },
  ];
}

function flowNodeState(
  index: number,
  state: { index: number; done?: boolean; halt?: boolean },
): FlowNodeState {
  if (state.done || index < state.index) return 'done';
  if (index === state.index) return state.halt ? 'halt' : 'active';
  return 'wait';
}

function buildG6FlowData(nodes: FlowNode[], width: number = FLOW_WIDTH): G6FlowData {
  // Spread nodes more: larger step for dispersion, modest side padding + centering.
  // Caps max step so gaps don't become excessive on very wide screens.
  const sidePadding = 36;
  const usable = Math.max(620, width - sidePadding * 2);
  const step = Math.min(185, Math.max(158, usable / 5));
  const chainWidth = step * 5;
  const startX = sidePadding + Math.max(0, (usable - chainWidth) / 2);
  const nodeY = 42;

  return {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      style: {
        ...flowNodeToneStyle(node),
        x: startX + index * step,
        y: nodeY,
        size: [FLOW_NODE_WIDTH, FLOW_NODE_HEIGHT],
        label: true,
        labelText: `${node.title}\n${node.subtitle}`,
        labelPlacement: 'center',
        labelTextAlign: 'center',
        labelTextBaseline: 'middle',
        labelWordWrap: false,
        labelMaxWidth: FLOW_NODE_WIDTH - 18,
        labelFontSize: 12,
        labelFontWeight: 700,
        labelLineHeight: 16,
        badge: true,
        badges: [{
          text: node.state === 'done' ? '✓' : node.state === 'active' ? '▶' : node.state === 'halt' ? '!' : String(index + 1),
          placement: 'right-top',
          offsetX: -5,
          offsetY: 5,
        }],
        badgeFill: '#fff',
        badgeFontSize: 10,
        badgeFontWeight: 800,
        badgeBackgroundRadius: 999,
        badgePadding: [3, 5, 3, 5],
        port: true,
        ports: [
          { key: 'left', placement: 'left', r: 0 },
          { key: 'right', placement: 'right', r: 0 },
          { key: 'bottom', placement: 'bottom', r: 0 },
        ],
      },
    })),
    edges: [
      ...nodes.slice(0, -1).map((node, index) => ({
        id: `main-${index}`,
        source: nodes[index].id,
        target: nodes[index + 1].id,
        type: 'line',
        style: {
          lineWidth: 3,
          stroke: '#22b14c',
          sourcePort: 'right',
          targetPort: 'left',
          zIndex: 1,
          endArrow: false,
          opacity: node.state === 'wait' ? 0.55 : 1,
        },
      })),
      {
        id: 'redo-review-worker',
        source: 'reviewer',
        target: 'worker',
        type: 'quadratic',
        style: {
          curveOffset: 42,
          curvePosition: 0.5,
          endArrow: true,
          endArrowType: 'vee',
          endArrowSize: 10,
          lineDash: [6, 5],
          lineWidth: 2.5,
          label: true,
          labelText: '未通过，回修',
          labelAutoRotate: false,
          labelBackground: true,
          labelBackgroundFill: '#fff1f0',
          labelBackgroundStroke: '#ffccc7',
          labelBackgroundRadius: 999,
          labelBackgroundPadding: [4, 10, 4, 10],
          labelFill: '#cf1322',
          labelFontSize: 12,
          labelFontWeight: 700,
          labelOffsetY: 10,
          sourcePort: 'bottom',
          stroke: '#ff4d4f',
          targetPort: 'bottom',
          zIndex: 2,
        },
      },
    ],
  };
}

function AgentLoopFlow({ payload }: { payload: DetailPayload }) {
  const nodes = useMemo(() => buildFlowNodes(payload), [payload.status, payload.fixAgent, payload.reviewAgent]);
  const flowSignature = useMemo(
    () => nodes.map((node) => `${node.id}:${node.state}:${node.title}:${node.subtitle}`).join('|'),
    [nodes],
  );
  const graphRootRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);
  const renderedSignatureRef = useRef('');
  const renderedWidthRef = useRef(0);
  const latestNodesRef = useRef(nodes);
  const latestSignatureRef = useRef(flowSignature);

  latestNodesRef.current = nodes;
  latestSignatureRef.current = flowSignature;

  useEffect(() => {
    const container = graphRootRef.current;
    if (!container) return undefined;
    let disposed = false;

    const measureWidth = () => Math.max(620, Math.min(1150, container.clientWidth || FLOW_WIDTH));

    const syncGraph = () => {
      if (disposed) return;
      const nextWidth = measureWidth();
      const nextNodes = latestNodesRef.current;
      const nextSignature = latestSignatureRef.current;
      const graph = graphRef.current;

      if (graph) {
        const widthChanged = renderedWidthRef.current !== nextWidth;
        if (widthChanged) {
          graph.resize(nextWidth, FLOW_HEIGHT);
          renderedWidthRef.current = nextWidth;
        }
        if (widthChanged || renderedSignatureRef.current !== nextSignature) {
          graph.setData(buildG6FlowData(nextNodes, nextWidth));
          renderedSignatureRef.current = nextSignature;
          void graph.render();
        }
        return;
      }

      const nextGraph = new Graph({
        animation: false,
        behaviors: [],
        container,
        data: buildG6FlowData(nextNodes, nextWidth) as unknown as GraphData,
        height: FLOW_HEIGHT,
        node: {
          type: 'rect',
          style: {
            port: true,
          },
        },
        padding: 0,
        width: nextWidth,
      });
      void nextGraph.render();
      graphRef.current = nextGraph;
      renderedSignatureRef.current = nextSignature;
      renderedWidthRef.current = nextWidth;
    };

    syncGraph();

    const ro = new ResizeObserver(syncGraph);
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      if (graphRef.current) {
        graphRef.current.destroy();
        graphRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const container = graphRootRef.current;
    const graph = graphRef.current;
    if (!container || !graph) return;

    const nextWidth = Math.max(620, Math.min(1150, container.clientWidth || FLOW_WIDTH));
    if (renderedSignatureRef.current === flowSignature && renderedWidthRef.current === nextWidth) return;

    if (renderedWidthRef.current !== nextWidth) {
      graph.resize(nextWidth, FLOW_HEIGHT);
      renderedWidthRef.current = nextWidth;
    }
    graph.setData(buildG6FlowData(nodes, nextWidth));
    renderedSignatureRef.current = flowSignature;
    void graph.render();
  }, [nodes, flowSignature]);

  return (
    <div className="native-flow-map">
      <div className="native-flow-g6-canvas" ref={graphRootRef} role="img" aria-label="AgentLoop 执行流程" />
      <div className="native-flow-legend">
        <span><i className="native-flow-legend-line native-flow-legend-main" />主流程</span>
        <span><i className="native-flow-legend-line native-flow-legend-redo" />未通过回修</span>
        <span><i className="native-flow-legend-dot">✓</i>已通过</span>
      </div>
    </div>
  );
}

function EventTimeline({ payload }: { payload: DetailPayload }) {
  const events = payload.events || [];
  return (
    <div className="native-timeline-shell">
      {events.map((event, index) => {
        const tone = statusTone(String(event.status || event.label || ''));
        return (
          <div className={`native-timeline-row native-timeline-row-${tone}`} key={`${compactText(event.status || event.label)}-${index}`}>
            <span className="native-timeline-time">{compactText(event.timeText || event.status)}</span>
            <span className="native-timeline-dot">
              {tone === 'success' ? <CheckCircleFilled /> : tone === 'processing' ? <PlayCircleFilled /> : <ClockCircleOutlined />}
            </span>
            <span className="native-timeline-copy">
              <Text strong>{compactText(event.label || event.status || `Event ${index + 1}`)}</Text>
              <Text type="secondary">{compactText(event.detail || event.summary || event.status)}</Text>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function renderCodeTokens(line: string): React.ReactNode[] {
  if (!line) return [' '];
  const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|[-]?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}\[\]:,])/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    let kind = 'punctuation';
    if (token.startsWith('"')) kind = tokenPattern.lastIndex < line.length && /^\s*:/.test(line.slice(tokenPattern.lastIndex)) ? 'key' : 'string';
    else if (token === 'true' || token === 'false') kind = 'boolean';
    else if (token === 'null') kind = 'null';
    else if (/^-?\d/.test(token)) kind = 'number';
    nodes.push(
      <span className={CODE_TOKEN_CLASS_NAMES[kind]} key={`${match.index}-${token}`}>
        {token}
      </span>,
    );
    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }
  return nodes.length > 0 ? nodes : [' '];
}

function CodeBlock({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="native-code-shell">
      <button className="native-code-copy" type="button">copy</button>
      <pre className="native-code">
        {lines.map((line, index) => (
          <span className="native-code-line" key={`${index}-${line.slice(0, 16)}`}>
            <span className="native-code-no">{index + 1}</span>
            <span className="native-code-text">{renderCodeTokens(line)}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}

function ChangeStatsCard({ payload }: { payload: DetailPayload }) {
  const diffBytes = sumDiffBytes(payload.iterations || []);
  return (
    <Card title="修改统计" className="native-change-card">
      <Descriptions
        column={1}
        size="small"
        items={[
          { key: 'files', label: '迭代次数', children: String((payload.iterations || []).length) },
          { key: 'diff', label: 'Diff', children: formatBytes(diffBytes) },
          { key: 'events', label: '事件', children: String((payload.events || []).length) },
          { key: 'gate', label: '通过率', children: payload.gateOk ? '100%' : '-' },
        ]}
      />
      <Progress percent={payload.gateOk ? 100 : 0} showInfo={false} status={payload.gateOk ? 'success' : 'active'} />
    </Card>
  );
}

function ReviewPanel({
  payload,
  reviewRounds,
}: {
  payload: DetailPayload;
  reviewRounds: Array<Record<string, unknown>>;
}) {
  if (!reviewRounds.length) {
    return <List dataSource={reviewRounds} locale={{ emptyText: '暂无 Review' }} />;
  }
  return (
    <Space direction="vertical" className="native-stack">
      {reviewRounds.map((round, index) => (
        <Space
          direction="vertical"
          size="middle"
          className="native-review-card native-stack"
          key={`review-${compactText(round.round, String(index + 1))}`}
        >
          <Row align="middle" justify="space-between" gutter={[12, 12]}>
            <Col>
              <Space wrap>
                <Tag
                  color={statusTone(
                    String(round.verdict || round.decision || "")
                  )}
                >
                  ✓
                </Tag>
                <Text strong>
                  Review #{compactText(round.round, String(index + 1))} ·{" "}
                  {compactText(round.verdict || round.decision)}
                </Text>
              </Space>
            </Col>
            <Col>
              <Space wrap>
                <Tag>节点 #{compactText(round.round, String(index + 1))}</Tag>
                {round.riskLevel ? (
                  <Tag color="warning">
                    严重级别 {compactText(round.riskLevel)}
                  </Tag>
                ) : null}
              </Space>
            </Col>
          </Row>
          <Text type="secondary">{compactText(round.summary)}</Text>
          <CodeBlock text={jsonPreview({ reviewRounds: [round] })} />
        </Space>
      ))}
    </Space>
  );
}

function DetailTabs({ payload }: { payload: DetailPayload }) {
  const reviewRounds = payload.reviewRounds || [];
  const tabBody = (children: React.ReactNode) => (
    <div className="native-detail-tab-body">{children}</div>
  );
  return (
    <Card className="native-detail-workbench" styles={{ body: { padding: 0 } }}>
      <Tabs
        defaultActiveKey={payload.activeTab || 'review'}
        tabBarStyle={{ padding: '0 24px', marginBottom: 0 }}
        items={[
          {
            key: 'review',
            label: 'Review',
            children: tabBody(<ReviewPanel payload={payload} reviewRounds={reviewRounds} />),
          },
          {
            key: 'diff',
            label: 'Diff',
            children: tabBody(<CodeBlock text={jsonPreview(payload.diffText || '暂无 diff')} />),
          },
          {
            key: 'agent',
            label: 'Agent 输出',
            children: tabBody(<CodeBlock text={jsonPreview(payload.agentTail || '暂无输出')} />),
          },
          {
            key: 'artifacts',
            label: 'Artifacts',
            children: tabBody(
              <Descriptions
                column={1}
                items={[
                  { key: 'report', label: '最终报告', children: compactText(payload.reportPath) },
                  { key: 'json', label: '结构化报告', children: compactText(payload.reportJsonPath) },
                  { key: 'landing', label: '落地状态', children: compactText(payload.landingPath) },
                  { key: 'state', label: 'state.json', children: compactText(payload.statePath) },
                ]}
              />,
            ),
          },
        ]}
      />
    </Card>
  );
}

function IterationTimeline({ iterations }: { iterations: Array<Record<string, unknown>> }) {
  return (
    <List
      className="native-iteration-list"
      dataSource={iterations}
      locale={{ emptyText: '暂无修复迭代' }}
      renderItem={(iteration, index) => (
        <List.Item>
          <Space direction="vertical" size={4} className="native-stack">
            <Space wrap>
              <Tag color="processing">#{compactText(iteration.iteration, String(index + 1))}</Tag>
              <Tag>{compactText(iteration.gateText || iteration.gate || (iteration.gateOk ? 'Gate 绿' : 'Gate'))}</Tag>
              <Tag>{formatBytes(Number(iteration.diffBytes) || 0)}</Tag>
            </Space>
            {iteration.summary ? <Text type="secondary">{compactText(iteration.summary)}</Text> : null}
          </Space>
        </List.Item>
      )}
    />
  );
}

function DetailRightRail({ payload }: { payload: DetailPayload }) {
  const taskItems = [
    { key: 'agent', label: '智能体', children: compactText(payload.agentText) },
    { key: 'priority', label: '优先级', children: 'P1' },
    { key: 'env', label: '环境', children: '-' },
    { key: 'branch', label: '分支/Commit', children: compactText(payload.commit) },
    { key: 'issue', label: '相关 Issue', children: '-' },
    { key: 'trigger', label: '触发方式', children: '手动触发' },
    { key: 'owner', label: '负责人', children: '张三' },
  ];
  const railAction = (
    label: string,
    icon: React.ReactNode,
    onClick?: () => void,
  ) => (
    <Button block className="native-rail-action" icon={icon} onClick={onClick}>
      <span className="native-rail-action-label">{label}</span>
      <RightOutlined className="native-rail-action-arrow" />
    </Button>
  );

  return (
    <Space direction="vertical" size="middle" className="native-detail-rail">
      <Card title="任务信息">
        <Descriptions column={1} size="small" items={taskItems} />
      </Card>
      <Card title="快捷操作" className="native-rail-actions">
        <Space direction="vertical" size="small" className="native-stack">
          {railAction('重新运行任务', <ReloadOutlined />, () => postCommand('runTask', { task: payload.taskPath }))}
          {railAction('生成最终报告', <FileDoneOutlined />, () => postCommand('openReport', { reportPath: payload.reportPath }))}
          {railAction('导出工作', <DownloadOutlined />)}
          {railAction('查看结构化报告', <SnippetsOutlined />, () => postCommand('openReport', { reportPath: payload.reportJsonPath }))}
        </Space>
      </Card>
    </Space>
  );
}

export function DashboardDetailApp({ payload }: { payload: DetailPayload }) {
  return (
    <DetailChrome>
      <Space direction="vertical" size="middle" className="native-stack">
        <DetailHero payload={payload} />
        <DetailProgress payload={payload} />
        <div className="native-detail-main-grid">
          <div>
            <Space direction="vertical" size="middle" className="native-stack">
              <Card title="执行时间线" className="native-timeline-card">
                <EventTimeline payload={payload} />
              </Card>
              <ChangeStatsCard payload={payload} />
            </Space>
          </div>
          <div>
            <DetailTabs payload={payload} />
          </div>
          <div>
            <DetailRightRail payload={payload} />
          </div>
        </div>
      </Space>
    </DetailChrome>
  );
}
