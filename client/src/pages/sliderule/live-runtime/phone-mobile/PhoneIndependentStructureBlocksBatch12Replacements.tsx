import React from "react";
import { Button, Card, ErrorBlock, Image, List, Selector, Space, Stepper, Switch, Tag } from "antd-mobile";
import { CheckOutline } from "antd-mobile-icons";
import type { ExperienceBlockRendererProps } from "../block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const f = (p: ExperienceBlockRendererProps, key: string) => String(p.block.binding?.[key] ?? "").trim();
const v = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const n = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const yes = (row: Row, ref: string) => /true|yes|enabled|allowed|1/i.test(v(row, ref));
const bound = (p: ExperienceBlockRendererProps) => { const entityRef = f(p, "entityRef"), rows = entityRef ? p.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const targets = (p: ExperienceBlockRendererProps) => Array.isArray(p.block.binding?.targets) ? p.block.binding.targets.map(String) : [];
const shell = (p: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => <Card data-testid={`phone-${id}`} title={String(p.block.props?.title ?? title)}>{children}</Card>;
const empty = (p: ExperienceBlockRendererProps, id: string, title: string) => shell(p, id, title, <ErrorBlock status="empty" title="尚未绑定所需数据" />);
const notice = (ok: boolean, text: string) => <div style={{ padding: 10, background: ok ? "#e7f8f2" : "#fff1f0", color: ok ? "#067647" : "#cf1322" }}>{text}</div>;

export function PhoneRoundRobinHostDistributionComposer(p: ExperienceBlockRendererProps) {
  const b = bound(p), name = f(p, "hostNameFieldRef"), group = f(p, "hostGroupFieldRef"), priority = f(p, "priorityFieldRef"), weight = f(p, "weightFieldRef"), fixed = f(p, "fixedHostFieldRef"), [mode, setMode] = React.useState("weighted");
  if (!b || !name || !group || !priority || !weight || !fixed) return empty(p, "round-robin-host-distribution-composer", "轮询主持人分布编排器");
  const groups = [...new Set(b.rows.map(row => v(row, group)))], ok = groups.every(g => b.rows.filter(row => v(row, group) === g && !yes(row, fixed)).reduce((sum, row) => sum + n(row, weight), 0) === 100);
  return shell(p, "round-robin-host-distribution-composer", "轮询主持人分布编排器", <Space block direction="vertical"><Selector columns={2} value={[mode]} onChange={x => setMode(String(x[0]))} options={[{ label: "权重轮询", value: "weighted" }, { label: "优先级", value: "priority" }]} />{groups.map(g => <Card key={g} title={g} extra={<Tag>{b.rows.filter(row => v(row, group) === g && !yes(row, fixed)).reduce((sum, row) => sum + n(row, weight), 0)}%</Tag>}><List>{b.rows.filter(row => v(row, group) === g).map(row => <List.Item key={row.id} prefix={<Switch defaultChecked={!yes(row, fixed)} />} description={yes(row, fixed) ? "固定参与" : `优先级 P${n(row, priority)}`} extra={mode === "weighted" ? <Stepper min={1} max={100} defaultValue={n(row, weight)} /> : <Tag color="primary">P{n(row, priority)}</Tag>}>{v(row, name)}</List.Item>)}</List></Card>)}{notice(ok, ok ? "各组权重闭合为 100%" : "主持人组权重未闭合")}<Button block color="primary" disabled={!ok} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, mode, operation: "saveRoundRobinHosts", targets: targets(p) })}>保存主持人路由</Button></Space>);
}

export function PhoneAssetStackPrimaryOrganizer(p: ExperienceBlockRendererProps) {
  const b = bound(p), name = f(p, "assetNameFieldRef"), url = f(p, "previewUrlFieldRef"), order = f(p, "orderIndexFieldRef"), primary = f(p, "primaryAssetFieldRef"), removable = f(p, "removableFieldRef"), stack = f(p, "stackNameFieldRef"), [primaryId, setPrimaryId] = React.useState(b?.rows.find(row => yes(row, primary))?.id ?? b?.rows[0]?.id ?? "");
  if (!b || !name || !url || !order || !primary || !removable || !stack) return empty(p, "asset-stack-primary-organizer", "资产堆叠主图整理器");
  const ok = b.rows.length >= 2 && new Set(b.rows.map(row => n(row, order))).size === b.rows.length;
  return shell(p, "asset-stack-primary-organizer", "资产堆叠主图整理器", <Space block direction="vertical"><div style={{ display: "flex", justifyContent: "space-between" }}><strong>{v(b.rows[0], stack)}</strong><Tag>{b.rows.length} 项</Tag></div><div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "76%", overflowX: "auto", gap: 8 }}>{b.rows.sort((a, z) => n(a, order) - n(z, order)).map(row => <Card key={row.id} onClick={() => setPrimaryId(row.id)} style={{ outline: primaryId === row.id ? "2px solid #1677ff" : undefined }}><Image src={v(row, url)} height={120} fit="cover" /><div style={{ marginTop: 8, fontWeight: 600 }}>{v(row, name)}</div><Space><Tag>顺序 {n(row, order) + 1}</Tag>{primaryId === row.id && <Tag color="warning">主图</Tag>}{!yes(row, removable) && <Tag>锁定</Tag>}</Space></Card>)}</div>{notice(ok, ok ? "主图唯一，顺序稳定" : "堆叠至少两项且顺序不能重复")}<Button block color="primary" disabled={!ok} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, primaryAssetId: primaryId, operation: "updateAssetStack", targets: targets(p) })}><CheckOutline /> 保存堆叠</Button></Space>);
}
