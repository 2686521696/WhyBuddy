/**
 * AppRuntimeScreen — JSON 渲染出的"真系统"（应用运行，浏览器运行时 M1.5）。
 *
 * el-form-renderer / el-data-table 哲学：菜单、统计卡、表格、表单全部由
 * app-runtime-schema（从五系统模型推导的 JSON）驱动，antd（稳定版 5.x）渲染成
 * Ant Design Pro 风格的后台系统——深色侧边栏 + 面包屑页头 + 工作台统计卡 +
 * 数据表格 + 新建表单弹窗；挂了审批流的页面可一键把某行提交进真实状态机。
 * 零后端、零数据库：状态在 live-runtime 内核 + localStorage。
 *
 * 16:9 缩放画布：内部按固定 1440×810 设计分辨率渲染，再用 CSS transform
 * 按容器等比缩小（"缩放 iframe"效果）；弹层通过 getPopupContainer 挂进画布，
 * 与画面一起缩放（antd 5 的 trigger 自带 scale 校正）。
 */

import React from "react";
import {
  Layout,
  Menu,
  Table,
  Button,
  Modal,
  Input,
  InputNumber,
  Select,
  Tag,
  Space,
  Card,
  Statistic,
  Breadcrumb,
  Avatar,
  List,
  ConfigProvider,
  message,
} from "antd";
import {
  DashboardOutlined,
  TableOutlined,
  ProfileOutlined,
  FormOutlined,
  AppstoreOutlined,
  UserOutlined,
  PlusOutlined,
  LockOutlined,
} from "@ant-design/icons";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import {
  deriveAppRuntimeSchema,
  type AppFormFieldSchema,
  type AppPageSchema,
  type AppRuntimeSchema,
} from "./app-runtime-schema";
import {
  type RuntimeState,
  initRuntimeState,
  addRow,
  deleteRow,
  validateRowValues,
  startInstance,
  nodeById,
} from "./live-runtime";
import {
  loadRuntimeState,
  saveRuntimeState,
  notifyRuntimeChanged,
  subscribeRuntimeChanged,
  loadRuntimeRole,
  saveRuntimeRole,
  notifyRoleChanged,
  subscribeRoleChanged,
} from "./runtime-persistence";
import { accessForRole, pageAccessForRole, type PageAccess } from "./rbac-preview";

// 固定设计分辨率：16:9（Ant Design Pro 的常见设计宽度 1440）
const DESIGN_W = 1440;
const DESIGN_H = 810;

/** 容器实测尺寸 → 等比缩放系数（min(宽比, 高比)，letterbox 居中）。 */
function useScaleToFit(): { ref: React.RefObject<HTMLDivElement | null>; scale: number } {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setScale(Math.min(w / DESIGN_W, h / DESIGN_H));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, scale };
}

const MENU_ICONS = [TableOutlined, ProfileOutlined, FormOutlined, AppstoreOutlined];

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

/** 工作台统计卡取值：对着运行时状态求值 schema 声明的 source。 */
function statValue(state: RuntimeState, schema: AppRuntimeSchema, source: string): number {
  if (source.startsWith("entity:")) return (state.entities[source.slice("entity:".length)] ?? []).length;
  if (source === "instances:running") return state.instances.filter((i) => i.status === "running").length;
  if (source === "instances:total") return state.instances.length;
  if (source === "roles") return schema.roles.length;
  return 0;
}

const INSTANCE_STATUS_TAG: Record<string, { color: string; label: string }> = {
  running: { color: "processing", label: "进行中" },
  completed: { color: "success", label: "已完成" },
  rejected: { color: "error", label: "已驳回" },
};

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
  const [activePageId, setActivePageId] = React.useState<string>("home");
  // 当前角色与 RBAC 屏「角色预览」共享（localStorage + 事件），谁改都实时生效
  const [role, setRole] = React.useState<string | undefined>(
    () => loadRuntimeRole(sessionId) ?? schema?.roles[0]
  );
  const [formOpen, setFormOpen] = React.useState(false);
  const [formValues, setFormValues] = React.useState<Record<string, unknown>>({});
  const { ref: fitRef, scale } = useScaleToFit();
  // 弹层（Modal/Select 下拉）挂进画布，跟随 transform 缩放
  const [canvasEl, setCanvasEl] = React.useState<HTMLDivElement | null>(null);

  // 与工作流试运行面共享一份状态：对方变更时重载
  React.useEffect(
    () => subscribeRuntimeChanged(sessionId, () => setState(loadRuntimeState(sessionId) ?? initRuntimeState(model))),
    [sessionId, model]
  );
  React.useEffect(
    () =>
      subscribeRoleChanged(sessionId, () => {
        const next = loadRuntimeRole(sessionId);
        if (next) setRole(next);
      }),
    [sessionId]
  );

  const changeRole = (next: string) => {
    setRole(next);
    saveRuntimeRole(sessionId, next);
    notifyRoleChanged(sessionId);
  };

  // 角色 → 页面可见性/操作权（RBAC 模型驱动；公共页恒可见）
  const pageAccess = React.useMemo(() => {
    const map = new Map<string, PageAccess>();
    if (!schema) return map;
    for (const a of pageAccessForRole(schema.pages, accessForRole(model, role))) {
      map.set(a.pageId, a);
    }
    return map;
  }, [schema, model, role]);

  // 当前页对该角色不可见时回工作台（角色切换的直观反馈）
  React.useEffect(() => {
    if (activePageId !== "home" && pageAccess.get(activePageId)?.visible === false) {
      setActivePageId("home");
    }
  }, [activePageId, pageAccess]);

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-stone-400">
        本话题模型缺少页面/实体定义，推演闭环后可运行应用
      </div>
    );
  }

  const isHome = activePageId === "home";
  const page: AppPageSchema | null = isHome
    ? null
    : schema.pages.find((p) => p.id === activePageId) ?? schema.pages[0] ?? null;
  const currentTitle = isHome ? schema.home.title : page?.title ?? "";
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

  const recentInstances = [...state.instances].slice(-5).reverse();

  const homeContent = (
    <>
      <div style={{ display: "flex", gap: 16 }}>
        {schema.home.stats.map((s) => (
          <Card key={s.id} size="small" style={{ flex: 1 }} styles={{ body: { padding: "16px 20px" } }}>
            <Statistic title={s.label} value={statValue(state, schema, s.source)} suffix={s.suffix} />
          </Card>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        <Card title="快速入口" size="small" style={{ flex: 1 }}>
          <Space wrap>
            {schema.pages.map((p) => {
              const locked = pageAccess.get(p.id)?.visible === false;
              return (
                <Button
                  key={p.id}
                  icon={locked ? <LockOutlined /> : undefined}
                  disabled={locked}
                  title={locked ? `当前角色（${role ?? "-"}）无本页权限` : undefined}
                  onClick={() => setActivePageId(p.id)}
                >
                  {p.title}
                </Button>
              );
            })}
          </Space>
          {[...pageAccess.values()].some((a) => !a.visible) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#999" }}>
              <LockOutlined /> 当前角色不可见{" "}
              {[...pageAccess.values()].filter((a) => !a.visible).length} 个页面 —
              右上角切换角色试试（RBAC 权限实时生效）
            </div>
          )}
        </Card>
        <Card title="审批动态" size="small" style={{ flex: 1.4 }}>
          <List
            size="small"
            locale={{ emptyText: "暂无流程实例 — 到业务页面「提交审批」发起" }}
            dataSource={recentInstances}
            renderItem={(inst) => {
              const meta = INSTANCE_STATUS_TAG[inst.status] ?? INSTANCE_STATUS_TAG.running;
              return (
                <List.Item>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {inst.title}
                  </span>
                  <span style={{ color: "#999", fontSize: 12, margin: "0 12px" }}>
                    {nodeById(model, inst.currentNodeId)?.name ?? inst.currentNodeId}
                  </span>
                  <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                    {meta.label}
                  </Tag>
                </List.Item>
              );
            }}
          />
        </Card>
      </div>
    </>
  );

  const pageContent = page && (
    <Card
      size="small"
      title={page.title}
      extra={
        <Space size="small">
          {page.actions.slice(0, 3).map((a) => (
            <Tag key={a} color="blue" style={{ marginInlineEnd: 0 }}>
              {a}
            </Tag>
          ))}
          <Button
            type="primary"
            icon={pageAccess.get(page.id)?.canCreate === false ? <LockOutlined /> : <PlusOutlined />}
            onClick={() => {
              setFormValues({});
              setFormOpen(true);
            }}
            disabled={!page.entityId || pageAccess.get(page.id)?.canCreate === false}
            title={
              pageAccess.get(page.id)?.canCreate === false
                ? `当前角色（${role ?? "-"}）未持有 ${pageAccess.get(page.id)?.createPermission ?? ""}`
                : undefined
            }
            data-testid="app-runtime-create"
          >
            新建
          </Button>
        </Space>
      }
    >
      <Table
        size="middle"
        rowKey="id"
        columns={columns as any}
        dataSource={rows}
        pagination={rows.length > 8 ? { pageSize: 8 } : false}
        locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
      />
    </Card>
  );

  return (
    <div
      ref={fitRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: "#E9E5DB" }}
      data-testid="app-runtime-screen"
    >
      <div style={{ width: DESIGN_W * scale, height: DESIGN_H * scale, position: "relative" }}>
        <div
          ref={setCanvasEl}
          style={{
            width: DESIGN_W,
            height: DESIGN_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            background: "#f0f2f5",
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(60,50,30,0.18)",
          }}
        >
          <ConfigProvider getPopupContainer={() => canvasEl ?? document.body}>
            <Layout style={{ height: "100%" }}>
              <Layout.Sider width={208} theme="dark">
                <div style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 16px" }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      flexShrink: 0,
                      background: "linear-gradient(135deg,#1677ff,#69b1ff)",
                    }}
                  />
                  <span
                    style={{ color: "#fff", fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    title={schema.appName}
                  >
                    {schema.appName}
                  </span>
                </div>
                <Menu
                  theme="dark"
                  mode="inline"
                  selectedKeys={[activePageId]}
                  onClick={({ key }) => setActivePageId(String(key))}
                  items={schema.menus.map((m, i) => {
                    const locked = m.pageId !== "home" && pageAccess.get(m.pageId)?.visible === false;
                    const Icon = m.pageId === "home" ? DashboardOutlined : locked ? LockOutlined : MENU_ICONS[(i - 1 + MENU_ICONS.length) % MENU_ICONS.length];
                    return {
                      key: m.pageId,
                      icon: <Icon />,
                      label: m.label,
                      disabled: locked,
                      title: locked ? `当前角色（${role ?? "-"}）无本页权限` : m.label,
                    };
                  })}
                />
              </Layout.Sider>
              <Layout>
                <Layout.Header
                  style={{
                    background: "#fff",
                    padding: "0 20px",
                    height: 56,
                    lineHeight: "56px",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    boxShadow: "0 1px 4px rgba(0,21,41,0.08)",
                    zIndex: 1,
                  }}
                >
                  <Breadcrumb items={[{ title: schema.appName }, { title: currentTitle }]} />
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, color: "#999" }}>当前角色</span>
                  <Select
                    size="small"
                    style={{ minWidth: 140 }}
                    value={role}
                    onChange={changeRole}
                    options={schema.roles.map((r) => ({ value: r, label: r }))}
                    data-testid="app-runtime-role"
                  />
                  <Avatar size={30} style={{ background: "#1677ff" }} icon={<UserOutlined />} />
                </Layout.Header>
                <Layout.Content style={{ padding: 20, overflow: "auto" }}>
                  {isHome ? homeContent : pageContent}
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
              getContainer={() => canvasEl ?? document.body}
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
          </ConfigProvider>
        </div>
      </div>
      <span
        className="absolute bottom-2 right-3 rounded-full bg-black/30 px-2 py-0.5 font-mono text-[9px] text-white/90"
        title="固定 1440×810 设计分辨率，按容器等比缩放显示"
      >
        16:9 · {Math.round(scale * 100)}%
      </span>
    </div>
  );
}
