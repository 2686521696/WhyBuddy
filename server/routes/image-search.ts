import { Router } from "express";

import {
  executeImageSearchNode,
  isImageSearchNodeType,
  type ImageSearchNodeAdapterDeps,
} from "./node-adapters/image-search-node-adapter.js";

export interface ImageSearchRouterDeps extends ImageSearchNodeAdapterDeps {}

export function createImageSearchRouter(
  deps: ImageSearchRouterDeps = {},
): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isImageSearchNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be image_search" });
    }

    try {
      const result = await executeImageSearchNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );

      return res.status(200).json(result);
    } catch (error: any) {
      const message = error?.message || "Image search node execution failed.";
      const status =
        /requires query, tags, or referenceimage description/i.test(message)
          ? 400
          : 500;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}

export default createImageSearchRouter;
