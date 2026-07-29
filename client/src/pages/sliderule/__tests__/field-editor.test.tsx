/**
 * FieldEditor — 档位判定落到**真实 antd 组件**的锁。
 *
 * field-value-type.test.ts 锁的是"该判成哪一档"，这里锁的是"那一档确实渲染
 * 成了那个 antd 组件"。两者缺一不可：判定对了但 switch 里写错分支，单看
 * 判定测试是全绿的。
 *
 * 判定手段是 antd 的类名（项目把 prefixCls 配成 agent-ant，见
 * ConfigProvider 配置）。本仓库约定用 react-dom/server 静态渲染，不引 jsdom。
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigProvider } from "antd";
import { FieldEditor } from "../live-runtime/FieldEditor";
import type { AppFormFieldSchema } from "../live-runtime/app-runtime-schema";

/** 跟运行应用同一套 prefixCls，类名断言才对得上真实产物。 */
function render(field: Partial<AppFormFieldSchema>, value: unknown = undefined) {
  return renderToStaticMarkup(
    <ConfigProvider prefixCls="agent-ant">
      <FieldEditor
        field={{ id: "f", label: "字段", type: "string", ...field } as AppFormFieldSchema}
        value={value}
        refRows={[]}
        onChange={() => {}}
      />
    </ConfigProvider>
  );
}

const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `o${i}`,
    label: `选项${i}`,
    tone: "default" as const,
  }));

describe("FieldEditor · 日期不再用原生 input", () => {
  it("date → antd DatePicker", () => {
    const html = render({ type: "date" });
    expect(html).toContain("agent-ant-picker");
    // 这条是这次改动的核心：原生 input[type=date] 必须绝迹
    expect(html).not.toContain('type="date"');
  });

  it("datetime → DatePicker（带时间）", () => {
    const html = render({ type: "datetime" });
    expect(html).toContain("agent-ant-picker");
    expect(html).not.toContain('type="datetime-local"');
  });
});

describe("FieldEditor · 枚举三档各自落到对应组件", () => {
  it("2 个取值 → Segmented（平铺）", () => {
    const html = render({ type: "enum", options: opts(2) });
    expect(html).toContain("agent-ant-segmented");
    expect(html).not.toContain("agent-ant-select");
  });

  it("5 个取值 → Radio.Group 按钮组", () => {
    const html = render({ type: "enum", options: opts(5) });
    expect(html).toContain("agent-ant-radio-group");
    expect(html).toContain("agent-ant-radio-button"); // optionType=button
  });

  it("9 个取值 → Select（再平铺就占满整屏了）", () => {
    const html = render({ type: "enum", options: opts(9) });
    expect(html).toContain("agent-ant-select");
    expect(html).not.toContain("agent-ant-segmented");
  });

  it("平铺的两档把 label 而不是取值 id 摆给用户看", () => {
    // Select 收起时只渲染占位、不渲染选项（选项在展开的浮层里，静态渲染
    // 取不到），所以这条只覆盖 Segmented / Radio 两档。
    for (const n of [2, 5]) {
      const html = render({ type: "enum", options: opts(n) });
      expect(html).toContain("选项0");
      expect(html).not.toContain(">o0<"); // 裸取值 id 不能露出来
    }
    // Select 档至少要把"选什么"说清楚
    expect(render({ type: "enum", options: opts(9), label: "会员等级" })).toContain(
      "选择会员等级"
    );
  });
});

describe("FieldEditor · 数值按 format 落到对应控件", () => {
  it("percent → Slider + InputNumber（能拖也能填精确值）", () => {
    const html = render({ type: "number", format: "percent" }, 40);
    expect(html).toContain("agent-ant-slider");
    expect(html).toContain("agent-ant-input-number");
  });

  it("progress / score 同样有界 0-100", () => {
    for (const format of ["progress", "score"] as const) {
      const html = render({ type: "number", format }, 40);
      expect(html).toContain("agent-ant-slider");
    }
  });

  it("money → InputNumber 千分位，与读侧 formatMoney 对齐", () => {
    const html = render({ type: "number", format: "money" }, 1200000);
    expect(html).toContain("agent-ant-input-number");
    expect(html).toContain("1,200,000");
  });

  it("rating → Rate；无 format → 裸 InputNumber（不带滑杆）", () => {
    expect(render({ type: "number", format: "rating" }, 3)).toContain("agent-ant-rate");
    const plain = render({ type: "number" }, 7);
    expect(plain).toContain("agent-ant-input-number");
    expect(plain).not.toContain("agent-ant-slider");
  });
});

describe("FieldEditor · 其余档位", () => {
  it("masked → Input.Password，屏幕上不明文显示", () => {
    const html = render({ type: "string", format: "masked" }, "13800000000");
    expect(html).toContain("agent-ant-input-password");
    // 遮蔽靠 type=password（浏览器渲染成圆点）+ 自带的显隐切换按钮。
    // 值本身仍在 DOM 的 value 属性里——所有密码框都是这样，这里不假装
    // 它做了 DOM 层的脱敏，那是读侧 maskValue 的事。
    expect(html).toContain('type="password"');
    expect(html).toContain("eye-invisible");
  });

  it("text → TextArea 带字数", () => {
    const html = render({ type: "text" });
    expect(html).toContain("<textarea");
    expect(html).toContain("agent-ant-input-data-count");
  });

  it("boolean → Switch", () => {
    expect(render({ type: "boolean" }, true)).toContain("agent-ant-switch");
  });

  it("ref 且目标实体一行都没有 → 如实说明，不给个空下拉让人以为坏了", () => {
    const html = render({ type: "ref", label: "教练" });
    expect(html).toContain("暂无可选的教练");
    expect(html).not.toContain("agent-ant-select");
  });

  it("string → 普通 Input", () => {
    const html = render({ type: "string" });
    expect(html).toContain("agent-ant-input");
    expect(html).not.toContain("<textarea");
  });
});
