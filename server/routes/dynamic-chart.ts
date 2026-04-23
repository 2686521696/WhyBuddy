import { Router } from "express";

import {
  DynamicChartNodeError,
  executeDynamicChartNode,
  isDynamicChartNodeType,
} from "./node-adapters/dynamic-chart-node-adapter.js";

export function createDynamicChartRouter(): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isDynamicChartNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be dynamic_chart" });
    }

    try {
      const result = await executeDynamicChartNode({
        nodeType,
        input: req.body?.input,
      });

      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof DynamicChartNodeError) {
        return res.status(error.status).json({ error: error.message });
      }

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Dynamic chart node execution failed.",
      });
    }
  });

  return router;
}

const router = createDynamicChartRouter();

export default router;
