/**
 * ComposerSlashMenu — 输入框里 `/` 唤起的能力面板。
 *
 * 判定层在 composer-slash.ts（纯函数、可变异）；这里只管画和键盘。
 *
 * ⚠ 面板锚在**输入框上方**，不跟着光标走。理由写在 composer-slash.ts 头注：
 *   跟光标要在 textarea 里量插入符坐标（镜像 div 那一套），对字号/行高/
 *   缩放/IME/滚动全敏感，是一整类难复现 bug 的来源。主流聊天输入框
 *   （ChatGPT / Claude / 豆包）都锚在上方。
 *
 * ⚠ 面板必须画在**输入框那个 relative 容器内部**。挂到 body 上的话 absolute
 *   会一路找到 body，跑去屏幕左上角——设计系统色板那条注释里记过同一个坑。
 */

import React from "react";
import { Blocks, Plug, Users } from "lucide-react";

import type { SlashItem, SlashKind } from "./composer-slash";

const KIND_LABEL: Record<SlashKind, string> = {
  skill: "技能",
  connector: "连接器",
  partner: "伙伴",
};

const KIND_ICON: Record<SlashKind, React.ComponentType<{ className?: string }>> = {
  skill: Blocks,
  connector: Plug,
  partner: Users,
};

const KIND_TONE: Record<SlashKind, string> = {
  skill: "border-[#d6e4ff] bg-[#f0f5ff] text-[#1677ff]",
  connector: "border-[#d9f7be] bg-[#f6ffed] text-[#389e0d]",
  partner: "border-[#ffe7ba] bg-[#fff7e6] text-[#d46b08]",
};

export function CapabilityChip({
  item,
  onRemove,
}: {
  item: SlashItem;
  onRemove?: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <span
      data-testid="sliderule-capability-chip"
      data-kind={item.kind}
      data-key={item.key}
      title={`${KIND_LABEL[item.kind]} · ${item.description}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] ${KIND_TONE[item.kind]}`}
    >
      <Icon className="h-3 w-3" />
      {item.name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除 ${item.name}`}
          className="ml-0.5 rounded-full px-1 leading-none opacity-60 transition hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function ComposerSlashMenu({
  items,
  highlight,
  query,
  onPick,
  onHover,
}: {
  items: readonly SlashItem[];
  highlight: number;
  query: string;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div
      data-testid="sliderule-slash-menu"
      data-count={items.length}
      className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[min(420px,92vw)] overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
    >
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-stone-400">
        <span>技能 · 连接器 · 伙伴</span>
        <span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
      </div>
      {items.length === 0 ? (
        <div
          data-testid="sliderule-slash-empty"
          className="px-3 pb-3 text-[12px] text-stone-400"
        >
          没有匹配「{query}」的能力。去「技能 · 连接器 · 伙伴」里装一个。
        </div>
      ) : (
        <div className="max-h-[280px] overflow-y-auto pb-1">
          {items.map((item, i) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <button
                key={`${item.kind}:${item.key}`}
                type="button"
                data-testid="sliderule-slash-item"
                data-kind={item.kind}
                data-key={item.key}
                data-active={i === highlight ? "1" : "0"}
                onMouseEnter={() => onHover(i)}
                // ⚠ 用 onMouseDown + preventDefault，不用 onClick：onClick 之前
                //   textarea 已经失焦，面板会先关掉，点击落空。
                onMouseDown={event => {
                  event.preventDefault();
                  onPick(item);
                }}
                className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition ${
                  i === highlight ? "bg-[#f2f5fa]" : "hover:bg-[#f7f8fa]"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${KIND_TONE[item.kind]}`}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-stone-800">
                      {item.name}
                    </span>
                    <span className="shrink-0 rounded px-1 text-[10px] text-stone-400">
                      {KIND_LABEL[item.kind]}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-stone-500">
                    {item.description}
                  </span>
                  {/* ⚠ 不可用的照样列出来并说明缺什么：列表里干脆不出现的话，
                      用户只会以为"这个产品没有天气"，而不是"我还没配"。 */}
                  {item.unavailable ? (
                    <span
                      data-testid="sliderule-slash-unavailable"
                      className="mt-0.5 block truncate text-[11px] text-[#d46b08]"
                    >
                      {item.unavailable}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
