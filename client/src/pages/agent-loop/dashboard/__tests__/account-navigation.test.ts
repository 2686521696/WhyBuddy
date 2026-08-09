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
