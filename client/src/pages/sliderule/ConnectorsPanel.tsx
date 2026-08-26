/**
 * ConnectorsPanel — 「技能 · 连接器 · 伙伴」页里的连接器层。
 *
 * 2026-08-26 按用户给的效果图重做：顶部标题 + 搜索 + 分类筛选，下面四列卡片墙，
 * 每张卡右上是「+ / ✓ 已添加」。
 *
 * ## 跟效果图**故意不一样**的两处
 *
 * 1. **卡片只列真的能用的。** 效果图里是 24 个（钉钉、飞书、Notion、
 *    腾讯会议、高德地图…），我们只有 2 个。把另外 22 个摆上去，点了不通，
 *    就是这整条链路存在的理由要杀掉的东西——比"没有这个连接器"更糟，因为
 *    用户会以为接得上。数字（"N 个"）也照实数，不写死 24。
 *
 * 2. **没有「+ 新建」。** 自定义连接器还没做（连接器由服务端注册表提供，
 *    见 services/connectors.py）。放一颗打不开任何东西的按钮，跟第 1 条
 *    同一个毛病。做出来那天再加。
 *
 * 「我的连接器」保留了，因为它有真实语义：只看**这一轮挂着**的那些。
 *
 * ## 「+ / 已添加」是什么
 *
 * 是"挂不挂在这一轮推演上"（turn-capabilities），跟输入框里 `/` 选中同一条
 * 路径、同一个存档键。**不是**"安装"——连接器没有安装这一步，装出一个假的
 * 安装态只会让人以为还得先装。
 *
 * ⚠ 试取真数据藏在卡片展开里，但**没有降级**：它仍然是这一页最有说服力的
 *   东西（不是"我们支持天气"，是"这就是北京明天的降水概率 78%"）。失败时
 *   如实说原因并且**一行都不显示**——给一张编出来的示例表当"成功"，比直接
 *   报错危险得多。
 */

import React from "react";
import { Alert, Button, Empty, Input, Table, Tag } from "antd";
import {
  BarChart3,
  Check,
  CloudSun,
  Plug,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  fetchConnectorRows,
  type ConnectorFetchResult,
  type ConnectorSpec,
} from "./connectors-client";

/** 图标名 → 图案。⚠ 认不出一律回落成插头，不抛也不留空。 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  weather: CloudSun,
  chart: BarChart3,
  plug: Plug,
};

/** 图标底色，跟着图标名走（同一个连接器每次进来颜色一样）。 */
const ICON_TONE: Record<string, string> = {
  weather: "bg-[#e8f2ff] text-[#2b7fff]",
  chart: "bg-[#e9f9f0] text-[#0f9d58]",
  plug: "bg-[#f1f5f9] text-[#64748b]",
};

const FEATURED = "精选";

function ConnectorCard({
  spec,
  attached,
  onToggle,
}: {
  spec: ConnectorSpec;
  attached: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [args, setArgs] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(spec.args.map(a => [a.id, a.default]))
  );
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ConnectorFetchResult | null>(null);

  const Icon = ICONS[spec.icon] ?? ICONS.plug!;
  const tone = ICON_TONE[spec.icon] ?? ICON_TONE.plug!;

  const preview = async () => {
    setBusy(true);
    try {
      setResult(await fetchConnectorRows(spec.id, args));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-xl border bg-white transition ${
        open ? "border-[#d6e4ff] shadow-[0_6px_18px_rgba(15,23,42,0.06)]" : "border-[#eceff3] hover:border-[#dbe2ea]"
      }`}
      data-testid="connector-card"
      data-connector={spec.id}
      data-attached={attached ? "1" : "0"}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <button
          type="button"
          data-testid="connector-expand"
          onClick={() => setOpen(v => !v)}
          className="min-w-0 flex-1 text-left"
          title="展开：填参数、试取真数据"
        >
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold text-stone-800">
              {spec.name}
            </span>
            <Tag
              color="green"
              style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "16px" }}
            >
              连接器
            </Tag>
            {spec.available ? null : (
              <Tag color="warning" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                未配置凭据
              </Tag>
            )}
          </span>
          <span className="mt-1 block text-[12.5px] leading-5 text-stone-500">
            {spec.description}
          </span>
          <span className="mt-1 block text-[11px] text-stone-400">
            落成实体「{spec.entityName}」· {spec.fields.length} 个字段 · 来源{" "}
            {spec.source}
          </span>
        </button>
        {/* 「+ / ✓ 已添加」= 挂不挂在这一轮，跟输入框 `/` 同一条路径 */}
        <button
          type="button"
          data-testid="connector-attach"
          aria-pressed={attached}
          onClick={onToggle}
          title={attached ? "已挂在这一轮，点一下摘掉" : "挂到这一轮推演上"}
          className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] transition ${
            attached
              ? "bg-[#f0f9f2] text-[#0f9d58]"
              : "border border-[#e5e7eb] text-stone-400 hover:border-[#c7d2e0] hover:text-stone-700"
          }`}
        >
          {attached ? (
            <>
              <Check className="h-3.5 w-3.5" />
              已添加
            </>
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </button>
      </div>

      {open ? (
        <div className="border-t border-[#f1f3f6] px-3.5 py-3">
          <div className="flex flex-wrap items-end gap-2">
            {spec.args.map(a => (
              <label key={a.id} className="text-[11px] text-stone-500">
                <span className="mb-0.5 block">{a.name}</span>
                <Input
                  size="small"
                  style={{ width: 220 }}
                  value={args[a.id] ?? ""}
                  placeholder={a.placeholder}
                  data-testid="connector-arg"
                  onChange={e =>
                    setArgs(prev => ({ ...prev, [a.id]: e.target.value }))
                  }
                />
              </label>
            ))}
            <Button
              size="small"
              icon={<RefreshCw className="h-3 w-3" />}
              loading={busy}
              disabled={!spec.available}
              data-testid="connector-preview"
              onClick={preview}
            >
              试取真数据
            </Button>
          </div>

          {result && !result.ok ? (
            /* ⚠ 失败时**一行都不显示**。给一张示例表当"成功"比直接报错危险得多。 */
            <Alert
              className="mt-2.5"
              type="warning"
              showIcon
              data-testid="connector-error"
              message={result.error}
            />
          ) : null}

          {result?.ok ? (
            <div className="mt-2.5" data-testid="connector-preview-result">
              <div className="mb-1 text-[11px] text-stone-400">
                {result.rows.length} 行 · {result.source} ·{" "}
                {result.fetchedAt.replace("T", " ").slice(0, 16)} 取
              </div>
              {result.rows.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="这次没有取到行"
                />
              ) : (
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: true, y: 220 }}
                  dataSource={result.rows}
                  columns={spec.fields.map(f => ({
                    title: f.name,
                    dataIndex: ["values", f.id],
                    key: f.id,
                    render: (v: unknown) =>
                      v === null || v === undefined || v === "" ? (
                        /* ⚠ 不适用的字段显示「—」，不是 0。指数没有市净率，
                           写 0.00 每个像素都像真的，只有那一格是编的。 */
                        <span className="text-stone-300">—</span>
                      ) : (
                        String(v)
                      ),
                  }))}
                />
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ConnectorsPanel({
  connectors,
  loading,
  attachedIds,
  onUse,
  onDetach,
}: {
  connectors: ConnectorSpec[];
  loading: boolean;
  /** 这一轮已经挂着的连接器 id */
  attachedIds: string[];
  onUse: (spec: ConnectorSpec) => void;
  onDetach: (spec: ConnectorSpec) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(FEATURED);
  const [mineOnly, setMineOnly] = React.useState(false);

  /* 分类条：从连接器自己声明的 category 汇出来。
     ⚠ 只有一种分类时不画这条——一个永远只能选它自己的筛选条，占着一行
       却什么也筛不动。 */
  const categories = React.useMemo(() => {
    const seen: string[] = [];
    for (const c of connectors) {
      if (c.category && !seen.includes(c.category)) seen.push(c.category);
    }
    return seen.length > 1 ? [FEATURED, ...seen] : [];
  }, [connectors]);

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return connectors.filter(c => {
      if (mineOnly && !attachedIds.includes(c.id)) return false;
      if (category !== FEATURED && c.category !== category) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.entityName.toLowerCase().includes(q) ||
        c.source.toLowerCase().includes(q)
      );
    });
  }, [connectors, query, category, mineOnly, attachedIds]);

  if (loading) {
    return (
      <div className="px-1 py-8 text-center text-[12px] text-stone-400">
        连接器清单加载中…
      </div>
    );
  }
  if (connectors.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="没有取到连接器清单——Python 服务没起来，或者这台机器上还没配连接器"
      />
    );
  }

  return (
    <div data-testid="connectors-list">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="m-0 text-[20px] font-semibold text-stone-800">
              连接器
            </h2>
            {/* ⚠ 照实数，不写死。效果图上的 24 我们没有。 */}
            <span
              className="text-[13px] text-stone-400"
              data-testid="connector-count"
            >
              {connectors.length} 个
            </span>
          </div>
          <p className="mb-0 mt-1 text-[12.5px] text-stone-500">
            连接外部服务，让生成的应用获得<b>真实</b>数据——取不到就空着并说明
            原因，不会用编的数据顶上
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            allowClear
            size="middle"
            style={{ width: 220 }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索连接器"
            data-testid="connector-search"
            prefix={<Search className="h-3.5 w-3.5 text-stone-400" />}
          />
          <Button
            type={mineOnly ? "primary" : "default"}
            ghost={mineOnly}
            data-testid="connector-mine"
            onClick={() => setMineOnly(v => !v)}
          >
            我的连接器
            {attachedIds.length > 0 ? ` ${attachedIds.length}` : ""}
          </Button>
        </div>
      </div>

      {categories.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap gap-2" data-testid="connector-cats">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              data-testid="connector-cat"
              data-cat={cat}
              data-active={category === cat ? "1" : "0"}
              onClick={() => setCategory(cat)}
              className={`rounded-lg px-3 py-1.5 text-[13px] transition ${
                category === cat
                  ? "bg-[#eef4ff] font-medium text-[#1677ff]"
                  : "bg-[#f5f6f8] text-stone-600 hover:bg-[#eceff3]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <Empty
          className="mt-8"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            mineOnly
              ? "这一轮还没挂任何连接器"
              : `没有匹配「${query || category}」的连接器`
          }
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map(c => {
            const attached = attachedIds.includes(c.id);
            return (
              <ConnectorCard
                key={c.id}
                spec={c}
                attached={attached}
                onToggle={() => (attached ? onDetach(c) : onUse(c))}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
