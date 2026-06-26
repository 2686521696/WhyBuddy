import { useEffect } from 'react';
import { Alert, Button, Form, Input, message, Switch, Tag, Typography } from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  ClearOutlined,
  CloudServerOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { LlmKeysPanelProps } from './types';

const { Text } = Typography;

type ProviderKey = 'grok' | 'openai' | 'anthropic';

type ProviderConfig = {
  key: ProviderKey;
  title: string;
  status: string | undefined;
  placeholder: string;
  help: string;
};

function resultTone(status?: string) {
  if (!status) return 'default';
  if (['ok', 'ready', 'success', 'configured'].includes(status)) return 'success';
  if (['skipped', 'missing', 'unknown'].includes(status)) return 'default';
  if (['timeout', 'warning'].includes(status)) return 'warning';
  return 'error';
}

function formatResultTime(checkedAt?: string) {
  if (!checkedAt) return '';
  try {
    return ` @ ${new Date(checkedAt).toLocaleTimeString()}`;
  } catch {
    return '';
  }
}

function KeyStatus({ status }: { status?: string }) {
  return status === 'configured' ? (
    <Tag color="success" icon={<CheckCircleOutlined />}>已配置</Tag>
  ) : (
    <Tag>未配置</Tag>
  );
}

function ProviderHealth({ result }: { result?: any }) {
  if (!result) {
    return (
      <div className="native-provider-result native-provider-result-empty">
        <Text type="secondary">Provider Health：尚未测试</Text>
      </div>
    );
  }

  const duration = typeof result.durationMs === 'number' ? `${result.durationMs}ms` : '-';
  return (
    <div className="native-provider-result">
      <Tag color={resultTone(result.status)}>{result.status || 'unknown'}</Tag>
      <Text type="secondary">
        Provider Health：{duration} · {result.reason || 'cached'}{formatResultTime(result.checkedAt)}
      </Text>
    </div>
  );
}

function WorkerResultLine({ label, result }: { label: string; result?: any }) {
  return (
    <div className="native-worker-health-row">
      <Tag color={resultTone(result?.status)}>{label}</Tag>
      <Text type="secondary">
        {result ? `${result.status || 'unknown'} · ${typeof result.durationMs === 'number' ? `${result.durationMs}ms` : '-'} · ${result.reason || 'cached'}` : '尚未探测'}
      </Text>
    </div>
  );
}

function InfoStrip({ icon, children, tone = 'info' }: { icon: ReactNode; children: ReactNode; tone?: 'info' | 'neutral' }) {
  return (
    <div className={`native-llm-info-strip native-llm-info-strip-${tone}`}>
      <span className="native-llm-info-icon">{icon}</span>
      <Text type="secondary">{children}</Text>
    </div>
  );
}

// LlmKeyForm name preserved for legacy direct references / test compatibility.
function LlmKeyForm({
  initial,
  onSave,
  providerTests,
  onTestProvider,
  workerCliTests,
  onTestWorkerCli,
  queueRunning,
}: LlmKeysPanelProps) {
  const [form] = Form.useForm();
  const baseUrlLocked = Boolean(queueRunning);

  useEffect(() => {
    if (initial) {
      form.setFieldsValue({
        baseUrl: initial.baseUrl || '',
        injectToWorker: initial.injectToWorker !== false,
      });
    }
  }, [initial, form]);

  const providerConfigs: ProviderConfig[] = [
    {
      key: 'grok',
      title: 'Grok API Key / Token',
      status: initial?.keys?.grokApiKey,
      placeholder: '••••••••••••••••••••••••••••••••',
      help: '输入新的 Grok Key（留空则不修改）',
    },
    {
      key: 'openai',
      title: 'OpenAI API Key',
      status: initial?.keys?.openaiApiKey,
      placeholder: '••••••••••••••••••••••••••••••••',
      help: '输入新的 OpenAI Key（留空则不修改）',
    },
    {
      key: 'anthropic',
      title: 'Anthropic API Key',
      status: initial?.keys?.anthropicApiKey,
      placeholder: '••••••••••••••••••••••••••••••••',
      help: '输入新的 Anthropic Key（留空则不修改）',
    },
  ];

  const getProviderResult = (provider: ProviderKey) => {
    return (providerTests || []).find((result: any) => result.provider === provider);
  };

  const getWorkerResult = (worker: string) => {
    return (workerCliTests || []).find((result: any) => result.worker === worker);
  };

  const handleFinish = (values: any) => {
    const payload = {
      baseUrl: values.baseUrl,
      injectToWorker: values.injectToWorker,
    };

    onSave(payload);
    message.success('Keys 配置已保存');
  };

  const handleClearKey = () => {
    message.warning('Web 控制台仅显示 Key 状态；清除密钥需要后端 SecretStorage 能力接入后启用。');
  };

  const handleClearAll = async () => {
    await onSave({
      baseUrl: form.getFieldValue('baseUrl'),
      injectToWorker: form.getFieldValue('injectToWorker'),
    });
    message.warning('清除全部 Keys 暂未写入后端密钥存储；当前仅保留非敏感配置。');
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} className="native-llm-panel">
      <div className="native-provider-grid">
        {providerConfigs.map((provider) => (
          <section className="native-provider-card" key={provider.key}>
            <div className="native-provider-card-head">
              <div className="native-provider-title">
                <span className="native-provider-icon"><KeyOutlined /></span>
                <Text strong>{provider.title}</Text>
              </div>
              <div className="native-provider-actions">
                <KeyStatus status={provider.status} />
                <Button danger onClick={handleClearKey}>清除</Button>
                <Button onClick={() => onTestProvider?.(provider.key)}>测试</Button>
              </div>
            </div>
            <Input.Password
              autoComplete="off"
              className="native-provider-secret-input"
              placeholder={provider.placeholder}
              value=""
              readOnly
            />
            <Text type="secondary" className="native-provider-help">{provider.help}</Text>
            <ProviderHealth result={getProviderResult(provider.key)} />
          </section>
        ))}

        <section className="native-worker-health-card">
          <div className="native-provider-card-head">
            <div className="native-provider-title">
              <span className="native-provider-icon"><CloudServerOutlined /></span>
              <Text strong>Worker CLI 健康（本地 grok/codex 命令探针）</Text>
            </div>
          </div>
          <div className="native-worker-health-actions">
            <Button icon={<ThunderboltOutlined />} onClick={() => onTestWorkerCli?.('grok')}>Probe grok</Button>
            <Button icon={<ThunderboltOutlined />} onClick={() => onTestWorkerCli?.('codex')}>Probe codex</Button>
          </div>
          <div className="native-worker-health-grid">
            <WorkerResultLine label="grok" result={getWorkerResult('grok')} />
            <WorkerResultLine label="codex" result={getWorkerResult('codex')} />
          </div>
        </section>
      </div>

      <div className="native-llm-runtime-grid">
        <Form.Item label="代理地址 / Base URL" name="baseUrl">
          <Input placeholder="https://api.example.com/v1" disabled={baseUrlLocked} />
        </Form.Item>
        <Form.Item label="将 Keys 注入到 Worker 环境" name="injectToWorker" valuePropName="checked">
          <Switch />
        </Form.Item>
      </div>

      <div className="native-llm-actions">
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>保存 Keys 配置</Button>
        <Button danger icon={<ClearOutlined />} onClick={handleClearAll}>清除全部 Keys</Button>
      </div>

      <div className="native-llm-note-stack">
        <InfoStrip icon={<InfoCircleOutlined />}>
          敏感 Key 使用安全存储，不会写入项目文件。点击“测试”触发 provider health check（不自动执行）。
        </InfoStrip>
        <InfoStrip icon={<ApiOutlined />} tone="neutral">
          非敏感配置保存在工作区设置；敏感 Key 只展示已配置状态。当前 Web 控制台不会回传明文 Key。
        </InfoStrip>
      </div>

      {providerTests && providerTests.length > 0 ? (
        <Alert
          className="native-llm-provider-cache"
          type="info"
          showIcon
          message="最近 Provider Health（会话缓存）"
          description={providerTests.map((result: any) => (
            <div key={`${result.provider}-${result.checkedAt || result.status}`}>
              {result.provider} · {result.status || 'unknown'} · {typeof result.durationMs === 'number' ? `${result.durationMs}ms` : '-'} · {result.reason || 'cached'}
            </div>
          ))}
        />
      ) : null}
    </Form>
  );
}

export { LlmKeyForm as LlmKeysPanel };
export { LlmKeyForm };
export default LlmKeyForm;
