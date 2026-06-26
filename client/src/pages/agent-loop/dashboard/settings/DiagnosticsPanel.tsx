import { useMemo } from 'react';
import { Alert, Button, Descriptions, Empty, List, Space, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SnippetsOutlined, CopyOutlined, CodeOutlined } from '@ant-design/icons';
import type { DiagnosticsPanelProps } from './types';

const { Text, Title } = Typography;

type WarningRow = {
  category: string;
  message: string;
};

function copyText(text: string, label: string) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => message.success(`${label} 已复制`));
    } else {
      message.info(`${label}（请手动复制）`);
    }
  } catch {
    message.info(`${label}（请手动复制）`);
  }
}

function jsonToLines(value: Record<string, unknown>) {
  return JSON.stringify(value || {}, null, 2).split('\n');
}

function renderJsonLine(line: string) {
  const keyMatch = line.match(/^(\s*)"([^"]+)":\s*(.*?)(,?)$/);
  if (keyMatch) {
    const [, indent, key, rawValue, comma] = keyMatch;
    return (
      <>
        {indent}<span className="native-json-key">"{key}"</span>: <JsonValue value={rawValue} />{comma}
      </>
    );
  }
  return <>{line || ' '}</>;
}

function JsonValue({ value }: { value: string }) {
  const clean = value.trim();
  if (/^"/.test(clean)) return <span className="native-json-string">{value}</span>;
  if (/^(true|false)$/.test(clean)) return <span className="native-json-boolean">{value}</span>;
  if (/^-?\d+(\.\d+)?$/.test(clean)) return <span className="native-json-number">{value}</span>;
  if (/^null$/.test(clean)) return <span className="native-json-null">{value}</span>;
  return <>{value}</>;
}

function CodeCard({
  title,
  data,
  className,
}: {
  title: string;
  data: Record<string, unknown>;
  className: string;
}) {
  const text = JSON.stringify(data || {}, null, 2);
  const lines = jsonToLines(data || {});
  return (
    <section className={`native-diagnostics-code-card ${className}`.trim()}>
      <div className="native-diagnostics-code-head">
        <Space size={8} align="center">
          <CodeOutlined />
          <Text strong>{title}</Text>
        </Space>
        <Button
          icon={<CopyOutlined />}
          aria-label={`复制${title}`}
          onClick={() => copyText(text, title)}
        />
      </div>
      <div className="native-diagnostics-code">
        {lines.map((line, index) => (
          <div className="native-diagnostics-code-line" key={`${title}-${index}-${line}`}>
            <span className="native-diagnostics-code-no">{index + 1}</span>
            <code>{renderJsonLine(line)}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function warnTone(category: string) {
  if (category === 'ready') return 'success';
  if (category === 'failed') return 'error';
  if (category === 'skipped') return 'default';
  return 'warning';
}

function DiagnosticsSummary({ data }: { data: any }) {
  const keys = data?.keys || {};
  return (
    <div className="native-diagnostics-summary">
      <Descriptions size="small" bordered column={3}>
        <Descriptions.Item label="Repo root">{data?.repoRoot || '-'}</Descriptions.Item>
        <Descriptions.Item label="Queue path">{data?.queuePath || '-'}</Descriptions.Item>
        <Descriptions.Item label="Active Profile">{data?.activeProfile || '-'}</Descriptions.Item>
        <Descriptions.Item label="Key status" span={3}>
          <Space wrap>
            {Object.keys(keys).length > 0 ? Object.keys(keys).map((key) => (
              <Tag key={key} color={keys[key] === 'configured' ? 'success' : undefined}>
                {key}:{keys[key] || 'unset'}
              </Tag>
            )) : <Tag>no keys</Tag>}
          </Space>
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

function DiagnosticsWarnings({ warnings }: { warnings: WarningRow[] }) {
  const grouped = useMemo(() => warnings || [], [warnings]);
  return (
    <div className="native-diagnostics-warnings">
      {grouped.length === 0 ? (
        <Empty description="无警告" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={grouped}
          renderItem={(row) => (
            <List.Item>
              <Space wrap>
                <Tag color={warnTone(row.category)}>{row.category}</Tag>
                <Text>{row.message}</Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}

export function DiagnosticsView({ data, onRefresh }: DiagnosticsPanelProps) {
  const d = data || {};
  const eff = d.effectiveConfig || {};
  const srcs = d.configSources || {};
  const last = d.lastRunState || d.state || {};
  const warns: WarningRow[] = Array.isArray(d.warnings) ? d.warnings : [];

  const handleCopy = () => {
    copyText(JSON.stringify(d, null, 2), 'redacted diagnostics artifact JSON');
  };

  return (
    <div className="native-diagnostics-panel">
      <div className="native-diagnostics-topbar">
        <Title level={5}>Diagnostics（只读）</Title>
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>刷新</Button>
          <Button size="small" icon={<SnippetsOutlined />} onClick={handleCopy}>Copy JSON</Button>
        </Space>
      </div>

      <DiagnosticsSummary data={d} />

      <div className="native-diagnostics-grid">
        <CodeCard title="Effective config" data={eff} className="native-diagnostics-code-effective" />
        <CodeCard title="Config sources" data={srcs} className="native-diagnostics-code-sources" />
        <CodeCard title="Last run state" data={last} className="native-diagnostics-code-last" />
        <section className="native-diagnostics-warning-card">
          <div className="native-diagnostics-code-head">
            <Space size={8} align="center">
              <CodeOutlined />
              <Text strong>Warnings（分类）</Text>
            </Space>
          </div>
          <DiagnosticsWarnings warnings={warns} />
        </section>
      </div>

      <Text type="secondary" className="native-diagnostics-footer-note">
        所有数据已通过 redaction helper；不执行网络检查；只读。
      </Text>

      <section className="native-settings-footer-card native-diagnostics-footer-card">
        <div className="native-settings-panel-head">
          <Text strong>设置导入 / 导出（redacted）</Text>
          <div className="native-diagnostics-import-row">
            <Button>导出设置（仅 activeProfile、非敏感、key 状态）</Button>
            <Button>导入设置（文件上传）</Button>
          </div>
        </div>
        <Alert
          type="info"
          showIcon
          message="非敏感配置保存在 VS Code 工作区设置，敏感 Key 保存在 SecretStorage；队列 defaults 支持预览后确认 apply 写入；仅 owned 支持键，secrets 拒绝；写后 JSON + tasks 校验。"
        />
      </section>
    </div>
  );
}

export { DiagnosticsView as DiagnosticsPanel };
export default DiagnosticsView;
