import React from "react";
import { Alert, Button, Card, Flex, InputNumber, Radio, Segmented, Space, Switch, Tag, Typography } from "antd";
import { ApartmentOutlined, CrownOutlined, SaveOutlined } from "@ant-design/icons";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const f = (p: ExperienceBlockRendererProps, key: string) => String(p.block.binding?.[key] ?? "").trim();
const v = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const n = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const yes = (row: Row, ref: string) => /true|yes|enabled|allowed|1/i.test(v(row, ref));
const bound = (p: ExperienceBlockRendererProps) => { const entityRef = f(p, "entityRef"), rows = entityRef ? p.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const targets = (p: ExperienceBlockRendererProps) => Array.isArray(p.block.binding?.targets) ? p.block.binding.targets.map(String) : [];
const shell = (p: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => p.block.props?.surface === "plain" ? <section data-testid={id}>{children}</section> : <Card size="small" title={String(p.block.props?.title ?? title)} data-testid={id}>{children}</Card>;
const missing = (p: ExperienceBlockRendererProps, id: string, title: string) => shell(p, id, title, <Alert type="info" showIcon message="区块尚未绑定所需数据" />);

export const roundRobinHostDistributionValid = (rows: Array<{ group: string; priority: number; weight: number; fixed: boolean }>) =>
  rows.length > 0 && rows.every(row => row.group && row.priority >= 0 && row.priority <= 4 && (row.fixed || row.weight > 0)) &&
  [...new Set(rows.filter(row => !row.fixed).map(row => row.group))].every(group => rows.filter(row => !row.fixed && row.group === group).reduce((sum, row) => sum + row.weight, 0) === 100);

export const assetStackPrimaryValid = (rows: Array<{ id: string; order: number; primary: boolean }>) =>
  rows.length >= 2 && rows.filter(row => row.primary).length === 1 && new Set(rows.map(row => row.order)).size === rows.length && rows.every(row => row.order >= 0);

export const RoundRobinHostDistributionComposerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), name = f(p, "hostNameFieldRef"), group = f(p, "hostGroupFieldRef"), priority = f(p, "priorityFieldRef"), weight = f(p, "weightFieldRef"), fixed = f(p, "fixedHostFieldRef");
  const [mode, setMode] = React.useState("weighted"), [weights, setWeights] = React.useState<Record<string, number>>({});
  if (!b || !name || !group || !priority || !weight || !fixed) return missing(p, "round-robin-host-distribution-composer", "轮询主持人分布编排器");
  const rows = b.rows.map(row => ({ group: v(row, group), priority: n(row, priority), weight: weights[row.id] ?? n(row, weight), fixed: yes(row, fixed) })), valid = roundRobinHostDistributionValid(rows);
  const groups = [...new Set(b.rows.map(row => v(row, group)))];
  return shell(p, "round-robin-host-distribution-composer", "轮询主持人分布编排器", <Flex vertical gap={12}><Segmented value={mode} onChange={x => setMode(String(x))} options={[{ label: "权重轮询", value: "weighted" }, { label: "优先级", value: "priority" }]} />{groups.map(groupName => <Card key={groupName} size="small" title={<Space><ApartmentOutlined />{groupName}</Space>} extra={<Tag>{rows.filter(row => row.group === groupName && !row.fixed).reduce((sum, row) => sum + row.weight, 0)}%</Tag>}><Flex vertical gap={8}>{b.rows.filter(row => v(row, group) === groupName).map(row => <Flex key={row.id} align="center" gap={10}><Switch checked={!yes(row, fixed)} checkedChildren="轮询" unCheckedChildren="固定" /><Typography.Text strong style={{ flex: 1 }}>{v(row, name)}</Typography.Text>{mode === "weighted" ? <InputNumber min={1} max={100} value={weights[row.id] ?? n(row, weight)} disabled={yes(row, fixed)} suffix="%" onChange={x => setWeights(s => ({ ...s, [row.id]: Number(x ?? 0) }))} /> : <Tag color="blue">P{n(row, priority)}</Tag>}</Flex>)}</Flex></Card>)}<Alert type={valid ? "success" : "error"} showIcon message={valid ? "每个主持人组的轮询权重闭合为 100%" : "组权重未闭合、优先级越界或主持人缺少分组"} /><Button type="primary" icon={<SaveOutlined />} disabled={!valid} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, mode, weights, operation: "saveRoundRobinHosts", targets: targets(p) })}>保存主持人路由</Button></Flex>);
};

export const AssetStackPrimaryOrganizerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), name = f(p, "assetNameFieldRef"), url = f(p, "previewUrlFieldRef"), order = f(p, "orderIndexFieldRef"), primary = f(p, "primaryAssetFieldRef"), removable = f(p, "removableFieldRef"), stack = f(p, "stackNameFieldRef");
  const [primaryId, setPrimaryId] = React.useState(b?.rows.find(row => yes(row, primary))?.id ?? b?.rows[0]?.id ?? ""), [removed, setRemoved] = React.useState<string[]>([]);
  if (!b || !name || !url || !order || !primary || !removable || !stack) return missing(p, "asset-stack-primary-organizer", "资产堆叠主图整理器");
  const visible = b.rows.filter(row => !removed.includes(row.id)), valid = assetStackPrimaryValid(visible.map(row => ({ id: row.id, order: n(row, order), primary: row.id === primaryId })));
  return shell(p, "asset-stack-primary-organizer", "资产堆叠主图整理器", <Flex vertical gap={12}><Flex justify="space-between"><Typography.Text strong>{v(b.rows[0], stack)}</Typography.Text><Tag>{visible.length} 项堆叠</Tag></Flex><Radio.Group value={primaryId} onChange={e => setPrimaryId(e.target.value)}><div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(visible.length, 4)},minmax(0,1fr))`, gap: 10 }}>{visible.sort((a, z) => n(a, order) - n(z, order)).map(row => <Card key={row.id} size="small" cover={<img src={v(row, url)} alt={v(row, name)} style={{ width: "100%", height: 112, objectFit: "cover" }} />}><Flex vertical gap={8}><Radio value={row.id}><Space><span>{v(row, name)}</span>{row.id === primaryId && <CrownOutlined style={{ color: "#faad14" }} />}</Space></Radio><Flex justify="space-between"><Tag>顺序 {n(row, order) + 1}</Tag><Button type="link" danger size="small" disabled={!yes(row, removable) || row.id === primaryId} onClick={() => setRemoved(ids => [...ids, row.id])}>移出堆叠</Button></Flex></Flex></Card>)}</div></Radio.Group><Alert type={valid ? "success" : "warning"} showIcon message={valid ? "主图唯一，顺序稳定；移出操作不会删除原资产" : "堆叠至少保留两项、一个主图和唯一顺序"} /><Button type="primary" icon={<SaveOutlined />} disabled={!valid} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, primaryAssetId: primaryId, removedAssetIds: removed, operation: "updateAssetStack", targets: targets(p) })}>保存堆叠顺序与主图</Button></Flex>);
};
