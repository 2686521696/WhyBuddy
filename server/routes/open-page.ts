import { Router } from "express";

import {
  executeOpenPageNode,
  isOpenPageNodeType,
  type OpenPageNodeAdapterDeps,
} from "./node-adapters/open-page-node-adapter.js";

export interface OpenPageRouterDeps extends OpenPageNodeAdapterDeps {}

function mapStatusToHttpStatus(status: string | undefined): number {
  if (status === "denied") {
    return 403;
  }
  return 200;
}

export function createOpenPageRouter(
  deps: OpenPageRouterDeps = {},
): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isOpenPageNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be open_page" });
    }

    try {
      const result = await executeOpenPageNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );

      return res.status(mapStatusToHttpStatus(result.output.status)).json(result);
    } catch (error: any) {
      const message = error?.message || "Open page node execution failed.";
      const status =
        /requires pageId/i.test(message) ||
        /requires route/i.test(message) ||
        /requires href/i.test(message) ||
        /requires agentId/i.test(message) ||
        /requires token/i.test(message)
          ? 400
          : 500;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}

const router = createOpenPageRouter();

export default router;
