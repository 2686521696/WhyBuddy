/**
 * WorkModeSurface — Work 模式（角色自动巡演）的诚实占位面。
 *
 * 顶栏 Work/Code 切换上线（用户裁决，TRAE 对标）时巡演引擎尚未动工——
 * 本面只陈述已成立的事实：路线已裁决（docs/WORK_MODE_PLAN.md）、素材已
 * 采购进仓、Agentshire 解剖已通过；不演任何假巡演。一期（2D 泳道）落地后
 * 由真实巡演面替换。
 */

import React from "react";
import { Users, Route, Boxes } from "lucide-react";

const READY_ITEMS = [
  {
    icon: <Route className="h-4 w-4 text-[#1677ff]" />,
    title: "路线已裁决",
    desc: "剧本层（五系统 → 分幕）→ 执行层（真跑流程实例/权限拦截）→ 呈现层（2D 泳道先行，3D 可换皮）",
  },
  {
    icon: <Users className="h-4 w-4 text-[#1677ff]" />,
    title: "角色演员已就位",
    desc: "10 个 CC0 人形角色（西装/便装/工装/老绅士）+ 43 剪辑动画库，已压缩进仓（5.3MB）",
  },
  {
    icon: <Boxes className="h-4 w-4 text-[#1677ff]" />,
    title: "3D 引擎解剖已通过",
    desc: "Agentshire（MIT）事件接口实测可脱离宿主独立驱动，办公场景资产增量约 3~4MB",
  },
];

export function WorkModeSurface() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-6 px-6"
      data-testid="sliderule-work-mode"
    >
      <div className="text-center">
        <div className="text-[17px] font-semibold text-stone-700">
          Work 模式 · 角色自动巡演
        </div>
        <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-6 text-stone-500">
          将来在这里：你推演出的应用会由各业务角色自动跑通完整流程——
          数据真实落库、权限真实拦截、流程真实推进，最后产出一份角色巡演
          报告。相当于把「这套系统各角色用起来顺不顺」可视化地测一遍。
        </p>
      </div>
      <div className="w-full max-w-[560px] space-y-2">
        {READY_ITEMS.map(item => (
          <div
            key={item.title}
            className="flex items-start gap-3 rounded-lg border border-[#e5e7eb] bg-white/80 px-4 py-3"
          >
            <span className="mt-0.5 shrink-0">{item.icon}</span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-stone-700">
                {item.title}
              </div>
              <div className="mt-0.5 text-xs leading-5 text-stone-400">
                {item.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-stone-400">
        巡演引擎建设中——先到 Code 模式推演出你的应用，Work 模式一期上线后
        即可让角色替你试跑它。
      </p>
    </div>
  );
}
