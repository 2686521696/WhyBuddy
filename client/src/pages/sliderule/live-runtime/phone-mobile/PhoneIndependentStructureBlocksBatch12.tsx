import React from "react";
import { Button, Card, ErrorBlock, List, ProgressBar, Slider, Space, Switch, Tag } from "antd-mobile";
import { CheckOutline, TeamOutline } from "antd-mobile-icons";
import type { ExperienceBlockRendererProps } from "../block-registry";
import {
  PhoneAssetStackPrimaryOrganizer,
  PhoneRoundRobinHostDistributionComposer,
} from "./PhoneIndependentStructureBlocksBatch12Replacements";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const f = (p: ExperienceBlockRendererProps, key: string) => String(p.block.binding?.[key] ?? "").trim();
const v = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const n = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const yes = (row: Row, ref: string) => /true|yes|enabled|allowed|1/i.test(v(row, ref));
const targets = (p: ExperienceBlockRendererProps) => Array.isArray(p.block.binding?.targets) ? p.block.binding.targets.map(String) : [];
const bound = (p: ExperienceBlockRendererProps) => { const entityRef = f(p, "entityRef"), rows = entityRef ? p.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const shell = (p: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => <Card data-testid={`phone-${id}`} title={String(p.block.props?.title ?? title)}><div style={{ paddingBottom: p.block.props?.surface === "plain" ? 144 : 0 }}>{children}</div></Card>;
const empty = (p: ExperienceBlockRendererProps, id: string, title: string) => shell(p, id, title, <ErrorBlock status="empty" title="尚未绑定所需数据" />);
const notice = (ok: boolean, text: string) => <div style={{ padding: 10, background: ok ? "#e7f8f2" : "#fff1f0", color: ok ? "#067647" : "#cf1322" }}>{text}</div>;

function Capacity(p: ExperienceBlockRendererProps) {
  const b = bound(p), agent = f(p, "agentNameFieldRef"), capacity = f(p, "capacityFieldRef"), inbox = f(p, "inboxLimitFieldRef"), load = f(p, "activeLoadFieldRef"), excluded = f(p, "excludedFieldRef"), [fairShare, setFairShare] = React.useState(60);
  if (!b || !agent || !capacity || !inbox || !load || !excluded) return empty(p, "conversation-capacity-policy-composer", "会话分配容量策略编排器");
  const ok = b.rows.every(row => yes(row, excluded) || (n(row, inbox) > 0 && n(row, inbox) <= n(row, capacity)));
  return shell(p, "conversation-capacity-policy-composer", "会话分配容量策略编排器", <Space block direction="vertical"><div>公平分配窗口 {fairShare}%</div><Slider min={10} max={100} value={fairShare} onChange={value => setFairShare(Array.isArray(value) ? value[0] : value)} /><List>{b.rows.map(row => <List.Item key={row.id} prefix={<Switch defaultChecked={!yes(row, excluded)} />} description={`收件箱上限 ${n(row, inbox)}`} extra={<span>{n(row, load)}/{n(row, capacity)}</span>}>{v(row, agent)}<ProgressBar percent={Math.min(100, n(row, load) / Math.max(1, n(row, capacity)) * 100)} /></List.Item>)}</List>{notice(ok, ok ? "容量边界可执行" : "收件箱上限超过总容量")}<Button block color="primary" disabled={!ok} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, fairShare, operation: "saveAssignmentCapacityPolicy", targets: targets(p) })}><TeamOutline /> 应用分配策略</Button></Space>);
}

function NotificationTree(p: ExperienceBlockRendererProps) {
  const b = bound(p), name = f(p, "policyNameFieldRef"), parent = f(p, "parentPolicyFieldRef"), matcher = f(p, "matcherFieldRef"), receiver = f(p, "receiverFieldRef"), continuation = f(p, "continueFieldRef"), provisioned = f(p, "provisionedFieldRef");
  if (!b || !name || !parent || !matcher || !receiver || !continuation || !provisioned) return empty(p, "notification-policy-route-tree", "通知策略路由树");
  const ids = new Set(b.rows.map(row => row.id)), ok = b.rows.every(row => v(row, receiver) && (!v(row, parent) || ids.has(v(row, parent))));
  return shell(p, "notification-policy-route-tree", "通知策略路由树", <Space block direction="vertical"><div>{b.rows.map(row => <div key={row.id} style={{ marginLeft: v(row, parent) ? 24 : 0, borderLeft: v(row, parent) ? "1px solid #ddd" : undefined, padding: "0 0 8px 10px" }}><Card title={v(row, name)} extra={<Tag color="primary">{v(row, receiver)}</Tag>}><Space wrap><Tag>{v(row, matcher) || "匹配全部"}</Tag>{yes(row, continuation) && <Tag color="warning">继续匹配</Tag>}{yes(row, provisioned) && <Tag>已配置</Tag>}</Space></Card></div>)}</div>{notice(ok, ok ? "父子路由与接收点有效" : "存在孤立路由或空接收点")}<Button block color="primary" disabled={!ok} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, operation: "saveNotificationPolicyTree", targets: targets(p) })}><CheckOutline /> 发布路由树</Button></Space>);
}

export function renderIndependentStructureBatch12PhoneBlock(p: ExperienceBlockRendererProps): React.ReactNode | undefined {
  switch (p.block.type) {
    case "RoundRobinHostDistributionComposer": return <PhoneRoundRobinHostDistributionComposer {...p} />;
    case "AssetStackPrimaryOrganizer": return <PhoneAssetStackPrimaryOrganizer {...p} />;
    case "ConversationCapacityPolicyComposer": return <Capacity {...p} />;
    case "NotificationPolicyRouteTree": return <NotificationTree {...p} />;
    default: return undefined;
  }
}
