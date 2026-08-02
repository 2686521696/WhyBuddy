/**
 * 面团登录页（2026-08-03）。
 *
 * 版式取自 shadcn/ui 官方 login-02 区块（MIT）。这份测试盯两件事：
 *
 *   ① **回跳地址只认站内路径** —— 这是登录页最容易埋的安全洞。放过外站地址
 *      就是开放重定向：攻击者拿一个你域名下的链接把人骗到钓鱼页，而用户在
 *      点击前看到的域名是你的。
 *   ② 页面在服务端渲染（renderToStaticMarkup）下不炸，且品牌与关键入口都在。
 *
 * 仓库里 React 测试统一用 renderToStaticMarkup（没有 jsdom），所以交互流程
 * （填表、提交、切模式）测不了——那部分逻辑在 lib/auth-client 那份测试里覆盖。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthCard, BrandPanel, safeNextPath } from "../MianTuanAuthPage";
import { MianTuanMark, MianTuanWordmark } from "@/components/brand/MianTuanMark";

describe("回跳地址（开放重定向防护）", () => {
  it("接受站内相对路径", () => {
    expect(safeNextPath("/agent-loop/workbench")).toBe("/agent-loop/workbench");
    expect(safeNextPath("/agent-loop/sliderule?x=1")).toBe("/agent-loop/sliderule?x=1");
  });

  it("拒绝外站绝对地址", () => {
    // 放过去就是开放重定向：钓鱼链接挂在你的域名下
    expect(safeNextPath("https://evil.com")).toBe("/agent-loop/workbench");
    expect(safeNextPath("http://evil.com/x")).toBe("/agent-loop/workbench");
  });

  it("拒绝协议相对地址", () => {
    // `//evil.com` 浏览器当绝对地址处理——最经典的绕过写法
    expect(safeNextPath("//evil.com")).toBe("/agent-loop/workbench");
    expect(safeNextPath("//evil.com/path")).toBe("/agent-loop/workbench");
  });

  it("拒绝反斜杠变体", () => {
    // 部分浏览器把 `\` 等价于 `/`，`/\evil.com` 会被当成协议相对地址
    expect(safeNextPath("/\\evil.com")).toBe("/agent-loop/workbench");
  });

  it("空值回默认页", () => {
    expect(safeNextPath(null)).toBe("/agent-loop/workbench");
    expect(safeNextPath("")).toBe("/agent-loop/workbench");
    expect(safeNextPath("   ")).toBe("/agent-loop/workbench");
  });

  it("不以斜杠开头的一律拒绝", () => {
    // `evil.com` 这种相对路径在某些路由实现下会被拼成外站
    expect(safeNextPath("evil.com")).toBe("/agent-loop/workbench");
    expect(safeNextPath("javascript:alert(1)")).toBe("/agent-loop/workbench");
  });
});

describe("品牌标识", () => {
  it("能渲染，且同页多实例的渐变 id 不撞车", () => {
    // 渐变 id 写死的话，第二个实例会引用到第一个的定义——表现是"其中一个变透明"，
    // 只在特定组合下复现，很难查。所以用 useId 生成。
    const markup = renderToStaticMarkup(
      <div>
        <MianTuanMark size={40} />
        <MianTuanMark size={20} />
      </div>
    );
    const ids = [...markup.matchAll(/id="(mt-grad-[^"]+)"/g)].map(m => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("文字标识带中文名和域名", () => {
    const markup = renderToStaticMarkup(<MianTuanWordmark />);
    expect(markup).toContain("面团");
    expect(markup).toContain("MIANTUAN.AI");
  });

  it("有无障碍标签", () => {
    expect(renderToStaticMarkup(<MianTuanMark />)).toContain('aria-label="面团"');
  });
});

describe("登录页", () => {
  it("品牌区讲清楚了主张，以及「浏览无需登录」", () => {
    // 整页渲染要 wouter 的 window，这里直接测两个展示组件——
    // 它们才是版式与文案的载体，路由不是这份测试的目标。
    const markup = renderToStaticMarkup(<BrandPanel />);
    expect(markup).toContain("欢迎来到面团");
    expect(markup).toContain("把一句模糊想法");
    // 这句必须在：新用户不知道匿名能干什么，会以为不登录寸步难行
    expect(markup).toContain("浏览应用中心无需登录");
    expect(markup).toContain("miantuan.ai");
  });

  it("表单卡有邮箱、密码和切换注册的入口", () => {
    const markup = renderToStaticMarkup(<AuthCard onDone={() => {}} />);
    expect(markup).toContain('data-testid="auth-email"');
    expect(markup).toContain('data-testid="auth-password"');
    expect(markup).toContain('data-testid="auth-switch-mode"');
    expect(markup).toContain("还没有账号");
  });

  it("默认是登录模式，不是注册", () => {
    // 回访用户远多于新用户；默认落在注册会让老用户多点一次
    const markup = renderToStaticMarkup(<AuthCard onDone={() => {}} />);
    expect(markup).toContain("浏览无需登录；复刻和推演需要账号。");
    expect(markup).not.toContain("至少 8 位");
  });
});
