/**
 * PhoneCalendar — 手机档日历（antd-mobile Calendar，2026-07-28）。
 *
 * 桌面档 CalendarBoard 是自建月历（格子里直接铺事件条）。手机屏宽下格子只有
 * 50px 上下，铺不进事件文字，硬铺就是一堆截断的色块。移动端日历的通行做法是
 * **月历只做导航**：格子里标一个圆点表示"这天有数据"，点某天，下面出这天的
 * 列表。
 *
 * ⚠️ Calendar 在 antd-mobile 里标为「试验性」。评估结论是可用，但把风险写在
 * 这儿而不是等出事：
 *   - API 面很小（这里只用到 selectionMode / value / onChange / renderLabel），
 *     真被改也是这几个 prop，改起来是分钟级；
 *   - 试验性组件不保证跟随主版本的破坏性变更公告，而 antd-mobile 自 v5.42.3
 *     （2025-01）已 18 个月没发版——短期内不会有变更来打我们；
 *   - 兜底是明确的：日历渲染不出来时页面仍有完整列表（下面那半），不白屏。
 * 因此选择用它，而不是再自建一个月历。
 *
 * renderLabel 只标"有没有数据"，不标条数——手机格子里放数字会挤，而且用户
 * 真正要的是"哪几天有事"，条数点进去就知道。
 */

import React from "react";
import { Calendar } from "antd-mobile";

// localDateKey 放在 page-views.ts（纯函数、无 antd-mobile 依赖）——父层
// AppRuntimeScreen 也要用它，从这个文件引会把 antd-mobile 拉进静态依赖图，
// node 环境的测试会在收集期直接炸。
import { localDateKey } from "../page-views";

export default function PhoneCalendar({
  markedDates,
  value,
  onChange,
  children,
}: {
  /** 有数据的日期键集合（localDateKey 产出） */
  markedDates: Set<string>;
  value: Date | null;
  onChange: (d: Date | null) => void;
  /** 选中日的列表，由父层渲染（复用 PhonePageList） */
  children: React.ReactNode;
}) {
  return (
    <div data-testid="phone-calendar">
      <div
        style={{
          background: "var(--adm-color-background, #ffffff)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Calendar
          selectionMode="single"
          value={value}
          onChange={onChange}
          allowClear
          renderLabel={date =>
            markedDates.has(localDateKey(date)) ? (
              // 圆点而不是条数：手机格子塞不下数字，而"哪几天有事"才是
              // 用户在月视图上真正要的信息
              <span
                style={{
                  display: "inline-block",
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--adm-color-primary, #1677ff)",
                }}
                data-testid="phone-calendar-dot"
              />
            ) : null
          }
        />
      </div>
      <div style={{ marginTop: 8 }} data-testid="phone-calendar-list">
        {value && (
          <div
            style={{
              fontSize: 12,
              color: "var(--adm-color-weak, #999999)",
              padding: "2px 4px 6px",
            }}
          >
            {localDateKey(value)} · 再点一次该日期可看全部
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
