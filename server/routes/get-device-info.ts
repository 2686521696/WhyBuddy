import { Router } from "express";

import {
  executeGetDeviceInfoNode,
  type GetDeviceInfoNodeAdapterDeps,
  isGetDeviceInfoNodeType,
} from "./node-adapters/get-device-info-node-adapter.js";

export interface GetDeviceInfoRouterDeps extends GetDeviceInfoNodeAdapterDeps {}

export function createGetDeviceInfoRouter(
  deps: GetDeviceInfoRouterDeps = {},
): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isGetDeviceInfoNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be get_device_info" });
    }

    const input = {
      ...(req.body?.input && typeof req.body.input === "object"
        ? req.body.input
        : {}),
      clientHints: {
        ...(req.body?.input?.clientHints && typeof req.body.input.clientHints === "object"
          ? req.body.input.clientHints
          : {}),
        ...(typeof req.header("user-agent") === "string"
          ? { userAgent: req.body?.input?.clientHints?.userAgent ?? req.header("user-agent") }
          : {}),
        ...(typeof req.header("x-client-platform") === "string"
          ? { platform: req.body?.input?.clientHints?.platform ?? req.header("x-client-platform") }
          : {}),
        ...(typeof req.header("x-client-locale") === "string"
          ? { locale: req.body?.input?.clientHints?.locale ?? req.header("x-client-locale") }
          : {}),
        ...(typeof req.header("x-client-timezone") === "string"
          ? { timezone: req.body?.input?.clientHints?.timezone ?? req.header("x-client-timezone") }
          : {}),
      },
    };

    try {
      const result = await executeGetDeviceInfoNode(
        {
          nodeType,
          input,
        },
        deps,
      );
      return res.status(200).json(result);
    } catch (error: any) {
      const message = error?.message || "Get device info node execution failed.";
      return res.status(500).json({ error: message });
    }
  });

  return router;
}

const router = createGetDeviceInfoRouter();

export default router;
