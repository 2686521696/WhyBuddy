import { useMemo, useState } from 'react';
import { Alert, Button, message, Table, Typography } from 'antd';
import { CopyOutlined, DeploymentUnitOutlined, DiffOutlined, SyncOutlined } from '@ant-design/icons';
import { filterSupportedQueuePatch } from '../agentLoopApi';
import type { QueueDefaultsPanelProps } from './types';

const { Text } = Typography;

type DiffRow = {
  key: string;
  before: unknown;
  after: unknown;
};

function copyToClipboard(text: string, label: string) {
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

function computeClientDryRun(current: Record<string, unknown>, proposedPatch: Record<string, unknown>) {
  const before: Record<string, unknown> = { ...current };
  const after: Record<string, unknown> = { ...current, ...proposedPatch };
  const diffKeys = Object.keys({ ...before, ...after }).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return {
    before,
    after,
    diff: diffKeys.map((key) => ({ key, before: before[key], after: after[key] })),
    ok: true,
  };
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

function CodePreview({
  title,
  json,
  className,
  copyLabel,
}: {
  title: string;
  json: Record<string, unknown>;
  className: string;
  copyLabel: string;
}) {
  const text = JSON.stringify(json || {}, null, 2);
  const lines = jsonToLines(json || {});
  return (
    <section className={`native-queue-code-card ${className}`.trim()}>
      <div className="native-queue-code-title">
        <Text strong>{title}</Text>
        <Button
          aria-label={`复制${title}`}
          icon={<CopyOutlined />}
          onClick={() => copyToClipboard(text, copyLabel)}
        />
      </div>
      <div className="native-queue-code">
        {lines.map((line, index) => (
          <div className="native-queue-code-line" key={`${index}-${line}`}>
            <span className="native-queue-code-no">{index + 1}</span>
            <code>{renderJsonLine(line)}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function DiffTable({ rows }: { rows: DiffRow[] }) {
  if (!rows.length) {
    return <Text type="secondary" className="native-queue-empty-diff">no diff（与当前一致或空 patch）</Text>;
  }
  return (
    <Table
      size="small"
      className="native-queue-diff-table"
      columns={[
        { title: 'Key', dataIndex: 'key', key: 'key' },
        { title: 'Before', dataIndex: 'before', key: 'before', render: (value: unknown) => JSON.stringify(value) },
        { title: 'After', dataIndex: 'after', key: 'after', render: (value: unknown) => JSON.stringify(value) },
      ]}
      dataSource={rows.map((row, index) => ({ ...row, rowKey: row.key || String(index) }))}
      pagination={false}
      rowKey="rowKey"
    />
  );
}

// QueueDefaultsView name kept for test contract and direct <QueueDefaultsView ... />
export function QueueDefaultsView({ data, preview, onPreview, applyResult, onApply, settingsData }: QueueDefaultsPanelProps) {
  const current = (data && data.defaults) || {};
  const supported = (data && data.supportedKeys) || [];
  const isUnsupported = Boolean(data && (data.unsupported || (supported.length === 0 && !data.defaults)));
  const safeSupported = supported.length ? supported : ['fixAgent', 'reviewAgent', 'workerMaxTurns', 'workerMaxRetries', 'worktreeScope', 'queuePath'];

  const [proposedPatch, setProposedPatch] = useState<Record<string, unknown>>({ workerMaxTurns: 256 });
  const [lastRejected, setLastRejected] = useState<string[]>([]);

  const localDry = useMemo(() => computeClientDryRun(current, proposedPatch), [current, proposedPatch]);

  const previewPatch = (patchSource: Record<string, unknown>) => {
    const { patch, rejected } = filterSupportedQueuePatch(patchSource, safeSupported);
    setLastRejected(rejected);
    setProposedPatch(patch);
    onPreview(patch);
  };

  const doSyncFromSettings = () => {
    const source = (settingsData && (settingsData.nonSensitive || settingsData)) || {};
    const proposal: Record<string, unknown> = {};
    const supportedSet = new Set(safeSupported);
    for (const [key, value] of Object.entries(source)) {
      if (supportedSet.has(key)) proposal[key] = value;
    }
    previewPatch(proposal);
  };

  const doPreview = () => previewPatch(proposedPatch);

  const doApply = () => {
    const { patch, rejected } = filterSupportedQueuePatch(proposedPatch, safeSupported);
    setLastRejected(rejected);
    setProposedPatch(patch);
    onApply?.(patch);
  };

  const supportedLabel = safeSupported.join(', ');

  return (
    <div className="native-queue-defaults-panel">
      {isUnsupported ? (
        <Alert
          type="info"
          showIcon
          className="native-queue-alert"
          message="后端此切片为只读/不支持完整 queue defaults 持久化（honest state）"
          description="仅支持键预览与 patch 过滤可用；真实写入由后端 queue 文件处理。"
        />
      ) : null}

      <CodePreview
        title="队列 defaults（仅支持键，当前值）"
        json={current}
        className="native-queue-code-current"
        copyLabel="当前 defaults"
      />
      <Text type="secondary" className="native-queue-supported">
        supported: {supportedLabel}
      </Text>

      <section className="native-queue-patch-card">
        <CodePreview
          title="预览 patch（dry-run，仅支持键；不含 workerEnv）"
          json={proposedPatch}
          className="native-queue-code-patch"
          copyLabel="预览 patch"
        />
        <div className="native-queue-actions">
          <Button icon={<SyncOutlined />} onClick={doSyncFromSettings}>从 Settings 同步并预览 diff</Button>
          <Button icon={<DiffOutlined />} onClick={doPreview}>预览 structured diff（不写入）</Button>
          <Button type="primary" icon={<DeploymentUnitOutlined />} onClick={doApply}>确认应用（调用 bridge）</Button>
        </div>
        <Text type="secondary" className="native-queue-apply-note">
          预览确认后 apply 仅写入 owned 支持键；workerEnv/secrets 拒绝；写后强制 JSON 校验 + tasks 数组保留；失败时回滚。
        </Text>
      </section>

      {lastRejected.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          className="native-queue-alert"
          message="已剔除不支持或危险键"
          description={`以下键被拒绝/省略：${lastRejected.join(', ')}。仅 supported keys 可预览/apply。`}
        />
      ) : null}

      <section className="native-queue-diff-card">
        <div className="native-queue-diff-head">
          <Text strong>Dry-run diff（客户端计算，支持键 before/after）</Text>
          <Text type="secondary">Proposed（过滤后，仅支持键）</Text>
        </div>
        <DiffTable rows={localDry.diff as DiffRow[]} />
      </section>

      {preview ? (
        <section className={`native-queue-result-card ${preview.ok === false || preview.unsupported ? 'native-queue-result-muted' : ''}`}>
          {preview.ok === false || preview.unsupported ? (
            <Alert
              type="info"
              showIcon
              message={preview.error || preview.note || 'unsupported / read-only (bridge 返回 honest 状态)'}
              description="调用了 preview bridge；实际应用受后端 queue 能力限制，未伪造成功。"
            />
          ) : (
            <>
              <Text strong>Preview result（bridge 返回）</Text>
              <DiffTable rows={(preview.diff || []) as DiffRow[]} />
            </>
          )}
        </section>
      ) : null}

      {applyResult ? (
        <section className={`native-queue-result-card ${applyResult.ok === false || applyResult.unsupported ? 'native-queue-result-muted' : ''}`}>
          {applyResult.ok === false || applyResult.unsupported ? (
            <Alert
              type="info"
              showIcon
              message={(applyResult.rolledBack ? 'rolled back: ' : '') + (applyResult.error || 'unsupported / read-only')}
              description="已调用 apply bridge，未发明成功；请检查后端或直接编辑 queue 文件（受支持键限制）。"
            />
          ) : (
            <>
              <Text strong>Apply result（written + validated）</Text>
              <DiffTable rows={(applyResult.diff || []) as DiffRow[]} />
              <Text type="secondary" className="native-queue-apply-note">applied: {JSON.stringify(applyResult.applied || {})}</Text>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

export { QueueDefaultsView as QueueDefaultsPanel };
export default QueueDefaultsView;
