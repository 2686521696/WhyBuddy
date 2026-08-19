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
  it("把技能库从主导航移到账号菜单，并移除管理后台入口", () => {
    expect(dashboardSource).not.toContain(
      '{ key: "skills", label: "技能库"'
    );
    expect(accountPanelSource).toContain('data-testid="account-skills"');
    expect(accountPanelSource).toContain('onClick={go("/agent-loop/skills")}');
    expect(accountPanelSource).not.toContain('data-testid="account-admin"');
    expect(accountPanelSource).not.toContain('onClick={go("/admin")}');
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
});
