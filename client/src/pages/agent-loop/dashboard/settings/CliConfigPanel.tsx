import { useEffect } from 'react';
import { Alert, Button, Col, Form, Input, InputNumber, message, Row, Select, Space, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import type { CliConfigFormProps } from './types';

const { Text } = Typography;

// CliConfigForm kept for existing test contract and direct renders.
// File is CliConfigPanel.tsx per allowed split module boundary.
export function CliConfigForm({ initial, onSave, queueRunning, activeProfile }: CliConfigFormProps) {
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
    if (runtimeLocked('fixAgent') || runtimeLocked('reviewAgent') || runtimeLocked('queuePath') || runtimeLocked('worktreeScope')) {
      message.warning('队列运行中，运行时 profile 字段已禁用');
      return;
    }
    onSave(values);
    message.success('CLI 配置已保存');
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleFinish} className="native-cli-form">
      {isRunning ? (
        <Alert
          type="warning"
          showIcon
          className="native-cli-running-alert"
          message={`队列运行中 (激活 Profile: ${activeProfile || '未知'})，运行时字段已锁定`}
          description="已锁定: fixAgent, reviewAgent, queuePath, worktreeScope（影响运行 profile/worker 配置）。workerMaxTurns / workerMaxRetries 为安全非运行时字段，可正常编辑。"
        />
      ) : null}

      <Row gutter={[36, 18]}>
        <Col xs={24} md={12}>
          <Form.Item label="默认修复 Worker" name="fixAgent" extra="用于自动修复任务的默认 Worker 实现。">
            <Select disabled={runtimeLocked('fixAgent')}>
              <Select.Option value="grok">Grok</Select.Option>
              <Select.Option value="codex">Codex</Select.Option>
            </Select>
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label="默认 Review Worker" name="reviewAgent" extra="用于代码 Review 的默认 Worker 实现。">
            <Select disabled={runtimeLocked('reviewAgent')}>
              <Select.Option value="codex">Codex</Select.Option>
              <Select.Option value="grok">Grok</Select.Option>
              <Select.Option value="none">None（跳过审查）</Select.Option>
            </Select>
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label="最大执行轮次" name="workerMaxTurns" extra="单次任务的最大执行轮次上限。">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label="最大重试次数" name="workerMaxRetries" extra="任务失败时的最大重试次数。">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label="队列文件路径" name="queuePath" extra="待处理任务队列文件的路径（相对或绝对）。">
            <Input placeholder="agent-loop/scripts/migration-queue.json" disabled={runtimeLocked('queuePath')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label="工作模式" name="worktreeScope" extra="AgentLoop 运行模式。">
            <Select disabled={runtimeLocked('worktreeScope')}>
              <Select.Option value="queue">queue</Select.Option>
              <Select.Option value="task">task</Select.Option>
            </Select>
          </Form.Item>
        </Col>
      </Row>

      <Form.Item className="native-cli-submit">
        <Space size="middle" wrap>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} disabled={runtimeLocked('fixAgent') || runtimeLocked('reviewAgent')}>
            保存 CLI 配置
          </Button>
          <Text type="secondary">保存后，CLI 将使用新的配置生效。</Text>
        </Space>
      </Form.Item>
    </Form>
  );
}

// Also export under panel name for boundary clarity
export { CliConfigForm as CliConfigPanel };
export default CliConfigForm;
