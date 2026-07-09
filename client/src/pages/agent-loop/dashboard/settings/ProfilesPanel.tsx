import { useMemo, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ProfilesPanelProps } from './types';

const { Text, Title } = Typography;

type ProfileRecord = {
  key: string;
  name: string;
  isActive: boolean;
  agents: string;
  baseUrl: string;
  raw: Record<string, unknown>;
};

const PROFILE_NAME_RULES = [
  { required: true, message: '请输入 profile 名称' },
  { pattern: /^[a-zA-Z0-9_-]+$/, message: '仅支持 a-z、A-Z、0-9、_、-' },
];

function cleanAgent(value: unknown, fallback: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function profileRows(profiles: Record<string, any>, active: string): ProfileRecord[] {
  return Object.keys(profiles)
    .sort()
    .map((name) => {
      const raw = profiles[name] || {};
      const fixAgent = cleanAgent(raw.fixAgent, '-');
      const reviewAgent = cleanAgent(raw.reviewAgent, 'none');
      return {
        key: name,
        name,
        isActive: name === active,
        agents: `${fixAgent} / ${reviewAgent}`,
        baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '',
        raw,
      };
    });
}

function ActionLabel({ children }: { children: string }) {
  return <span className="native-profiles-action-label">{children}</span>;
}

// ProfileCrudView preserved name for test direct renders and existing calls.
export function ProfileCrudView({
  data,
  queueRunning,
  activeProfile,
  onList,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onSelect,
}: ProfilesPanelProps) {
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
  const rows = useMemo(() => profileRows(profiles, active), [profiles, active]);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      name: '',
      fixAgent: 'grok',
      reviewAgent: 'codex',
      workerMaxTurns: 512,
      workerMaxRetries: 2,
      worktreeScope: 'queue',
    });
    setCreateOpen(true);
  };

  const submitCreate = () => {
    const vals = form.getFieldsValue();
    const name = String(vals.name || '').trim();
    if (!name) {
      message.error('profile name required');
      return;
    }
    const value: Record<string, unknown> = {};
    ['fixAgent', 'reviewAgent', 'workerMaxTurns', 'workerMaxRetries', 'worktreeScope', 'baseUrl', 'queuePath'].forEach((key) => {
      if (vals[key] !== undefined) value[key] = vals[key];
    });
    if (vals.injectKeysToWorker !== undefined) value.injectKeysToWorker = vals.injectKeysToWorker;
    onCreate(name, value);
    setCreateOpen(false);
  };

  const openRename = (name: string) => {
    setRenameTarget(name);
    renameForm.resetFields();
    renameForm.setFieldsValue({ newName: name });
    setRenameOpen(true);
  };

  const submitRename = () => {
    const vals = renameForm.getFieldsValue();
    const nextName = String(vals.newName || '').trim();
    if (!nextName || nextName === renameTarget) {
      setRenameOpen(false);
      return;
    }
    onRename(renameTarget, nextName);
    setRenameOpen(false);
  };

  const openDuplicate = (name: string) => {
    setDupTarget(name);
    dupForm.resetFields();
    dupForm.setFieldsValue({ newName: `${name}-copy` });
    setDupOpen(true);
  };

  const submitDuplicate = () => {
    const vals = dupForm.getFieldsValue();
    const nextName = String(vals.newName || '').trim();
    if (!nextName) {
      message.error('new name required');
      return;
    }
    onDuplicate(dupTarget, nextName);
    setDupOpen(false);
  };

  const doDelete = (name: string) => {
    if (entries.length <= 1) {
      message.error('cannot delete last profile');
      return;
    }
    onDelete(name);
  };

  const doSelect = (name: string) => {
    if (name === active) return;
    if (isRunning) {
      message.warning('队列运行中，禁止切换 profile');
      return;
    }
    onSelect(name);
  };

  const columns: ColumnsType<ProfileRecord> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      render: (name: string, record) => (
        <div className="native-profiles-name">
          <Text strong>{name}</Text>
          {record.isActive ? <Tag color="success">active</Tag> : null}
        </div>
      ),
    },
    {
      title: '状态 / Agents / 代理',
      dataIndex: 'agents',
      key: 'agents',
      render: (agents: string) => (
        <Tag className="native-profiles-agent-tag">{agents}</Tag>
      ),
    },
    {
      title: '代理地址',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      render: (baseUrl: string, record) => (
        <div className="native-profiles-proxy">
          {record.isActive ? <Tag color="processing">当前</Tag> : null}
          {baseUrl ? <Tag>{baseUrl}</Tag> : <Text type="secondary">—</Text>}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 420,
      render: (_, record) => (
        <div className="native-profiles-actions">
          <Button onClick={() => doSelect(record.name)} disabled={record.isActive || isRunning}><ActionLabel>选择</ActionLabel></Button>
          <Button onClick={() => openRename(record.name)} disabled={isRunning}><ActionLabel>重命名</ActionLabel></Button>
          <Button onClick={() => openDuplicate(record.name)}><ActionLabel>复制</ActionLabel></Button>
          <Button danger disabled={isRunning || entries.length <= 1} onClick={() => doDelete(record.name)}><ActionLabel>删除</ActionLabel></Button>
        </div>
      ),
    },
  ];

  return (
    <div className="native-profiles-panel">
      <div className="native-profiles-toolbar">
        <Title level={5}>Settings Profiles</Title>
        <Space size={12} wrap>
          <Button icon={<ReloadOutlined />} onClick={onList}>刷新</Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={openCreate} disabled={isRunning}>创建</Button>
        </Space>
      </div>

      {isRunning ? (
        <Alert
          className="native-profiles-running-alert"
          type="warning"
          showIcon
          message={`队列运行中（激活 Profile: ${active || '未知'}），禁止切换与删除 profile。`}
        />
      ) : null}

      <Table
        className="native-profiles-table"
        pagination={false}
        dataSource={rows}
        columns={columns}
        rowKey="name"
      />

      <Text type="secondary" className="native-profiles-note">
        仅非敏感配置；不可删除最后一个 profile；运行中禁止切换与删除。
      </Text>

      <Modal title="创建 Profile" open={createOpen} onOk={submitCreate} onCancel={() => setCreateOpen(false)} okText="创建" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={PROFILE_NAME_RULES}>
            <Input placeholder="my-profile" />
          </Form.Item>
          <Form.Item label="Fix Agent" name="fixAgent">
            <Select>
              <Select.Option value="grok">grok</Select.Option>
              <Select.Option value="codex">codex</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="Review Agent" name="reviewAgent">
            <Select>
              <Select.Option value="codex">codex</Select.Option>
              <Select.Option value="grok">grok</Select.Option>
              <Select.Option value="none">none</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="Max Turns" name="workerMaxTurns"><InputNumber min={1} /></Form.Item>
          <Form.Item label="Max Retries" name="workerMaxRetries"><InputNumber min={0} /></Form.Item>
          <Form.Item label="Worktree Scope" name="worktreeScope">
            <Select>
              <Select.Option value="queue">queue</Select.Option>
              <Select.Option value="task">task</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="Base URL" name="baseUrl"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`重命名 ${renameTarget}`} open={renameOpen} onOk={submitRename} onCancel={() => setRenameOpen(false)} okText="重命名" cancelText="取消">
        <Form form={renameForm} layout="vertical">
          <Form.Item label="新名称" name="newName" rules={PROFILE_NAME_RULES}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`复制 ${dupTarget}`} open={dupOpen} onOk={submitDuplicate} onCancel={() => setDupOpen(false)} okText="复制" cancelText="取消">
        <Form form={dupForm} layout="vertical">
          <Form.Item label="新名称" name="newName" rules={PROFILE_NAME_RULES}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export { ProfileCrudView as ProfilesPanel };
export default ProfileCrudView;
