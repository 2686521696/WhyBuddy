/**
 * AppRuntimeScreen — JSON 渲染出的"真系统"（应用运行，浏览器运行时 M1）。
 *
 * el-form-renderer / el-data-table 哲学：菜单、表格、表单全部由
 * app-runtime-schema（从五系统模型推导的 JSON）驱动，antd 组件渲染成
 * 一个看起来像真实启动的后台系统——侧边菜单 + 页头 + 数据表格 + 新建表单弹窗，
 * 提交即写实体行；挂了审批流的页面可一键把某行提交进真实状态机。
 * 零后端、零数据库：状态在 live-runtime 内核 + localStorage。
 */

import React from "react";
import { Layout, Menu, Table, Button, Modal, Input, InputNumber, DatePicker, Select, Tag, Space, message } from "antd";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import { deriveAppRuntimeSchema, type AppFormFieldSchema, type AppPageSchema } from "./app-runtime-schema";
import {
  type RuntimeState,
  initRuntimeState,
  addRow,
  deleteRow,
  validateRowValues,
  startInstance,
} from "./live-runtime";
import {
  loadRuntimeState,
  saveRuntimeState,
  notifyRuntimeChanged,
  subscribeRuntimeChanged,
} from "./runtime-persistence";

function FieldInput({
  field,
  value,
  refRows,
  onChange,
}: {
  field: AppFormFieldSchema;
  value: unknown;
  refRows: Array<{ id: string; label: string }>;
  onChange: (v: unknown) => void;
}) {
  if (field.type === "number") {
    return (
      <InputNumber
        style={{ width: "100%" }}
        value={value as number | undefined}
        onChange={(v) => onChange(v)}
        placeholder={field.label}
      />
    );
  }
  if (field.type === "date" || field.type === "datetime") {
    return (
      <Input type={field.type === "date" ? "date" : "datetime-local"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (field.type === "enum") {
    return (
      <Select
        style={{ width: "100%" }}
        mode="tags"
        maxCount={1}
        value={value ? [String(value)] : []}
        onChange={(v) => onChange(v.at(-1) ?? "")}
        placeholder={`${field.label}（输入后回车）`}
      />
    );
  }
  if (field.type === "ref" && refRows.length > 0) {
    return (
      <Select
        style={{ width: "100%" }}
        value={(value as string) || undefined}
        onChange={(v) => onChange(v)}
        options={refRows.map((r) => ({ value: r.id, label: r.label }))}
        placeholder={`选择${field.label}`}
      />
    );
  }
  return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={field.label} />;
}

export function AppRuntimeScreen({
  model,
  sessionId,
  appTitle,
}: {
  model: FiveSystemModel;
  sessionId: string;
  appTitle?: string;
}) {
  const schema = React.useMemo(
    () => deriveAppRuntimeSchema(model, appTitle || "推演应用"),
    [model, appTitle]
  );
  const [state, setState] = React.useState<RuntimeState>(() => {
    return loadRuntimeState(sessionId) ?? initRuntimeState(model);
  });
  const [activePageId, setActivePageId] = React.useState<string | null>(
    schema?.pages[0]?.id ?? null
  );
  const [role, setRole] = React.useState<string | undefined>(schema?.roles[0]);
  const [formOpen, setFormOpen] = React.useState(false);
  const [formValues, setFormValues] = React.useState<Record<string, unknown>>({});

  // 与工作流试运行面共享一份状态：对方变更时重载
  React.useEffect(
    () => subscribeRuntimeChanged(sessionId, () => setState(loadRuntimeState(sessionId) ?? initRuntimeState(model))),
    [sessionId, model]
  );

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-stone-400">
        本话题模型缺少页面/实体定义，推演闭环后可运行应用
      </div>
    );
  }

  const page: AppPageSchema | null = schema.pages.find((p) => p.id === activePageId) ?? schema.pages[0] ?? null;
  const rows = page?.entityId ? state.entities[page.entityId] ?? [] : [];

  const apply = (next: RuntimeState) => {
    setState(next);
    saveRuntimeState(sessionId, next);
    notifyRuntimeChanged(sessionId);
  };

  const refRowsFor = (field: AppFormFieldSchema) => {
    if (!field.refEntityId) return [];
    return (state.entities[field.refEntityId] ?? []).map((r) => ({
      id: r.id,
      label: String(Object.values(r.values)[0] ?? r.id),
    }));
  };

  const handleCreate = () => {
    if (!page?.entityId) return;
    const problems = validateRowValues(model, page.entityId, formValues);
    if (problems.length > 0) {
      message.warning(problems.join("；"));
      return;
    }
    const { state: next } = addRow(state, page.entityId, formValues, new Date().toISOString());
    apply(next);
    setFormOpen(false);
    setFormValues({});
    message.success("已保存");
  };

  const handleSubmitToWorkflow = (rowId: string, rowLabel: string) => {
    if (!page?.entityId) return;
    const { state: next, instance } = startInstance(
      state,
      model,
      `${page.title} · ${rowLabel}`,
      new Date().toISOString(),
      { entityId: page.entityId, rowId }
    );
    if (instance) {
      apply(next);
      message.success(`已提交审批：${instance.title}（到 Workflow 试运行里推进）`);
    }
  };

  const columns = [
    ...(page?.columns ?? []).map((c) => ({
      title: c.label,
      dataIndex: ["values", c.id],
      key: c.id,
      ellipsis: true,
      render: (v: unknown) => (v === undefined || v === "" ? <span style={{ color: "#bbb" }}>—</span> : String(v)),
    })),
    {
      title: "操作",
      key: "__actions",
      width: 170,
      render: (_: unknown, row: { id: string; values: Record<string, unknown> }) => (
        <Space size="small">
          {page?.workflowLinked && (
            <Button
              size="small"
              type="link"
              onClick={() => handleSubmitToWorkflow(row.id, String(Object.values(row.values)[0] ?? row.id))}
            >
              提交审批
            </Button>
          )}
          <Button
            size="small"
            type="link"
            danger
            onClick={() => apply(deleteRow(state, page!.entityId!, row.id))}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="h-full w-full overflow-hidden" data-testid="app-runtime-screen">
      <Layout style={{ height: "100%" }}>
        <Layout.Sider width={168} theme="light" style={{ borderRight: "1px solid #f0f0f0" }}>
          <div style={{ padding: "12px 16px", fontWeight: 600, fontSize: 13, borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={schema.appName}>
            {schema.appName}
          </div>
          <Menu
            mode="inline"
            selectedKeys={page ? [page.id] : []}
            onClick={({ key }) => setActivePageId(String(key))}
            items={schema.menus.map((m) => ({ key: m.pageId, label: m.label }))}
            style={{ borderInlineEnd: "none" }}
          />
        </Layout.Sider>
        <Layout>
          <Layout.Header style={{ background: "#fff", padding: "0 16px", height: 44, lineHeight: "44px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{page?.title ?? ""}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "#999" }}>当前角色</span>
            <Select
              size="small"
              style={{ minWidth: 130 }}
              value={role}
              onChange={setRole}
              options={schema.roles.map((r) => ({ value: r, label: r }))}
              data-testid="app-runtime-role"
            />
          </Layout.Header>
          <Layout.Content style={{ padding: 12, overflow: "auto", background: "#f5f5f5" }}>
            <div style={{ background: "#fff", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 8 }}>
                {(page?.actions ?? []).slice(0, 3).map((a) => (
                  <Tag key={a} color="blue" style={{ marginInlineEnd: 0 }}>
                    {a}
                  </Tag>
                ))}
                <span style={{ flex: 1 }} />
                <Button type="primary" size="small" onClick={() => { setFormValues({}); setFormOpen(true); }} disabled={!page?.entityId} data-testid="app-runtime-create">
                  新建
                </Button>
              </div>
              <Table
                size="small"
                rowKey="id"
                columns={columns as any}
                dataSource={rows}
                pagination={rows.length > 8 ? { pageSize: 8 } : false}
                locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
              />
            </div>
          </Layout.Content>
        </Layout>
      </Layout>

      <Modal
        title={`新建 · ${page?.title ?? ""}`}
        open={formOpen}
        onOk={handleCreate}
        onCancel={() => setFormOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
          {(page?.formFields ?? []).map((f) => (
            <div key={f.id}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                {f.label}
                <span style={{ color: "#bbb", marginLeft: 6 }}>{f.type}</span>
              </div>
              <FieldInput
                field={f}
                value={formValues[f.id]}
                refRows={refRowsFor(f)}
                onChange={(v) => setFormValues((prev) => ({ ...prev, [f.id]: v }))}
              />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
