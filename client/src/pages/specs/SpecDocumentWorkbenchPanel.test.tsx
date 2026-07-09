import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SpecDocumentWorkbenchPanel from "./SpecDocumentWorkbenchPanel";

describe("SpecDocumentWorkbenchPanel", () => {
  it("renders node selection, document actions, and markdown preview", () => {
    const markup = renderToStaticMarkup(
      <SpecDocumentWorkbenchPanel
        jobId="job-1"
        specTree={{
          id: "spec-tree-1",
          routeSetId: "route-set-1",
          selectionId: "selection-1",
          selectedRouteId: "route-primary",
          rootNodeId: "node-root",
          version: 1,
          status: "draft",
          createdAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
          alternativeRouteIds: [],
          provenance: {
            jobId: "job-1",
            githubUrls: ["https://github.com/example/repo"],
          },
          nodes: [
            {
              id: "node-root",
              title: "SPEC tree root",
              summary: "Root node for the workbench.",
              type: "root",
              status: "draft",
              priority: 0,
              dependencies: [],
              outputs: ["spec-tree"],
              children: ["node-docs"],
            },
            {
              id: "node-docs",
              parentId: "node-root",
              title: "Specification document generation",
              summary: "Generate requirements, design, and tasks.",
              type: "spec_document",
              status: "seed",
              priority: 1,
              dependencies: [],
              outputs: ["requirements.md", "design.md", "tasks.md"],
              children: [],
            },
          ],
        }}
        initialDocuments={[
          {
            id: "doc-req",
            jobId: "job-1",
            treeId: "spec-tree-1",
            nodeId: "node-docs",
            type: "requirements",
            status: "reviewing",
            version: 1,
            sourceDocumentId: "doc-source-req",
            title: "Requirements",
            summary: "Requirements summary.",
            content: "# Requirements\n\n- Capture user roles.",
            format: "markdown",
            createdAt: "2026-05-06T00:00:00.000Z",
            updatedAt: "2026-05-06T00:00:00.000Z",
            provenance: {
              jobId: "job-1",
              projectId: "project-1",
              githubUrls: ["https://github.com/example/repo"],
              treeVersion: 1,
              nodeType: "spec_document",
              nodeTitle: "Specification document generation",
              nodeSummary: "Generate requirements, design, and tasks.",
              dependencies: [],
              outputs: ["requirements.md", "design.md", "tasks.md"],
            },
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="spec-document-workbench"');
    expect(markup).toContain("规格文档工作台");
    expect(markup).toContain('data-testid="spec-document-node-button"');
    expect(markup).toContain("规格文档生成");
    expect(markup).toContain('data-testid="spec-document-generate-button"');
    expect(markup).toContain("生成全部文档");
    expect(markup).toContain('data-testid="spec-document-review-status"');
    expect(markup).toContain("评审中");
    expect(markup).toContain('data-testid="spec-document-accept-button"');
    expect(markup).toContain("接受");
    expect(markup).toContain('data-testid="spec-document-reject-button"');
    expect(markup).toContain("拒绝");
    expect(markup).toContain(
      'data-testid="spec-document-save-version-button"'
    );
    expect(markup).toContain("保存版本");
    expect(markup).toContain('data-testid="spec-document-preview"');
    expect(markup).toContain("捕获用户角色。");
    expect(markup).toContain("requirements.md");
    expect(markup).toContain("design.md");
    expect(markup).toContain("tasks.md");
  });

  it("generates documents for the whole SPEC tree from the workbench action", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "SpecDocumentWorkbenchPanel.tsx"),
      "utf8"
    );

    const generateRequest = source.match(
      /generateBlueprintSpecDocuments\(\s*jobId\s*,\s*\{([\s\S]*?)\}\s*\)/
    );

    expect(generateRequest).not.toBeNull();
    expect(generateRequest![1]).toMatch(/types\s*:/);
    expect(generateRequest![1]).not.toMatch(/\bnodeId\s*:/);
  });
});
