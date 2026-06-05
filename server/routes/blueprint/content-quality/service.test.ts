/**
 * `blueprint-content-quality-check` spec Task 6.1：单元测试。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkDocumentSubstance, checkEarsCompliance } from "./validator.js";
import { containsEarsKeyword, extractAcceptanceCriteria } from "./ears-patterns.js";
import { createContentQualityService } from "./service.js";
import type { BlueprintServiceContext } from "../context.js";
import type { BlueprintGenerationJob } from "../../../../shared/blueprint/contracts.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockCtx(enabled = true): BlueprintServiceContext {
  if (enabled) {
    vi.stubEnv("BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED", "true");
    vi.stubEnv("BLUEPRINT_CHECKS_LEDGER_ENABLED", "true");
  } else {
    vi.stubEnv("BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED", "false");
  }

  const job: BlueprintGenerationJob = {
    id: "job-test-1234",
    request: { targetText: "test" } as any,
    status: "running" as any,
    stage: "spec_docs" as any,
    version: "1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    artifacts: [],
    events: [],
    checksLedger: [],
  };

  return {
    now: () => new Date("2026-05-28T12:00:00Z"),
    jobStore: {
      get: () => job,
      save: vi.fn(),
      list: () => [job],
      latest: () => null,
    },
    eventBus: { emit: vi.fn(), subscribe: vi.fn(() => () => {}) },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    checksLedger: {
      recordCheck: vi.fn((input) => ({ ...input, id: "chk-test", triggeredAt: "2026-01-01T00:00:00Z" })),
      getChecks: vi.fn(),
      isGatePassed: vi.fn(),
      renderMarkdown: vi.fn(),
    },
  } as unknown as BlueprintServiceContext;
}

// ─── EARS patterns ──────────────────────────────────────────────────────────

describe("containsEarsKeyword", () => {
  it("detects WHEN", () => expect(containsEarsKeyword("WHEN the user logs in")).toBe(true));
  it("detects SHALL", () => expect(containsEarsKeyword("the system shall respond")).toBe(true));
  it("rejects no keywords", () => expect(containsEarsKeyword("do something now")).toBe(false));
  it("case insensitive", () => expect(containsEarsKeyword("While loading")).toBe(true));
});

describe("extractAcceptanceCriteria", () => {
  it("extracts numbered items", () => {
    const md = `#### Acceptance Criteria\n\n1. WHEN user clicks, THE system SHALL respond\n2. IF error occurs, THEN show message\n`;
    const criteria = extractAcceptanceCriteria(md);
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toContain("WHEN user clicks");
  });

  it("extracts from Chinese heading", () => {
    const md = `#### 验收标准\n\n1. WHEN 用户点击时\n2. THE 系统 SHALL 响应\n`;
    const criteria = extractAcceptanceCriteria(md);
    expect(criteria).toHaveLength(2);
  });

  it("returns empty for missing section", () => {
    const md = `# Title\n\nSome content without acceptance criteria.\n`;
    expect(extractAcceptanceCriteria(md)).toHaveLength(0);
  });
});

// ─── checkDocumentSubstance ─────────────────────────────────────────────────

describe("checkDocumentSubstance", () => {
  beforeEach(() => vi.unstubAllEnvs());

  it("fails on empty document", () => {
    const result = checkDocumentSubstance("# Title\n\nshort", "requirements");
    expect(result.status).toBe("fail");
    expect(result.output).toContain("document body too short");
  });

  it("warns on missing sub-headings", () => {
    const content = "# Title\n\n" + "This is a long paragraph of prose content that should be more than fifty characters in length to count as prose. ".repeat(3);
    const result = checkDocumentSubstance(content, "requirements");
    expect(result.status).toBe("warn");
    expect(result.output).toContain("missing section headings");
  });

  it("fails on tasks without checkboxes", () => {
    const content = "# Tasks\n\n## Section\n\n" + "This is enough content to pass the minimum threshold check. ".repeat(3);
    const result = checkDocumentSubstance(content, "tasks");
    expect(result.status).toBe("fail");
    expect(result.output).toContain("no task checkboxes found");
  });

  it("passes on valid document", () => {
    const content = "# Title\n\n## Section 1\n\n" +
      "This is a substantial paragraph with enough content to be meaningful and pass all the checks we have. ".repeat(3) +
      "\n\n- [ ] Task item\n";
    const result = checkDocumentSubstance(content, "tasks");
    expect(result.status).toBe("pass");
  });
});

// ─── checkEarsCompliance ────────────────────────────────────────────────────

describe("checkEarsCompliance", () => {
  it("passes when all criteria contain EARS keywords", () => {
    const content = `#### Acceptance Criteria\n\n1. WHEN user submits, THE system SHALL validate\n2. IF error occurs, THEN display message\n`;
    const result = checkEarsCompliance(content);
    expect(result.status).toBe("pass");
  });

  it("fails when > 50% lack keywords", () => {
    const content = `#### Acceptance Criteria\n\n1. Do something now\n2. Open a menu here\n3. WHEN user submits, SHALL validate\n`;
    const result = checkEarsCompliance(content);
    expect(result.status).toBe("fail");
  });

  it("skips when no acceptance criteria section", () => {
    const content = `# Requirements\n\nSome general content.\n`;
    const result = checkEarsCompliance(content);
    expect(result.status).toBe("skip");
  });

  it("warns when some but ≤ 50% lack keywords", () => {
    const content = `#### Acceptance Criteria\n\n1. WHEN user submits, THE system SHALL validate\n2. WHILE loading, THE indicator SHALL show\n3. Do something with no keywords at all\n`;
    const result = checkEarsCompliance(content);
    expect(result.status).toBe("warn");
  });
});

// ─── ContentQualityService ──────────────────────────────────────────────────

describe("ContentQualityService", () => {
  beforeEach(() => vi.unstubAllEnvs());

  it("validates batch with fail → overallStatus fail", () => {
    const ctx = createMockCtx(true);
    const service = createContentQualityService(ctx);

    const result = service.validateDocuments({
      jobId: "job-test-1234",
      documents: [
        { id: "doc-1", type: "requirements", body: "# Short\n\ntoo short" } as any,
      ],
    });

    expect(result.overallStatus).toBe("fail");
  });

  it("returns skip when env disabled", () => {
    const ctx = createMockCtx(false);
    const service = createContentQualityService(ctx);

    const result = service.validateDocuments({
      jobId: "job-test-1234",
      documents: [{ id: "doc-1", type: "requirements", body: "x" } as any],
    });

    expect(result.overallStatus).toBe("skip");
    expect(ctx.checksLedger!.recordCheck).not.toHaveBeenCalled();
  });

  it("does not throw on parse error (non-blocking)", () => {
    const ctx = createMockCtx(true);
    const service = createContentQualityService(ctx);

    // Pass null content to trigger potential error
    const result = service.validateDocuments({
      jobId: "job-test-1234",
      documents: [{ id: "doc-1", type: "requirements", body: null } as any],
    });

    // Should not throw, returns warn
    expect(["warn", "fail"]).toContain(result.overallStatus);
  });
});
