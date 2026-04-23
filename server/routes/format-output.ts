import { Router } from "express";

import {
  executeFormatOutputNode,
  isFormatOutputNodeType,
} from "./node-adapters/format-output-node-adapter.js";

export function createFormatOutputRouter(): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isFormatOutputNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be format_output" });
    }

    try {
      const result = await executeFormatOutputNode({
        nodeType,
        input: req.body?.input,
      });

      return res.status(200).json(result);
    } catch (error: any) {
      const message =
        error?.message || "Format output node execution failed.";
      const status =
        /unsupported format_output format/i.test(message) ? 400 : 500;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}

const router = createFormatOutputRouter();

export default router;
