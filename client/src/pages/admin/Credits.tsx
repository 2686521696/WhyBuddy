/**
 * 超管：额度。照 New API 的管理台——用户额度（编辑余额）、兑换码（批量生成 / 停用 / 删除 / 导出）、日志、运营设置（倍率）。
 *
 * ⚠ 2026-10-09 积分制（slide-rule-python/services/credit_ledger.py 头注）。数额全用积分（100 积分 = 1 美元）。
 *   兑换码只在生成的那一刻成批给出（之后列表里也看得到，方便补发），生成后弹窗里能一键复制、下载 txt。
 */
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import React from "react";

import {
  CREDIT_KIND_LABEL,
  creditsApi,
  describeCreditLog,
  formatCreditTime,
  formatPoints,
  type CreditCode,
  type CreditLog,
  type CreditOptions,
  type CreditUserRow,
} from "@/lib/credits-client";

function useErrorText() {
  const [error, setError] = React.useState("");
  const wrap = React.useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      const out = await work();
      setError("");
      return out;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }, []);
  return { error, setError, wrap };
}

// ── 用户额度 ──────────────────────────────────────────────────────────────

function UsersTab() {
  const [rows, setRows] = React.useState<CreditUserRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [editing, setEditing] = React.useState<CreditUserRow | null>(null);
  const [form] = Form.useForm<{ mode: "add" | "set"; points: number; note: string }>();
  const { error, setError, wrap } = useErrorText();

  const load = React.useCallback(
    async (nextPage = 1, query = q) => {
      setLoading(true);
      const got = await wrap(() => creditsApi.admin.users(query, nextPage, 20));
      if (got) {
        setRows(got.items);
        setTotal(got.total);
        setPage(nextPage);
      }
      setLoading(false);
    },
    [q, wrap]
  );

  React.useEffect(() => {
    void load(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    const got = await wrap(() => creditsApi.admin.adjust(editing.id, values));
    if (got) {
      message.success(`已调整：${got.deltaPoints >= 0 ? "+" : ""}${formatPoints(got.deltaPoints)} 积分`);
      setEditing(null);
      await load(page);
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Input.Search
        placeholder="按邮箱 / 名字 / id 搜索"
        allowClear
        onSearch={value => {
          setQ(value);
          void load(1, value);
        }}
        style={{ maxWidth: 360 }}
      />
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
      <Table<CreditUserRow>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, pageSize: 20, total, onChange: next => void load(next) }}
        columns={[
          {
            title: "用户",
            key: "user",
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <span>
                  {row.email} {row.isSuperuser ? <Tag color="gold">超管</Tag> : null}
                </span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {row.name || row.id}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: "余额（积分）",
            key: "points",
            render: (_, row) =>
              row.account ? (
                <span style={{ color: row.account.points <= 0 ? "#cf1322" : undefined }}>
                  {formatPoints(row.account.points)}
                </span>
              ) : (
                <Typography.Text type="secondary">尚未开户</Typography.Text>
              ),
          },
          { title: "已用（积分）", key: "used", render: (_, row) => (row.account ? formatPoints(row.account.usedPoints) : "-") },
          { title: "请求次数", key: "count", render: (_, row) => row.account?.requestCount ?? "-" },
          {
            title: "",
            key: "op",
            width: 90,
            render: (_, row) => (
              <Button
                size="small"
                onClick={() => {
                  form.setFieldsValue({ mode: "add", points: 100, note: "" });
                  setEditing(row);
                }}
              >
                调整
              </Button>
            ),
          },
        ]}
      />
      <Modal
        open={Boolean(editing)}
        title={editing ? `调整额度：${editing.email}` : ""}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        okText="确定"
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          当前余额 {editing?.account ? formatPoints(editing.account.points) : "（尚未开户，开户时先送新用户额度）"} 积分。
          每次调整都记一条「管理」明细，写明是谁改的。
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item name="mode" label="方式">
            <Radio.Group
              options={[
                { label: "增加（填负数是扣减）", value: "add" },
                { label: "直接设成", value: "set" },
              ]}
            />
          </Form.Item>
          <Form.Item name="points" label="积分" rules={[{ required: true, message: "填一个数" }]}>
            <InputNumber style={{ width: "100%" }} step={100} />
          </Form.Item>
          <Form.Item name="note" label="原因（选填）">
            <Input maxLength={200} placeholder="比如：内测补偿" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

// ── 兑换码 ────────────────────────────────────────────────────────────────

const CODE_STATUS: Record<CreditCode["status"], { label: string; color: string }> = {
  enabled: { label: "可用", color: "green" },
  disabled: { label: "已停用", color: "default" },
  used: { label: "已兑换", color: "blue" },
  expired: { label: "已过期", color: "orange" },
  unknown: { label: "未知", color: "default" },
};

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function CodesTab() {
  const [rows, setRows] = React.useState<CreditCode[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<CreditCode[] | null>(null);
  const [form] = Form.useForm<{ name: string; points: number; count: number; days: number }>();
  const { error, setError, wrap } = useErrorText();

  const load = React.useCallback(
    async (nextPage = 1, nextStatus = status, nextKeyword = keyword) => {
      setLoading(true);
      const got = await wrap(() =>
        creditsApi.admin.codes({ status: nextStatus, keyword: nextKeyword, page: nextPage, size: 20 })
      );
      if (got) {
        setRows(got.items);
        setTotal(got.total);
        setPage(nextPage);
      }
      setLoading(false);
    },
    [status, keyword, wrap]
  );

  React.useEffect(() => {
    void load(1, "", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    const values = await form.validateFields();
    const expiresAt = values.days > 0 ? Date.now() / 1000 + values.days * 86400 : null;
    const got = await wrap(() =>
      creditsApi.admin.createCodes({ name: values.name, points: values.points, count: values.count, expiresAt })
    );
    if (got) {
      setCreating(false);
      setCreated(got.items);
      await load(1);
    }
  };

  const createdText = (created || []).map(row => row.code).join("\n");

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space wrap>
        <Button
          type="primary"
          onClick={() => {
            form.setFieldsValue({ name: "", points: 100, count: 10, days: 0 });
            setCreating(true);
          }}
        >
          生成兑换码
        </Button>
        <Select
          value={status}
          style={{ width: 120 }}
          onChange={value => {
            setStatus(value);
            void load(1, value);
          }}
          options={[
            { label: "全部状态", value: "" },
            { label: "可用", value: "enabled" },
            { label: "已兑换", value: "used" },
            { label: "已停用", value: "disabled" },
            { label: "已过期", value: "expired" },
          ]}
        />
        <Input.Search
          placeholder="按批次名 / 码的开头搜索"
          allowClear
          onSearch={value => {
            setKeyword(value);
            void load(1, status, value);
          }}
          style={{ width: 280 }}
        />
      </Space>
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
      <Table<CreditCode>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, pageSize: 20, total, onChange: next => void load(next) }}
        columns={[
          { title: "批次", dataIndex: "name", ellipsis: true },
          {
            title: "兑换码",
            dataIndex: "code",
            render: (code: string) => <Typography.Text copyable={{ text: code }} code>{code}</Typography.Text>,
          },
          { title: "积分", dataIndex: "points", width: 90, render: (points: number) => formatPoints(points) },
          {
            title: "状态",
            dataIndex: "status",
            width: 90,
            render: (value: CreditCode["status"]) => <Tag color={CODE_STATUS[value].color}>{CODE_STATUS[value].label}</Tag>,
          },
          {
            title: "过期",
            dataIndex: "expiresAt",
            width: 110,
            render: (value: number) => (value ? formatCreditTime(value) : "永不"),
          },
          { title: "兑换人", dataIndex: "usedBy", ellipsis: true, render: (value: string | null) => value || "-" },
          {
            title: "",
            key: "op",
            width: 150,
            render: (_, row) =>
              row.status === "used" ? null : (
                <Space size="small">
                  {row.status === "disabled" ? (
                    <Button
                      size="small"
                      onClick={() => void wrap(() => creditsApi.admin.setCodeStatus(row.id, "enabled")).then(() => load(page))}
                    >
                      启用
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      onClick={() => void wrap(() => creditsApi.admin.setCodeStatus(row.id, "disabled")).then(() => load(page))}
                    >
                      停用
                    </Button>
                  )}
                  <Popconfirm
                    title="删除这个兑换码？"
                    onConfirm={() => void wrap(() => creditsApi.admin.deleteCode(row.id)).then(() => load(page))}
                  >
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
          },
        ]}
      />
      <Modal
        open={creating}
        title="生成兑换码"
        onCancel={() => setCreating(false)}
        onOk={() => void create()}
        okText="生成"
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="批次名称" rules={[{ required: true, message: "写个名字，方便以后查" }]}>
            <Input maxLength={120} placeholder="比如：10 月内测" />
          </Form.Item>
          <Form.Item name="points" label="每个码多少积分（100 积分 = 1 美元）" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="count" label="生成几个（最多 500）" rules={[{ required: true }]}>
            <InputNumber min={1} max={500} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="days" label="几天后过期（0 = 永不过期）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={Boolean(created)}
        title={`已生成 ${created?.length ?? 0} 个兑换码`}
        onCancel={() => setCreated(null)}
        footer={
          <Space>
            <Button onClick={() => void navigator.clipboard?.writeText(createdText).then(() => message.success("已复制"))}>
              全部复制
            </Button>
            <Button onClick={() => downloadText(`兑换码-${created?.[0]?.name || "batch"}.txt`, createdText)}>
              下载 txt
            </Button>
            <Button type="primary" onClick={() => setCreated(null)}>
              完成
            </Button>
          </Space>
        }
      >
        <Input.TextArea value={createdText} readOnly autoSize={{ minRows: 4, maxRows: 14 }} />
      </Modal>
    </Space>
  );
}

// ── 明细 ──────────────────────────────────────────────────────────────────

function LogsTab() {
  const [rows, setRows] = React.useState<CreditLog[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [kind, setKind] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const { error, setError, wrap } = useErrorText();

  const load = React.useCallback(
    async (nextPage = 1, nextKind = kind, nextUser = userId) => {
      setLoading(true);
      const got = await wrap(() => creditsApi.admin.logs({ kind: nextKind, userId: nextUser, page: nextPage, size: 20 }));
      if (got) {
        setRows(got.items);
        setTotal(got.total);
        setPage(nextPage);
      }
      setLoading(false);
    },
    [kind, userId, wrap]
  );

  React.useEffect(() => {
    void load(1, "", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space wrap>
        <Select
          value={kind}
          style={{ width: 120 }}
          onChange={value => {
            setKind(value);
            void load(1, value);
          }}
          options={[{ label: "全部类型", value: "" }, ...Object.entries(CREDIT_KIND_LABEL).map(([value, label]) => ({ label, value }))]}
        />
        <Input.Search
          placeholder="按用户 id 筛选"
          allowClear
          onSearch={value => {
            setUserId(value.trim());
            void load(1, kind, value.trim());
          }}
          style={{ width: 280 }}
        />
      </Space>
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
      <Table<CreditLog>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, pageSize: 20, total, onChange: next => void load(next) }}
        columns={[
          { title: "时间", dataIndex: "createdAt", width: 110, render: value => formatCreditTime(value) },
          { title: "用户", dataIndex: "ownerId", width: 200, ellipsis: true },
          { title: "类型", dataIndex: "kind", width: 70, render: (value: CreditLog["kind"]) => CREDIT_KIND_LABEL[value] },
          {
            title: "积分",
            dataIndex: "points",
            width: 90,
            render: (points: number) => `${points > 0 ? "+" : ""}${formatPoints(points)}`,
          },
          {
            title: "余额",
            dataIndex: "balancePoints",
            width: 90,
            render: (value: number | null) => (value == null ? "-" : formatPoints(value)),
          },
          { title: "说明", key: "what", ellipsis: true, render: (_, row) => describeCreditLog(row) },
          { title: "操作人", dataIndex: "actor", width: 160, ellipsis: true, render: (value: string | null) => value || "-" },
        ]}
      />
    </Space>
  );
}

// ── 价格设置 ──────────────────────────────────────────────────────────────

type OptionsForm = {
  quotaForNewUserPoints: number;
  default_model_ratio: number;
  default_completion_ratio: number;
  default_cache_ratio: number;
  model_ratio: string;
  completion_ratio: string;
  cache_ratio: string;
  computerPointsPerHour: number;
  imagePoints: number;
  enforcement_enabled: boolean;
  superuser_exempt: boolean;
};

function OptionsTab() {
  const [form] = Form.useForm<OptionsForm>();
  const [options, setOptions] = React.useState<CreditOptions | null>(null);
  const [saving, setSaving] = React.useState(false);
  const { error, setError, wrap } = useErrorText();

  const fill = React.useCallback(
    (got: CreditOptions) => {
      setOptions(got);
      form.setFieldsValue({
        quotaForNewUserPoints: got.quotaForNewUserPoints,
        default_model_ratio: got.default_model_ratio,
        default_completion_ratio: got.default_completion_ratio,
        default_cache_ratio: got.default_cache_ratio,
        model_ratio: JSON.stringify(got.model_ratio, null, 2),
        completion_ratio: JSON.stringify(got.completion_ratio, null, 2),
        cache_ratio: JSON.stringify(got.cache_ratio, null, 2),
        computerPointsPerHour: got.computerPointsPerHour,
        imagePoints: got.imagePoints,
        enforcement_enabled: got.enforcement_enabled,
        superuser_exempt: got.superuser_exempt,
      });
    },
    [form]
  );

  React.useEffect(() => {
    void wrap(() => creditsApi.admin.options()).then(got => got && fill(got));
  }, [wrap, fill]);

  const save = async () => {
    const values = await form.validateFields();
    let maps: Record<string, Record<string, number>>;
    try {
      maps = {
        model_ratio: JSON.parse(values.model_ratio || "{}"),
        completion_ratio: JSON.parse(values.completion_ratio || "{}"),
        cache_ratio: JSON.parse(values.cache_ratio || "{}"),
      };
    } catch {
      setError("按模型定价那三栏要写成 JSON，比如 {\"gpt-5\": 0.625}");
      return;
    }
    const perPoint = options?.quotaPerPoint || 5000;
    setSaving(true);
    const got = await wrap(() =>
      creditsApi.admin.saveOptions({
        quota_for_new_user: Math.round(values.quotaForNewUserPoints * perPoint),
        default_model_ratio: values.default_model_ratio,
        default_completion_ratio: values.default_completion_ratio,
        default_cache_ratio: values.default_cache_ratio,
        ...maps,
        computer_quota_per_minute: Math.round((values.computerPointsPerHour * perPoint) / 60),
        image_quota: Math.round(values.imagePoints * perPoint),
        enforcement_enabled: values.enforcement_enabled,
        superuser_exempt: values.superuser_exempt,
      })
    );
    setSaving(false);
    if (got) {
      fill(got);
      message.success("已保存，立即生效");
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%", maxWidth: 720 }}>
      <Typography.Paragraph type="secondary">
        照 New API 的倍率：一次模型调用扣 =（未命中缓存的输入 + 命中缓存的输入 × 缓存倍率 + 输出 × 补全倍率）× 模型倍率 额度；
        模型倍率 1 = 每百万 token 2 美元。没在按模型定价里点名的模型用默认那一组。改完立即生效。
      </Typography.Paragraph>
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
      <Form form={form} layout="vertical">
        <Form.Item name="quotaForNewUserPoints" label="新用户赠送（积分）">
          <InputNumber min={0} style={{ width: 200 }} />
        </Form.Item>
        <Space size="large" wrap>
          <Form.Item name="default_model_ratio" label="默认模型倍率">
            <InputNumber min={0} step={0.125} />
          </Form.Item>
          <Form.Item name="default_completion_ratio" label="默认补全倍率">
            <InputNumber min={0} step={1} />
          </Form.Item>
          <Form.Item name="default_cache_ratio" label="默认缓存倍率">
            <InputNumber min={0} max={1} step={0.05} />
          </Form.Item>
        </Space>
        <Form.Item name="model_ratio" label="按模型定价：模型倍率（JSON，键可以是前缀）">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} spellCheck={false} />
        </Form.Item>
        <Form.Item name="completion_ratio" label="按模型定价：补全倍率（JSON）">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} spellCheck={false} />
        </Form.Item>
        <Form.Item name="cache_ratio" label="按模型定价：缓存倍率（JSON）">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} spellCheck={false} />
        </Form.Item>
        <Space size="large" wrap>
          <Form.Item name="computerPointsPerHour" label="工程电脑（积分 / 小时）">
            <InputNumber min={0} step={1} />
          </Form.Item>
          <Form.Item name="imagePoints" label="生图（积分 / 张）">
            <InputNumber min={0} step={1} />
          </Form.Item>
        </Space>
        <Space size="large" wrap>
          <Form.Item name="enforcement_enabled" label="余额用完时拦截" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="superuser_exempt" label="超管不受拦截（照常记账）" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存
        </Button>
      </Form>
    </Space>
  );
}

export function AdminCreditsPage() {
  return (
    <div data-testid="admin-credits">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        额度
      </Typography.Title>
      <Tabs
        items={[
          { key: "users", label: "用户额度", children: <UsersTab /> },
          { key: "codes", label: "兑换码", children: <CodesTab /> },
          { key: "logs", label: "额度明细", children: <LogsTab /> },
          { key: "options", label: "价格设置", children: <OptionsTab /> },
        ]}
      />
    </div>
  );
}
