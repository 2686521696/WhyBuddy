import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { Router } from "express";

import { getMimeType } from "./artifact-utils.js";
import {
  executeFileGenerationNode,
  isFileGenerationNodeType,
  readFileGenerationPreview,
  resolveFileGenerationOutputAbsolutePath,
  validateFileGenerationSegment,
  type FileGenerationNodeAdapterDeps,
} from "./node-adapters/file-generation-node-adapter.js";

export interface FileGenerationRouterDeps extends FileGenerationNodeAdapterDeps {}

export function createFileGenerationRouter(
  deps: FileGenerationRouterDeps = {},
): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isFileGenerationNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be file_generation" });
    }

    try {
      const result = await executeFileGenerationNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );

      return res.status(200).json(result);
    } catch (error: any) {
      const status =
        typeof error?.status === "number"
          ? error.status
          : /requires content or structuredcontent/i.test(error?.message || "")
            ? 400
            : 500;
      return res.status(status).json({
        error: error?.message || "File generation node execution failed.",
      });
    }
  });

  router.get("/outputs/:outputId/:filename", async (req, res) => {
    const { outputId, filename } = req.params;
    if (!validateFileGenerationSegment(outputId) || !validateFileGenerationSegment(filename)) {
      return res.status(403).json({ error: "Invalid output path" });
    }

    const absolutePath = resolveFileGenerationOutputAbsolutePath(outputId, filename);
    try {
      await access(absolutePath, fsConstants.R_OK);
    } catch {
      return res.status(404).json({ error: "Output artifact not found" });
    }

    res.setHeader("Content-Type", getMimeType(path.basename(filename)));
    if (req.query.download === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filename)}"`);
    }
    return res.sendFile(absolutePath);
  });

  router.get("/outputs/:outputId/:filename/preview", async (req, res) => {
    const { outputId, filename } = req.params;
    if (!validateFileGenerationSegment(outputId) || !validateFileGenerationSegment(filename)) {
      return res.status(403).json({ error: "Invalid output path" });
    }

    const absolutePath = resolveFileGenerationOutputAbsolutePath(outputId, filename);
    try {
      await access(absolutePath, fsConstants.R_OK);
    } catch {
      return res.status(404).json({ error: "Output artifact not found" });
    }

    try {
      const preview = await (deps.readArtifactPreview ?? readFileGenerationPreview)(absolutePath);
      res.setHeader("Content-Type", preview.contentType);
      res.setHeader("X-Truncated", preview.truncated ? "true" : "false");
      return res.status(200).send(preview.inlineText);
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({
        error: error?.message || "File generation preview failed.",
      });
    }
  });

  return router;
}

export default createFileGenerationRouter;
