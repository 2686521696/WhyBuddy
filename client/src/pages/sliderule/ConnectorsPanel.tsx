/**
 * ConnectorsPanel — 「技能 · 连接器 · 伙伴」页里的连接器层。
 *
 * 每个连接器都能**当场试取**：填参数、点一下、真数据直接摆在页面上。
 * 这一块是整条链路对用户最有说服力的地方——不是"我们支持天气"，
 * 是"这就是北京明天的降水概率 78%"。
 *
 * ⚠ 试取失败必须**如实说为什么**，并且一行都不显示。给一张编出来的示例表
 *   当"成功"，比直接报错危险得多：用户会以为数据源接通了。
 *   （后端 services/connectors.py 守着同一条，这里是消费侧那一半。）
 */

import React from "react";
import { Alert, Button, Empty, Input, Table, Tag } from "antd";
import { ApiOutlined, ReloadOutlined } from "@ant-design/icons";

import {
  fetchConnectorRows,
  type ConnectorFetchResult,
  type ConnectorSpec,
} from "./connectors-client";

function ConnectorCard({
  spec,
  onUse,
}: {
  spec: ConnectorSpec;
  onUse: (spec: ConnectorSpec) => void;
}) {
  const [args, setArgs] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(spec.args.map(a => [a.id, a.default]))
  );
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ConnectorFetchResult | null>(null);

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
      className="rounded-lg border border-[#e9edf2] bg-white p-3"
      data-testid="connector-card"
      data-connector={spec.id}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f6ffed] text-[#389e0d]">
          <ApiOutlined />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-stone-800">
              {spec.name}
            </span>
            <Tag color="green" style={{ marginInlineEnd: 0 }}>
              连接器
            </Tag>
            {spec.available ? null : (
              <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                未配置凭据
              </Tag>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-stone-500">
            {spec.description}
          </div>
          <div className="mt-1 text-[11px] text-stone-400">
            落成实体「{spec.entityName}」· {spec.fields.length} 个字段 ·
            来源 {spec.source}
          </div>
        </div>
        <Button size="small" type="primary" ghost onClick={() => onUse(spec)}>
          在推演中用
        </Button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-end gap-2">
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
          icon={<ReloadOutlined />}
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
  );
}

export function ConnectorsPanel({
  connectors,
  loading,
  onUse,
}: {
  connectors: ConnectorSpec[];
  loading: boolean;
  onUse: (spec: ConnectorSpec) => void;
}) {
  if (loading) {
    return (
      <div className="px-1 py-6 text-center text-[12px] text-stone-400">
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
    <div className="space-y-2.5" data-testid="connectors-list">
      <div className="rounded bg-green-50 px-2.5 py-1.5 text-[11px] text-green-800 ring-1 ring-green-200">
        连接器接的是<b>真实</b>外部数据。在推演里挂上之后，生成的应用里对应
        那张表填的就是取回来的真值，并且带来源和取数时间——
        <b>取不到就空着并说明原因，不会用编的数据顶上</b>。
      </div>
      {connectors.map(c => (
        <ConnectorCard key={c.id} spec={c} onUse={onUse} />
      ))}
    </div>
  );
}
