import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { createOpenPageRouter } from "../routes/open-page.js";

async function withServer(
  deps: Parameters<typeof createOpenPageRouter>[0],
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/open-page", createOpenPageRouter(deps));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function makeDeps(overrides?: {
  deny?: boolean;
  withPermissionEngine?: boolean;
}) {
  return {
    ...(overrides?.withPermissionEngine
      ? {
          permissionEngine: {
            checkPermission: vi.fn(() => ({
              allowed: !overrides?.deny,
              reason: overrides?.deny ? "Permission denied" : undefined,
            })),
          },
        }
      : {}),
  };
}

describe("POST /api/open-page/nodes/execute", () => {
  it("returns 400 when nodeType is invalid", async () => {
    await withServer(makeDeps(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/open-page/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "llm",
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nodeType");
    });
  });

  it("returns completed target payload for a valid open_page request", async () => {
    await withServer(makeDeps(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/open-page/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "open_page",
          input: {
            pageId: "mission-detail",
            route: "/missions/:missionId",
            params: {
              missionId: "mission-9",
            },
            query: {
              tab: "artifacts",
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.output.target.href).toBe("/missions/mission-9?tab=artifacts");
    });
  });

  it("maps denied access to 403", async () => {
    await withServer(
      makeDeps({ deny: true, withPermissionEngine: true }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/open-page/nodes/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: "open_page",
            input: {
              pageId: "mission-detail",
              route: "/missions/:missionId",
              params: {
                missionId: "mission-9",
              },
              agentId: "agent-1",
              token: "token-1",
            },
          }),
        });

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.output.status).toBe("denied");
      },
    );
  });

  it("returns 400 when target definition is missing", async () => {
    await withServer(makeDeps(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/open-page/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "open_page",
          input: {
            query: {
              tab: "overview",
            },
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("pageId, route, or href");
    });
  });
});
