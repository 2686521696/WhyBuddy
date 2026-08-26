import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  new URL("../DashboardApp.tsx", import.meta.url),
  "utf8"
);
const accountPanelSource = readFileSync(
  new URL("../AccountPanel.tsx", import.meta.url),
  "utf8"
);
const dashboardCss = readFileSync(
  new URL("../dashboard.css", import.meta.url),
  "utf8"
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function cssBlocks(src: string, selector: string): string[] {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  return [...stripComments(src).matchAll(re)].map(m => m[1]);
}

describe("侧栏账号导航", () => {
  /*
   * ⚠ 这条判据 2026-08-26 重写过一次，因为它**靠字符串对不上碰巧通过**。
   *
   *   原来写的是 `dashboardSource 不含 '{ key: "skills", label: "技能库"'`，
   *   题面是"把技能库从主导航移到账号菜单"。而 2026-08-25 用户要求把它放回
   *   主导航（先叫「技能 · 连接器 · 伙伴」，08-26 改名「扩展中心」）——
   *   条目**已经回到主导航了**，判据却因为 label 字面量变了而继续绿。
   *   一条按错误理由通过的判据比没有更糟：它让人以为主导航还是干净的。
   *
   *   现在钉的是今天的事实：主导航有它、账号菜单也有一个快捷入口，
   *   两处指向同一个 view；管理后台仍然不进账号菜单。
   */
  it("扩展中心在主导航里，账号菜单里也有快捷入口，两处指向同一个 view", () => {
    expect(dashboardSource).toContain('key: "skills"');
    expect(dashboardSource).toContain('label: "扩展中心"');
    expect(accountPanelSource).toContain('data-testid="account-skills"');
    expect(accountPanelSource).toContain('onClick={go("/agent-loop/skills")}');
  });

  it("管理后台不进账号菜单", () => {
    expect(accountPanelSource).not.toContain('data-testid="account-admin"');
    expect(accountPanelSource).not.toContain('onClick={go("/admin")}');
  });

  it("扩展中心整行都能开合，不是只有箭头才能收", () => {
    const src = stripComments(dashboardSource);
    const at = src.indexOf("if (item.children)");
    expect(at).toBeGreaterThan(-1);
    const around = src.slice(at, at + 220);
    expect(around).toContain("prev === item.key ? null : item.key");
    expect(around).not.toMatch(/if \(item\.children\) setOpenKey\(item\.key\)/);
    expect(src).toContain("agent-nav-expand");
  });
});

describe("侧栏底栏 · Cursor 尺度", () => {
  it("帮助和账号装在同一 dock，帮助行没有右箭头", () => {
    const start = dashboardSource.indexOf("native-agent-footer");
    const end = dashboardSource.indexOf("<AccountPanel");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const dock = dashboardSource.slice(start, end);
    expect(dock).toContain("sidebar-help-docs");
    expect(dock).toContain("帮助文档");
    // 不该有：设置页列表那种行尾 ›。变异：把 RightOutlined 加回帮助行必红。
    expect(dock).not.toContain("RightOutlined");
    expect(accountPanelSource).toContain('className="native-agent-user');
  });

  it("账号行不是描边卡片，帮助行不是 44px 导航块", () => {
    const user = cssBlocks(dashboardCss, ".native-agent-user");
    expect(user.length).toBeGreaterThan(0);
    expect(user.some(b => /border:\s*1px/.test(b))).toBe(false);
    expect(user.some(b => /border:\s*0/.test(b))).toBe(true);

    const help = cssBlocks(dashboardCss, ".native-agent-help");
    expect(help.some(b => /height:\s*44px/.test(b))).toBe(false);
    expect(help.some(b => /height:\s*36px/.test(b))).toBe(true);
    expect(help.some(b => /padding:\s*0 var\(--dock-pad\)/.test(b))).toBe(true);

    const userPad = user.some(b => /padding:\s*0 var\(--dock-pad\)/.test(b));
    expect(userPad).toBe(true);

    const footer = cssBlocks(dashboardCss, ".native-agent-footer");
    expect(footer.some(b => /border-top/.test(b))).toBe(true);
    expect(footer.some(b => /--dock-slot:\s*20px/.test(b))).toBe(true);
  });

  it("帮助图标和头像占同一列，账号行不再写已登录", () => {
    expect(dashboardSource).toContain('className="native-agent-dock-slot"');
    expect(accountPanelSource).toContain("native-agent-dock-slot");
    expect(stripComments(accountPanelSource)).not.toContain("已登录");
  });

  it("超管档位写 Admin，头像是纯色圆不是蓝青渐变", () => {
    const panel = stripComments(accountPanelSource);
    expect(panel).toContain(">Admin<");
    expect(panel).not.toContain("管理员");
    const avatar = cssBlocks(dashboardCss, ".native-agent-user-avatar").join(" ");
    expect(avatar).not.toMatch(/linear-gradient/);
    expect(avatar).toMatch(/background:\s*#e4e4e7/);
    expect(avatar).toMatch(/color:\s*#52525b/);
    const name = cssBlocks(dashboardCss, ".native-agent-user-name").join(" ");
    expect(name).not.toMatch(/#0f172a/);
    expect(name).toMatch(/#52525b/);
  });
});
