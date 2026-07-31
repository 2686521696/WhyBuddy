/**
 * 体验区块的视觉对照台（dev-only，/block-gallery.html）。
 *
 * 为什么需要：区块只有被 AI 生成到某个页面上才会渲染，而任何一个真实应用都
 * 只会用到其中几个。改完渲染器想看效果，得先碰运气找到一个"恰好用了这个
 * 区块"的应用——RankedList / DataTable 就属于当前样例应用里一次都不出现的，
 * 于是改了也没法看，只能靠测试里的静态 HTML 断言，颜色/间距/密度全是盲区。
 *
 * 这里把九个渲染器连同**空态**一次性铺开，用固定 fixture 数据，
 * 截图即可逐个比对。跟 wall-fixture.html 是同一套用途（视觉 QA），
 * 也同样不进生产产物（vite 只把 index.html 作为构建入口）。
 *
 * 加了 ConfigProvider 并把 colorPrimary 设成一个非默认色：区块吃不吃主题
 * 是这轮重构的核心目的之一，用默认蓝色会看不出差别。
 */

import React from "react";
import { ConfigProvider, Segmented, Space, Typography } from "antd";

import {
  EXPERIENCE_BLOCK_RENDERERS,
  type ExperienceBlockInstance,
} from "@/pages/sliderule/live-runtime/block-registry";
import type { RuntimeRow } from "@/pages/sliderule/live-runtime/live-runtime";
import type { NormalizedFieldOption } from "@/pages/sliderule/live-runtime/field-display";

const row = (id: string, values: Record<string, unknown>): RuntimeRow =>
  ({ id, values, createdAt: "2026-07-20T00:00:00Z" }) as RuntimeRow;

/** 跟真实应用一个量级：12 行、有枚举、有日期、有金额。 */
const LOTS: RuntimeRow[] = [
  row("l1", { lot_code: "RR-2026-2879", supplier: "长沙金穗生物有限公司", origin: "青岛", weight: 820, status: "available", at: "2026-07-27" }),
  row("l2", { lot_code: "JC-2026-9005", supplier: "青岛恒昌农业集团有限公司", origin: "哈尔滨", weight: 1340, status: "reserved", at: "2026-07-26" }),
  row("l3", { lot_code: "GA-2026-3089", supplier: "合肥华瑞建材有限责任公司", origin: "深圳", weight: 460, status: "low", at: "2026-07-25" }),
  row("l4", { lot_code: "CZ-2026-0516", supplier: "济南恒昌物流集团有限公司", origin: "南宁", weight: 1980, status: "frozen", at: "2026-07-25" }),
  row("l5", { lot_code: "DD-2026-7627", supplier: "哈尔滨百川机械有限公司", origin: "厦门", weight: 730, status: "available", at: "2026-07-23" }),
  row("l6", { lot_code: "NE-2026-7628", supplier: "合肥恒昌农业集团有限公司", origin: "石家庄", weight: 1120, status: "reserved", at: "2026-07-22" }),
  row("l7", { lot_code: "DH-2026-0630", supplier: "大连云栖食品有限公司", origin: "大连", weight: 640, status: "available", at: "2026-07-21" }),
  row("l8", { lot_code: "TA-2026-3310", supplier: "南宁禾丰供应链有限公司", origin: "南宁", weight: 1550, status: "low", at: "2026-07-20" }),
];

const ROWS = { green_coffee_lot: LOTS, empty_entity: [] as RuntimeRow[] };

const ENUM_OPTIONS: NormalizedFieldOption[] = [
  { id: "available", label: "可用", tone: "success" },
  { id: "reserved", label: "已预留", tone: "processing" },
  { id: "low", label: "库存偏低", tone: "warning" },
  { id: "frozen", label: "已冻结", tone: "danger" },
];

const FIELD_LABELS: Record<string, string> = {
  lot_code: "批次编码",
  supplier: "供应商",
  origin: "产地",
  weight: "可用重量",
  status: "库存状态",
  at: "入库日期",
};

/** 一格：标题 + 区块，固定宽度好横向比对。 */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ width: 420 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {label}
      </Typography.Text>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function Block({
  rendererKey,
  block,
  rows = ROWS,
}: {
  rendererKey: string;
  block: ExperienceBlockInstance;
  rows?: Record<string, RuntimeRow[]>;
}) {
  const R = EXPERIENCE_BLOCK_RENDERERS[rendererKey];
  if (!R) return <div>没有登记的渲染器：{rendererKey}</div>;
  return (
    <R
      block={block}
      entityRows={rows}
      enumOptionsOf={(_e, f) => (f === "status" ? ENUM_OPTIONS : [])}
      fieldLabelOf={(_e, f) => FIELD_LABELS[f]}
      chartPalette={{ primary: "#b8860b", categorical: ["#b8860b", "#6b8e23", "#4682b4"] }}
      onAction={() => {}}
    />
  );
}

const E = "green_coffee_lot";

export function BlockGalleryHarness() {
  const [primary, setPrimary] = React.useState("#b8860b");
  return (
    <ConfigProvider theme={{ token: { colorPrimary: primary } }}>
      <div style={{ padding: 20, background: "#f5f6f8", minHeight: "100vh" }}>
        <Space align="center" style={{ marginBottom: 16 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            体验区块对照台
          </Typography.Title>
          {/* 换主题色是为了验证"区块吃不吃 ConfigProvider 的 token"——
              手写色值的区块在这里切色不会有任何变化，一眼看得出来 */}
          <Segmented
            size="small"
            value={primary}
            onChange={v => setPrimary(String(v))}
            options={[
              { label: "琥珀", value: "#b8860b" },
              { label: "墨绿", value: "#2f6b4f" },
              { label: "靛蓝", value: "#1677ff" },
              { label: "洋红", value: "#c41d7f" },
            ]}
          />
        </Space>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <Cell label="MetricGrid · 有数据">
            <Block rendererKey="metric-grid" block={{ id: "b1", type: "MetricGrid", props: { title: "库存概览" }, binding: { entityRef: E, aggregate: "sum:weight" } }} />
          </Cell>
          <Cell label="MetricGrid · 字段无有效值（应显示「—」而非 0）">
            <Block rendererKey="metric-grid" block={{ id: "b2", type: "MetricGrid", props: { title: "库存概览" }, binding: { entityRef: E, aggregate: "sum:不存在字段" } }} />
          </Cell>

          <Cell label="TrendChart · 有数据">
            <Block rendererKey="trend-chart" block={{ id: "b3", type: "TrendChart", props: { title: "入库趋势" }, binding: { entityRef: E, timeDimensionRef: "at", timeGrain: "day", aggregate: "sum:weight" } }} />
          </Cell>
          <Cell label="TrendChart · 未绑时间字段（空态）">
            <Block rendererKey="trend-chart" block={{ id: "b4", type: "TrendChart", props: { title: "入库趋势" }, binding: { entityRef: E } }} />
          </Cell>

          <Cell label="RankedList · 有数据">
            <Block rendererKey="ranked-list" block={{ id: "b5", type: "RankedList", props: { title: "库存排行" }, binding: { entityRef: E, sortByRef: "weight", limit: 6 } }} />
          </Cell>
          <Cell label="RankedList · 未绑数值字段（空态）">
            <Block rendererKey="ranked-list" block={{ id: "b6", type: "RankedList", props: { title: "库存排行" }, binding: { entityRef: E } }} />
          </Cell>

          <Cell label="ActivityFeed · 有等级（颜色分正常/告警/异常）">
            <Block rendererKey="activity-feed" block={{ id: "b7", type: "ActivityFeed", props: { title: "近期动态" }, binding: { entityRef: E, timeFieldRef: "at", levelFieldRef: "status" } }} />
          </Cell>
          <Cell label="ActivityFeed · 零行（空态）">
            <Block rendererKey="activity-feed" block={{ id: "b8", type: "ActivityFeed", props: { title: "近期动态" }, binding: { entityRef: "empty_entity", timeFieldRef: "at" } }} />
          </Cell>

          {/* 宽行档（2026-07-29）：时间轴形态撑不满整行，右边三分之二是空的。
              variant=row 摊成一条满宽信息行，中段明细由 detailFieldRefs 声明。
              这一格给双倍宽度，否则看不出"宽行"的意义。 */}
          <div style={{ width: 856 }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              ActivityFeed · 宽行档 variant=row（对比上面的时间轴档）
            </Typography.Text>
            <div style={{ marginTop: 4 }}>
              <Block
                rendererKey="activity-feed"
                block={{
                  id: "b11",
                  type: "ActivityFeed",
                  props: { title: "近期动态", variant: "row" },
                  binding: {
                    entityRef: E,
                    timeFieldRef: "at",
                    levelFieldRef: "status",
                    detailFieldRefs: ["supplier", "origin", "weight"],
                  },
                }}
              />
            </div>
          </div>

          <Cell label="DataTable · 有数据（列头应出中文、枚举应出标签）">
            <Block rendererKey="data-table" block={{ id: "b9", type: "DataTable", props: { title: "生豆批次" }, binding: { entityRef: E } }} />
          </Cell>
          <Cell label="DataTable · 零行（空态）">
            <Block rendererKey="data-table" block={{ id: "b10", type: "DataTable", props: { title: "生豆批次" }, binding: { entityRef: "empty_entity" } }} />
          </Cell>
        </div>
      </div>
    </ConfigProvider>
  );
}
