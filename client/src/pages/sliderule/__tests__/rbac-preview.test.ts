import { describe, it, expect } from "vitest";
import { deriveAppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import {
  accessForRole,
  deriveRoleAccess,
  pageAccessForRole,
} from "../live-runtime/rbac-preview";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "leave_request",
        name: "请假单",
        fields: [{ id: "reason", name: "事由", type: "string" }],
      },
      {
        id: "audit_log",
        name: "审计日志",
        fields: [{ id: "note", name: "备注", type: "string" }],
      },
    ],
  },
  rbac: {
    roles: ["employee", "manager", "auditor"],
    permissions: ["leave:create", "leave:read", "audit:read"],
    menus: [
      {
        id: "m1",
        label: "我的请假",
        roleRefs: ["employee", "manager"],
        permissionRefs: ["leave:create", "leave:read"],
      },
      {
        id: "m2",
        label: "审批台",
        roleRefs: ["manager"],
        permissionRefs: ["leave:read"],
      },
      {
        id: "m3",
        label: "审计中心",
        roleRefs: ["auditor"],
        permissionRefs: ["audit:read"],
      },
    ],
  },
  workflow: { nodes: [{ id: "n1", name: "提交" }], transitions: [] },
  page: {
    pages: [
      {
        id: "leave_page",
        name: "请假申请页",
        fieldBindings: ["leave_request.reason"],
        actionPermissions: ["leave:create", "leave:read"],
      },
      {
        id: "audit_page",
        name: "审计页",
        fieldBindings: ["audit_log.note"],
        actionPermissions: ["audit:read"],
      },
      {
        id: "public_page",
        name: "公告页",
        fieldBindings: ["leave_request.reason"],
      },
    ],
  },
  aigc: { capabilities: [] },
  appbundle: {},
};

describe("rbac-preview（角色 → 页面可见性/操作权）", () => {
  it("角色权限集 = roleRefs 命中的菜单 permissionRefs 并集", () => {
    const access = deriveRoleAccess(MODEL);
    expect(access.map(a => a.role)).toEqual(["employee", "manager", "auditor"]);
    expect(access[0].permissions).toEqual(["leave:create", "leave:read"]);
    expect(access[1].permissions).toEqual(["leave:create", "leave:read"]); // m1+m2 去重
    expect(access[2].permissions).toEqual(["audit:read"]);
    expect(access[2].menuLabels).toEqual(["审计中心"]);
  });

  it("页面可见性：持有任一声明动作可见；公共页恒可见；新建按 *:create 卡", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const employee = pageAccessForRole(
      schema.pages,
      accessForRole(MODEL, "employee")
    );

    const leave = employee.find(p => p.pageId === "leave_page")!;
    expect(leave.visible).toBe(true);
    expect(leave.canCreate).toBe(true);
    expect(leave.grantedActions).toEqual(["leave:create", "leave:read"]);

    const audit = employee.find(p => p.pageId === "audit_page")!;
    expect(audit.visible).toBe(false); // 无 audit:read → 锁定
    expect(audit.deniedActions).toEqual(["audit:read"]);

    const pub = employee.find(p => p.pageId === "public_page")!;
    expect(pub.visible).toBe(true); // 未声明动作 → 公共页
    expect(pub.createPermission).toBeNull(); // 未声明 create → 不设卡
    expect(pub.canCreate).toBe(true);
  });

  it("auditor 看请假页锁定、新建禁止（fail-closed），审计页可见", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const auditor = pageAccessForRole(
      schema.pages,
      accessForRole(MODEL, "auditor")
    );

    const leave = auditor.find(p => p.pageId === "leave_page")!;
    expect(leave.visible).toBe(false);
    expect(leave.canCreate).toBe(false);
    expect(leave.createPermission).toBe("leave:create");

    expect(auditor.find(p => p.pageId === "audit_page")!.visible).toBe(true);
  });

  it("未知角色/无菜单授权：声明了动作的页面全锁定，公共页仍可见", () => {
    const schema = deriveAppRuntimeSchema(MODEL)!;
    const ghost = pageAccessForRole(
      schema.pages,
      accessForRole(MODEL, "ghost")
    );
    expect(ghost.find(p => p.pageId === "leave_page")!.visible).toBe(false);
    expect(ghost.find(p => p.pageId === "public_page")!.visible).toBe(true);
  });
});
