/**
 * 管理台的三道门（2026-08-03 改：身份源换成新的账号体系）。
 *
 * 旧的 `useAuthStore`（Node/MySQL）已随整套下掉，这里改成 mock `useAuth`。
 * 盯的东西没变，而且多了一档：**登录态还没问出来时不能下结论**——
 * 直接判"未登录"会让管理员先看到一屏 Sign in required 再闪回控制台。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth-client";

import { AdminLayout } from "./AdminLayout";
import { AdminOverviewPage } from "./Overview";

const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as AuthUser | null,
    ready: true,
  },
}));

vi.mock("@/lib/use-auth", () => ({
  useAuth: () => ({
    user: authState.user,
    ready: authState.ready,
    capabilities: {
      loggedIn: Boolean(authState.user),
      isSuperuser: Boolean(authState.user?.isSuperuser),
      can: {
        browse: true,
        viewApp: true,
        fork: Boolean(authState.user),
        drive: Boolean(authState.user),
        manageOwn: Boolean(authState.user),
      },
    },
    refresh: async () => {},
    signOut: async () => {},
  }),
}));

const user: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  displayName: "User One",
  isSuperuser: false,
  isVerified: true,
  createdAt: "2026-05-01T00:00:00.000Z",
};

describe("AdminLayout", () => {
  beforeEach(() => {
    authState.user = null;
    authState.ready = true;
  });

  it("登录态未就绪时既不放行也不判未登录", () => {
    authState.ready = false;

    const markup = renderToStaticMarkup(
      <AdminLayout>
        <AdminOverviewPage />
      </AdminLayout>
    );

    expect(markup).toContain("Checking session");
    expect(markup).not.toContain("Sign in required");
    expect(markup).not.toContain('data-testid="admin-overview-page"');
  });

  it("未登录时给登录入口，不给管理内容", () => {
    const markup = renderToStaticMarkup(
      <AdminLayout>
        <AdminOverviewPage />
      </AdminLayout>
    );

    expect(markup).toContain("Sign in required");
    // 指向新登录页；旧的 /login 只剩一条重定向
    expect(markup).toContain("/signin");
    expect(markup).not.toContain('data-testid="admin-overview-page"');
  });

  it("普通用户看不到管理导航和子页面", () => {
    authState.user = user;

    const markup = renderToStaticMarkup(
      <AdminLayout>
        <AdminOverviewPage />
      </AdminLayout>
    );

    expect(markup).toContain("Admin access required");
    expect(markup).not.toContain("Admin navigation");
    expect(markup).not.toContain('data-testid="admin-overview-page"');
  });

  it("超管能看到管理导航和子页面", () => {
    authState.user = {
      ...user,
      isSuperuser: true,
      email: "admin@example.com",
    };

    const markup = renderToStaticMarkup(
      <AdminLayout>
        <section data-testid="admin-child-page">Admin page</section>
      </AdminLayout>
    );

    expect(markup).toContain("Admin Console");
    expect(markup).toContain("Admin navigation");
    expect(markup).toContain("/admin/users");
    expect(markup).toContain("/admin/projects");
    expect(markup).toContain('data-testid="admin-child-page"');
  });
});
