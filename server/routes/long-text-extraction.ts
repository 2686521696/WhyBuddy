import { Router } from "express";

import {
  executeLongTextExtractionNode,
  isLongTextExtractionNodeType,
} from "./node-adapters/long-text-extraction-node-adapter.js";

export function createLongTextExtractionRouter(): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isLongTextExtractionNodeType(nodeType)) {
      return res
        .status(400)
        .json({ error: "nodeType must be long_text_extraction" });
    }

    try {
      const result = await executeLongTextExtractionNode({
        nodeType,
        input: req.body?.input,
      });

      return res.status(200).json(result);
    } catch (error: any) {
      const message =
        error?.message || "Long text extraction node execution failed.";
      const status = /requires text/i.test(message) ? 400 : 500;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}

const router = createLongTextExtractionRouter();

export default router;
