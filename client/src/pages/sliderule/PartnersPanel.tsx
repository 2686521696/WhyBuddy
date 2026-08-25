/**
 * PartnersPanel — 「技能 · 连接器 · 伙伴」页里的伙伴层。
 *
 * 伙伴 = 一套预置好的能力组合 + 一句起手意图（见 partners.ts 头注：
 * 这里不做人设，人设是最容易造出一堆看着丰满、其实什么都不接的东西的地方）。
 *
 * ⚠ 每个伙伴的每一件依赖都**当场核对**：连接器在不在、技能装没装。
 *   缺什么就明说缺什么，按钮也不给按——一个看着能用、点了没反应的东西
 *   比没有这个东西更糟。
 */

import React from "react";
import { Button, Empty, Tag, Tooltip } from "antd";
import { TeamOutlined } from "@ant-design/icons";

import {
  BUILTIN_PARTNERS,
  partnerReadiness,
  type Partner,
} from "./partners";

export function PartnersPanel({
  custom,
  connectorIds,
  skillKeys,
  onUse,
  onDelete,
}: {
  custom: Partner[];
  connectorIds: string[];
  skillKeys: string[];
  onUse: (p: Partner) => void;
  onDelete: (id: string) => void;
}) {
  const groups: Array<{ label: string; list: Partner[] }> = [
    { label: "内置小队", list: [...BUILTIN_PARTNERS] },
    { label: "我攒的小队", list: custom },
  ];

  return (
    <div className="space-y-3" data-testid="partners-list">
      <div className="rounded bg-orange-50 px-2.5 py-1.5 text-[11px] text-orange-800 ring-1 ring-orange-200">
        伙伴是<b>一套装配好的能力 + 一句起手意图</b>。点「用这个伙伴」会把它
        要的连接器/技能挂到这一轮，并把起手意图填进输入框——你可以再改再发。
      </div>
      {groups.map(g =>
        g.list.length === 0 ? (
          g.label === "我攒的小队" ? (
            <div key={g.label} className="space-y-2">
              <div className="text-xs font-medium text-stone-500">{g.label}</div>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="在输入框里用 / 挂几个能力，再回这里存成小队"
              />
            </div>
          ) : null
        ) : (
          <div key={g.label} className="space-y-2">
            <div className="text-xs font-medium text-stone-500">
              {g.label} · {g.list.length}
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
              {g.list.map(p => {
                const { ready, missing } = partnerReadiness(p, {
                  connectorIds,
                  skillKeys,
                });
                return (
                  <div
                    key={p.id}
                    data-testid="partner-card"
                    data-partner={p.id}
                    data-ready={ready ? "1" : "0"}
                    className="flex flex-col rounded-lg border border-[#e9edf2] bg-white p-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff7e6] text-[#d46b08]">
                        <TeamOutlined />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-stone-800">
                          {p.name}
                        </div>
                        <div className="mt-0.5 text-[12px] text-stone-500">
                          {p.description}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.needs.map(n => (
                        <Tag
                          key={`${n.kind}:${n.key}`}
                          color={n.kind === "connector" ? "green" : "blue"}
                          style={{ marginInlineEnd: 0 }}
                        >
                          {n.name}
                        </Tag>
                      ))}
                    </div>
                    <div className="mt-2 line-clamp-2 rounded bg-[#fafafa] px-2 py-1 text-[11px] text-stone-500">
                      {p.opener || "（没有起手意图）"}
                    </div>
                    {/* ⚠ 缺什么就明说缺什么，别只给一个灰按钮 */}
                    {ready ? null : (
                      <div
                        data-testid="partner-missing"
                        className="mt-1.5 text-[11px] text-[#d46b08]"
                      >
                        还缺：{missing.map(m => m.name).join("、")}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <Tooltip title={ready ? "" : "依赖还没齐"}>
                        <Button
                          size="small"
                          type="primary"
                          ghost
                          disabled={!ready}
                          data-testid="partner-use"
                          onClick={() => onUse(p)}
                        >
                          用这个伙伴
                        </Button>
                      </Tooltip>
                      {p.builtin ? null : (
                        <Button
                          size="small"
                          type="text"
                          danger
                          onClick={() => onDelete(p.id)}
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}
    </div>
  );
}
