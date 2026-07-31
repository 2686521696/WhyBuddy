/**
 * PhonePageSections — 手机档业务页的 KPI / 图表 / 流程步骤（2026-07-28）。
 *
 * 背景：schema 声明了 6 种 pageKind（workbench / kanban / calendar /
 * dashboard / wizard / monitor），桌面档每种都有对应骨架，手机档此前**一种
 * 都没有**——无论页面是什么 kind，一律渲染成同一个裸列表。dashboard 页的
 * KPI 和图表、wizard 页的流程步骤，在手机上全都看不到。
 *
 * 这里补的是其中最省事的两种：形态在 PhoneHome 里已经有现成的，
 * 搬过来即可——KPI 走 Grid 两列卡片，流程走 Steps 竖排。图表节点由父层用
 * 同一个 chartBody 渲染好传进来（ECharts 与设备无关，只是高度矮一点）。
 *
 * 三段都可以为空：没有 stats 就不出 Grid，没有 charts 就不出卡片，
 * 没有 steps 就不出 Steps。一个 kind 只用得上其中一两段，不强求都填。
 */

import React from "react";
import { Card, Grid, Steps } from "antd-mobile";

const { Step } = Steps;

export interface PhoneSectionStat {
  id: string;
  label: string;
  /** null = 算不出来，如实显示「—」，不要填 0 冒充 */
  value: number | null;
  /** 值是预览种子数据算出来的，必须标注，不能让用户当成真实业务数 */
  isPreview?: boolean;
  prefix?: string;
  suffix?: string;
  precision?: number;
}

export interface PhoneSectionChart {
  id: string;
  label: string;
  node: React.ReactNode;
}

export interface PhoneSectionStep {
  id: string;
  title: string;
  description?: string;
}

export default function PhonePageSections({
  stats = [],
  charts = [],
  steps = [],
}: {
  stats?: PhoneSectionStat[];
  charts?: PhoneSectionChart[];
  steps?: PhoneSectionStep[];
}) {
  if (stats.length === 0 && charts.length === 0 && steps.length === 0)
    return null;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
      data-testid="phone-page-sections"
    >
      {steps.length > 0 && (
        <Card bodyStyle={{ padding: "8px 12px 4px" }}>
          <Steps
            direction="vertical"
            style={{ "--title-font-size": "13px" } as React.CSSProperties}
            data-testid="phone-page-steps"
          >
            {steps.map(s => (
              <Step key={s.id} title={s.title} description={s.description} />
            ))}
          </Steps>
        </Card>
      )}

      {stats.length > 0 && (
        <Grid columns={2} gap={8} data-testid="phone-page-stats">
          {stats.map(s => (
            <Grid.Item key={s.id}>
              <Card
                bodyStyle={{ padding: "10px 12px" }}
                data-testid={`phone-page-stat-${s.id}`}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--adm-color-weak, #999999)",
                    marginBottom: 2,
                  }}
                >
                  {s.label}
                </div>
                <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2 }}>
                  {s.value === null ? (
                    "—"
                  ) : (
                    <>
                      {s.prefix}
                      {s.precision !== undefined
                        ? s.value.toFixed(s.precision)
                        : s.value}
                      {s.suffix && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 400,
                            marginLeft: 2,
                            color: "var(--adm-color-weak, #999999)",
                          }}
                        >
                          {s.suffix}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {s.isPreview && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--adm-color-light, #cccccc)",
                      marginTop: 2,
                    }}
                  >
                    示例数据
                  </div>
                )}
              </Card>
            </Grid.Item>
          ))}
        </Grid>
      )}

      {charts.map(c => (
        <Card
          key={c.id}
          title={c.label}
          bodyStyle={{ padding: "4px 8px 8px" }}
          data-testid={`phone-page-chart-${c.id}`}
        >
          {c.node}
        </Card>
      ))}
    </div>
  );
}
