import { Router } from "express";

import {
  executeRobotReplyNode,
  isRobotReplyNodeType,
  type RobotReplyNodeAdapterDeps,
} from "./node-adapters/robot-reply-node-adapter.js";

export interface RobotReplyRouterDeps extends RobotReplyNodeAdapterDeps {}

export function createRobotReplyRouter(deps: RobotReplyRouterDeps = {}): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;

    if (!isRobotReplyNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be robot_reply" });
    }

    try {
      const result = await executeRobotReplyNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );
      return res.json(result);
    } catch (error: any) {
      const message = error?.message || "Robot reply node execution failed.";
      const status =
        /requires content|requires reply\.content|requires .*upstream output content/i.test(
          message,
        )
          ? 400
          : 500;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}

const router = createRobotReplyRouter();

export default router;
