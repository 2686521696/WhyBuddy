import React from "react";
import { Alert, Badge, Button, Card, Collapse, Flex, Slider, Space, Switch, Tag, Timeline, Typography } from "antd";
import { BellOutlined, CheckCircleOutlined, TeamOutlined } from "@ant-design/icons";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const f = (p: ExperienceBlockRendererProps, key: string) => String(p.block.binding?.[key] ?? "").trim();
const v = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const n = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const yes = (row: Row, ref: string) => /true|yes|enabled|allowed|1/i.test(v(row, ref));
const targets = (p: ExperienceBlockRendererProps) => Array.isArray(p.block.binding?.targets) ? p.block.binding.targets.map(String) : [];
const bound = (p: ExperienceBlockRendererProps) => { const entityRef = f(p, "entityRef"), rows = entityRef ? p.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const shell = (p: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => p.block.props?.surface === "plain" ? <section data-testid={id}>{children}</section> : <Card size="small" title={String(p.block.props?.title ?? title)} data-testid={id}>{children}</Card>;
const missing = (p: ExperienceBlockRendererProps, id: string, title: string) => shell(p, id, title, <Alert type="info" showIcon message="区块尚未绑定所需数据" />);

export const capacityPolicyValid = (rows: Array<{ capacity: number; inboxLimit: number; excluded: boolean }>, fairShare: number) =>
  fairShare > 0 && fairShare <= 100 && rows.every(row => row.excluded || (row.capacity > 0 && row.inboxLimit > 0 && row.inboxLimit <= row.capacity));

export const notificationRouteValid = (rows: Array<{ id: string; parent: string; receiver: string; matcher: string; provisioned: boolean }>) => {
  const ids = new Set(rows.map(row => row.id));
  return rows.length > 0 && rows.every(row => row.receiver && (!row.parent || ids.has(row.parent)) && (row.provisioned || row.matcher.trim().length > 0));
};

export const ConversationCapacityPolicyComposerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), agent = f(p, "agentNameFieldRef"), capacity = f(p, "capacityFieldRef"), inbox = f(p, "inboxLimitFieldRef"), load = f(p, "activeLoadFieldRef"), excluded = f(p, "excludedFieldRef");
  const [fairShare, setFairShare] = React.useState(60), [enabled, setEnabled] = React.useState<Record<string, boolean>>({});
  if (!b || !agent || !capacity || !inbox || !load || !excluded) return missing(p, "conversation-capacity-policy-composer", "会话分配容量策略编排器");
  const rows = b.rows.map(row => ({ capacity: n(row, capacity), inboxLimit: n(row, inbox), excluded: enabled[row.id] === false || yes(row, excluded) })), valid = capacityPolicyValid(rows, fairShare);
  return shell(p, "conversation-capacity-policy-composer", "会话分配容量策略编排器", <Flex vertical gap={12}><Card size="small" title="公平分配窗口"><Flex align="center" gap={16}><Slider min={10} max={100} value={fairShare} onChange={setFairShare} style={{ flex: 1 }} /><Tag>{fairShare}%</Tag></Flex></Card><Flex vertical gap={8}>{b.rows.map(row => { const used = n(row, load), max = n(row, capacity); return <Card key={row.id} size="small"><Flex justify="space-between" align="center"><Space><Badge status={used >= max ? "error" : "processing"} /><Typography.Text strong>{v(row, agent)}</Typography.Text></Space><Switch checked={enabled[row.id] ?? !yes(row, excluded)} onChange={x => setEnabled(s => ({ ...s, [row.id]: x }))} /></Flex><Flex justify="space-between" style={{ marginTop: 8 }}><Typography.Text type="secondary">当前 {used}/{max}</Typography.Text><Tag>收件箱上限 {n(row, inbox)}</Tag></Flex></Card>; })}</Flex><Alert type={valid ? "success" : "error"} showIcon message={valid ? "容量与收件箱限制可执行，超载代理将跳过" : "收件箱上限不能超过代理总容量"} /><Button type="primary" icon={<TeamOutlined />} disabled={!valid} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, fairShare, operation: "saveAssignmentCapacityPolicy", targets: targets(p) })}>应用分配策略</Button></Flex>);
};

export const NotificationPolicyRouteTreeRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), name = f(p, "policyNameFieldRef"), parent = f(p, "parentPolicyFieldRef"), matcher = f(p, "matcherFieldRef"), receiver = f(p, "receiverFieldRef"), continuation = f(p, "continueFieldRef"), provisioned = f(p, "provisionedFieldRef"), [focus, setFocus] = React.useState(b?.rows[0]?.id ?? "");
  if (!b || !name || !parent || !matcher || !receiver || !continuation || !provisioned) return missing(p, "notification-policy-route-tree", "通知策略路由树");
  const valid = notificationRouteValid(b.rows.map(row => ({ id: row.id, parent: v(row, parent), receiver: v(row, receiver), matcher: v(row, matcher), provisioned: yes(row, provisioned) }))), roots = b.rows.filter(row => !v(row, parent));
  const node = (row: Row): React.ReactNode => <div key={row.id} style={{ marginLeft: v(row, parent) ? 28 : 0, borderLeft: v(row, parent) ? "1px solid var(--ant-color-border)" : undefined, paddingLeft: v(row, parent) ? 14 : 0 }}><Card size="small" hoverable onClick={() => setFocus(row.id)} style={{ marginBottom: 8, borderColor: focus === row.id ? "var(--ant-color-primary)" : undefined }}><Flex justify="space-between"><Space><BellOutlined /><Typography.Text strong>{v(row, name)}</Typography.Text>{yes(row, provisioned) && <Tag>已配置</Tag>}</Space><Tag color="blue">{v(row, receiver)}</Tag></Flex><Flex gap={8} wrap style={{ marginTop: 8 }}><Tag>{v(row, matcher) || "匹配全部"}</Tag>{yes(row, continuation) && <Tag color="gold">继续匹配</Tag>}</Flex></Card>{b.rows.filter(child => v(child, parent) === row.id).map(child => node(child))}</div>;
  return shell(p, "notification-policy-route-tree", "通知策略路由树", <Flex vertical gap={12}><div>{roots.map(root => node(root))}</div><Collapse items={[{ key: "trace", label: "当前路由匹配轨迹", children: <Timeline items={b.rows.filter(row => row.id === focus || v(row, parent) === focus).map(row => ({ color: row.id === focus ? "blue" : "gray", children: `${v(row, matcher) || "all"} -> ${v(row, receiver)}` }))} /> }]} /><Alert type={valid ? "success" : "error"} showIcon message={valid ? "父子路由、接收点与继承关系有效" : "存在孤立父路由、空接收点或未配置匹配器"} /><Button type="primary" icon={<CheckCircleOutlined />} disabled={!valid} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, operation: "saveNotificationPolicyTree", targets: targets(p) })}>发布路由树</Button></Flex>);
};

export const INDEPENDENT_STRUCTURE_BATCH12_LABELS: Record<string, string> = {
  ConversationCapacityPolicyComposer: "会话分配容量策略编排器",
  NotificationPolicyRouteTree: "通知策略路由树",
};
