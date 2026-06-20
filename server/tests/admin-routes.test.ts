import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "../../shared/auth.js";
import { createAdminRouter, type AdminRouterDeps } from "../routes/admin.js";

type UserFixture = Awaited<ReturnType<AdminRouterDeps["users"]["list"]>>[number];
type ProjectFixture = Awaited<ReturnType<AdminRouterDeps["projects"]["list"]>>[number];

const now = new Date("2026-05-02T00:00:00.000Z");

const adminUser: CurrentUser = {
  id: "admin-1",
  email: "admin@example.com",
  role: "admin",
  status: "active",
  emailVerified: true,
  createdAt: now.toISOString(),
};

const regularUser: CurrentUser = {
  ...adminUser,
  id: "user-1",
  email: "user@example.com",
  role: "user",
};

const users: UserFixture[] = [
  {
    id: "user-1",
    email: "user@example.com",
    emailNormalized: "user@example.com",
    passwordHash: "hash-should-not-leak",
    displayName: "User One",
    avatarUrl: null,
    role: "user",
    status: "active",
    emailVerifiedAt: now,
    lastLoginAt: null,
    lastLoginIp: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "admin-1",
    email: "admin@example.com",
    emailNormalized: "admin@example.com",
    passwordHash: "admin-hash-should-not-leak",
    displayName: "Admin One",
    avatarUrl: null,
    role: "admin",
    status: "active",
    emailVerifiedAt: now,
    lastLoginAt: now,
    lastLoginIp: "127.0.0.1",
    createdAt: now,
    updatedAt: now,
  },
];

const projects: ProjectFixture[] = [
  {
    id: "project-owned-by-other-user",
    ownerUserId: "user-2",
    name: "Other User Project",
    description: null,
    status: "active",
    source: "user",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
  {
    id: "project-owned-by-admin",
    ownerUserId: "admin-1",
    name: "Admin Project",
    description: "Visible through admin reader",
    status: "active",
    source: "demo",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  },
];

function createDeps(currentUser: CurrentUser): AdminRouterDeps {
  const requireAuth: RequestHandler = (request, _response, next) => {
    (request as typeof request & { user: CurrentUser; sessionId: string }).user = currentUser;
    (request as typeof request & { user: CurrentUser; sessionId: string }).sessionId = "session-1";
    next();
  };

  const requireAdmin: RequestHandler = (request, response, next) => {
    const user = (request as typeof request & { user?: CurrentUser }).user;
    if (user?.role !== "admin" && user?.role !== "super_admin") {
      response.status(403).json({ success: false, error: "Admin privileges required" });
      return;
    }
    next();
  };

  return {
    requireAuth,
    requireAdmin,
    users: {
      list: vi.fn(async () => users),
      findById: vi.fn(async userId => users.find(user => user.id === userId) ?? null),
    },
    projects: {
      list: vi.fn(async () => projects),
      findById: vi.fn(async projectId => projects.find(project => project.id === projectId) ?? null),
    },
  };
}

async function withServer(
  deps: AdminRouterDeps,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminRouter(deps));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe("admin routes", () => {
  it("returns 403 for regular users", async () => {
    const deps = createDeps(regularUser);

    await withServer(deps, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/summary`);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        success: false,
        error: "Admin privileges required",
      });
      expect(deps.users.list).not.toHaveBeenCalled();
      expect(deps.projects.list).not.toHaveBeenCalled();
    });
  });

  it("returns summary for admins", async () => {
    await withServer(createDeps(adminUser), async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/summary`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        success: true,
        summary: {
          users: 2,
          projects: 2,
          runs: 0,
          failures: 0,
          audit: 0,
        },
      });
    });
  });

  it("does not expose password hashes in user responses", async () => {
    await withServer(createDeps(adminUser), async baseUrl => {
      const listResponse = await fetch(`${baseUrl}/api/admin/users`);
      const listBody = await listResponse.json();

      expect(listResponse.status).toBe(200);
      expect(JSON.stringify(listBody)).not.toContain("passwordHash");
      expect(JSON.stringify(listBody)).not.toContain("hash-should-not-leak");
      expect(listBody.items).toHaveLength(2);

      const detailResponse = await fetch(`${baseUrl}/api/admin/users/user-1`);
      const detailBody = await detailResponse.json();

      expect(detailResponse.status).toBe(200);
      expect(JSON.stringify(detailBody)).not.toContain("passwordHash");
      expect(JSON.stringify(detailBody)).not.toContain("hash-should-not-leak");
      expect(detailBody.user.id).toBe("user-1");
    });
  });

  it("uses the admin projects reader instead of an owner-scoped list", async () => {
    const deps = createDeps(adminUser);

    await withServer(deps, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/projects`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(deps.projects.list).toHaveBeenCalledOnce();
      expect(body.items.map((project: ProjectFixture) => project.id)).toEqual([
        "project-owned-by-other-user",
        "project-owned-by-admin",
      ]);
    });
  });

  it("returns sanitized error contract when an admin reader fails", async () => {
    const deps = createDeps(adminUser);
    deps.users.list = vi.fn(async () => {
      throw new Error("database passwordHash query failed");
    });

    await withServer(deps, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/admin/users`);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        success: false,
        error: "Admin route failed",
      });
      expect(JSON.stringify(body)).not.toContain("passwordHash");
      expect(JSON.stringify(body)).not.toContain("database");
    });
  });
});
