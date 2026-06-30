import { Router } from "express";

import {
  executeGetLocationInfoNode,
  type GetLocationInfoNodeAdapterDeps,
  isGetLocationInfoNodeType,
} from "./node-adapters/get-location-info-node-adapter.js";

export interface GetLocationInfoRouterDeps extends GetLocationInfoNodeAdapterDeps {}

export function createGetLocationInfoRouter(
  deps: GetLocationInfoRouterDeps = {},
): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isGetLocationInfoNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be get_location_info" });
    }

    try {
      const result = await executeGetLocationInfoNode({
        nodeType,
        input: req.body?.input,
      }, deps);
      return res.status(200).json(result);
    } catch (error: any) {
      const message = error?.message || "Get location info node execution failed.";
      return res.status(500).json({ error: message });
    }
  });

  return router;
}

const router = createGetLocationInfoRouter();

export default router;
