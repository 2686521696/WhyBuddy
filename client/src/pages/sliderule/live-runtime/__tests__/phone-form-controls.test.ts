/**
 * 手机档表单控件档位（2026-07-29）。
 *
 * 此前 PhoneFormField 是自己一套 `if (type === "number") … else if …`，跟桌面档
 * 各判各的，桌面档专门建的单一真相源 field-value-type 在手机档形同虚设。
 * 真实后果不是"风格不统一"这种软问题，是四个实打实的缺陷：
 *   - boolean 一条分支都没命中，掉到字符串输入框，用户得手打 "true"
 *   - 2 个取值的枚举跟 20 个取值的枚举一样弹 Picker 浮层
 *   - percent/progress/score 用 Stepper，0→80 要点 80 次
 *   - masked 在桌面是密码框，在手机是明文
 *
 * 这里锁的是**判定结果**（纯函数，可直接跑），加上源码里"哪一档用哪个
 * 组件"的对应关系——没有 jsdom，控件长相靠真机截图验，但档位判错了截图也白截。
 */
import { describe, it, expect } from "vitest";
// 从判定表那个文件导入，不从 PhoneFormField 导——后者 import 了 antd-mobile，
// 拉进测试环境会在解析它的样式产物时炸（本仓库没有 jsdom / less 转换）。
// 判定函数本来就该待在判定表里，这个约束顺带把它钉在那儿。
import { resolveValueTypeWithObservedOptions as resolvePhoneValueType } from "../field-value-type";
import type { AppFormFieldSchema } from "../app-runtime-schema";

const f = (o: Partial<AppFormFieldSchema>): AppFormFieldSchema =>
  ({ id: "x", label: "字段", type: "string", ...o }) as AppFormFieldSchema;
const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `选项${i}`, tone: "default" as const }));

const fieldSrc = await import("../phone-mobile/PhoneFormField.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const noticeSrc = await import("../phone-mobile/PhoneSeedNotice.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const screenSrc = await import("../AppRuntimeScreen.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const sectionsSrc = await import("../phone-mobile/PhoneDetailSections.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);

describe("档位判定与桌面档同源", () => {
  it("boolean → switch（此前掉进字符串输入框，让人手打 true）", () => {
    expect(resolvePhoneValueType(f({ type: "boolean" }), [])).toBe("switch");
  });

  it("masked → password（此前是明文，同一字段换个设备就摊开给旁人看）", () => {
    expect(resolvePhoneValueType(f({ type: "string", format: "masked" }), [])).toBe("password");
  });

  it.each([
    ["percent", "percent"],
    ["progress", "progress"],
    ["score", "score"],
  ])("number + %s → %s（滑杆，不是点 80 次的 Stepper）", (format, expected) => {
    expect(resolvePhoneValueType(f({ type: "number", format }), [])).toBe(expected);
  });

  it("number 无 format → digit，money → money（这两档才是 Stepper）", () => {
    expect(resolvePhoneValueType(f({ type: "number" }), [])).toBe("digit");
    expect(resolvePhoneValueType(f({ type: "number", format: "money" }), [])).toBe("money");
  });

  it("枚举按取值个数分档：≤3 平铺 / 4-6 两列 / 更多才收进浮层", () => {
    expect(resolvePhoneValueType(f({ type: "enum", options: opts(2) }), [])).toBe("segmented");
    expect(resolvePhoneValueType(f({ type: "enum", options: opts(5) }), [])).toBe("radio");
    expect(resolvePhoneValueType(f({ type: "enum", options: opts(9) }), [])).toBe("select");
  });
});

describe("手机档独有的一条：历史取值也算候选", () => {
  it("模型没声明取值时，用已写入行里出现过的值分档", () => {
    // 这是手机档一直有的兜底。不喂进判定表的话，一个实际只有两种取值的字段
    // 会被判成 tags（自由输入），白白丢掉选择器。
    expect(resolvePhoneValueType(f({ type: "enum" }), ["草稿", "已完成"])).toBe("segmented");
    expect(resolvePhoneValueType(f({ type: "enum" }), Array.from({ length: 9 }, (_, i) => `v${i}`))).toBe(
      "select"
    );
  });

  it("声明取值优先于历史取值", () => {
    expect(
      resolvePhoneValueType(f({ type: "enum", options: opts(9) }), ["只有一个历史值"])
    ).toBe("select");
  });

  it("既无声明也无历史值 → tags（调用方退回自由输入，不摆空选择器）", () => {
    expect(resolvePhoneValueType(f({ type: "enum" }), [])).toBe("tags");
  });

  it("ref 不合成候选 —— 它的候选是另一张表的行，不是枚举取值", () => {
    // 合成了会被判成 select/segmented，走错分支（拿 enumOptions 当候选）
    expect(resolvePhoneValueType(f({ type: "ref" }), ["a", "b"])).toBe("ref");
  });
});

describe("档位 → antd-mobile 组件的对应关系", () => {
  it("不再自己判 field.type，改读判定表", () => {
    expect(fieldSrc).toContain("resolveValueTypeWithObservedOptions");
    // 旧的 type 直判分支必须清干净，留一条就是两套判定并存
    expect(fieldSrc).not.toContain('field.type === "number"');
    expect(fieldSrc).not.toContain('field.type === "date"');
    expect(fieldSrc).not.toContain('field.type === "enum"');
  });

  it("四个新档位都接了对应组件", () => {
    expect(fieldSrc).toContain("Switch");
    expect(fieldSrc).toContain("Selector");
    expect(fieldSrc).toContain("Slider");
    expect(fieldSrc).toContain('type="password"');
  });

  it("少量枚举用 Selector 不用 Segmented —— 官方定位：Segmented 是视图切换", () => {
    // antd-mobile 文档：Segmented「切换选中项时关联区域内容发生变化」，
    // Selector「一般在筛选和表单中使用」。这里是表单录入。
    expect(fieldSrc).toMatch(/<Selector\b/);
    // 断言看的是**用法**不是字面词：文件注释里就写着"为什么不用 Segmented"，
    // 按词断言会被自己的注释绊倒（第一版就是）。
    expect(fieldSrc).not.toMatch(/<Segmented\b/);
    expect(fieldSrc).not.toMatch(/^\s*Segmented,\s*$/m);
  });

  it("滑杆带 popover —— 不显示数字的滑杆是盲拖", () => {
    expect(fieldSrc).toMatch(/popover/);
  });
});

describe("示例数据标注（NoticeBar）", () => {
  it("用 NoticeBar，不再手搓橙字方块", () => {
    expect(noticeSrc).toContain("NoticeBar");
    expect(noticeSrc).toContain('color="alert"');
  });

  it("不可关闭 —— 让用户一键关掉等于允许他不知情地继续看假数据", () => {
    // 又是"按词断言被自己的注释绊倒"：文件里就写着「不给 closeable」。
    // 断言只看 JSX 上有没有真把这个 prop 设上。
    expect(noticeSrc).not.toMatch(/^\s*closeable(\s*=|\s*$)/m);
  });

  it("文案短到不触发跑马灯（390px/15px 下约 19 个中文字）", () => {
    // NoticeBar 内容超宽会自动滚动。桌面档那句原文搬过来实测溢出 115px
    //（内容区 294px / 文字 409px），真机上就是一行永远在动的字。
    const m = noticeSrc.match(/content=\{`([^`]+)`\}/);
    expect(m).not.toBeNull();
    // 去掉模板占位后按"中文字≈1、ASCII≈0.5"折算，留一点余量
    const literal = m![1].replace(/\$\{[^}]+\}/g, "99");
    const weight = [...literal].reduce((n, ch) => n + (/[一-龥]/.test(ch) ? 1 : 0.5), 0);
    expect(weight).toBeLessThanOrEqual(19);
  });
});

describe("详情分区的壳按设备分档（跨库纪律）", () => {
  it("手机档用 antd-mobile 的 Collapse，不是 antd 的", () => {
    expect(sectionsSrc).toContain('from "antd-mobile"');
    expect(sectionsSrc).not.toContain('from "antd"');
  });

  it("AppRuntimeScreen 里 antd Collapse 只在非手机分支渲染", () => {
    // detailBody 是跨设备共用的一段 JSX。第一版把分区收进 Collapse 时只换了
    // 桌面的，结果 antd 的 Collapse 被渲染进 antd-mobile 的 Popup 里——
    // 字段部分早就分档了（PhoneDetailFields / Descriptions），分区的壳没道理不分。
    const i = screenSrc.indexOf("detailSectionItems.map");
    expect(i).toBeGreaterThan(0);
    // 分档写法：isPhone ? <LazyPhoneDetailSections/> : <Collapse/>
    const seg = screenSrc.slice(i - 400, i + 900);
    expect(seg).toContain("LazyPhoneDetailSections");
    expect(seg).toMatch(/isPhone \?/);
  });
});
