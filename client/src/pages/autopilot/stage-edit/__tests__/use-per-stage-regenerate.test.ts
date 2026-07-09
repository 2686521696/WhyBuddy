import { beforeEach, describe, expect, it, vi } from "vitest";

import { postBlueprintReplan } from "../../../../lib/blueprint-api/replan";
import { selectBlueprintRoute } from "../../../../lib/blueprint-api/routeset";
import { generateBlueprintSpecDocuments } from "../../../../lib/blueprint-api/spec-documents";
import { generateBlueprintEffectPreview } from "../../../../lib/blueprint-api/downstream";
import {
  createPerStageRegenerateController,
  runPerStageRegenerate,
} from "../use-per-stage-regenerate";

vi.mock("../../../../lib/blueprint-api/replan", () => ({
  postBlueprintReplan: vi.fn(),
}));

vi.mock("../../../../lib/blueprint-api/routeset", () => ({
  selectBlueprintRoute: vi.fn(),
}));

vi.mock("../../../../lib/blueprint-api/spec-documents", () => ({
  generateBlueprintSpecDocuments: vi.fn(),
}));

vi.mock("../../../../lib/blueprint-api/downstream", () => ({
  generateBlueprintEffectPreview: vi.fn(),
}));

const mockedPostBlueprintReplan = vi.mocked(postBlueprintReplan);
const mockedSelectBlueprintRoute = vi.mocked(selectBlueprintRoute);
const mockedGenerateBlueprintSpecDocuments = vi.mocked(
  generateBlueprintSpecDocuments
);
const mockedGenerateBlueprintEffectPreview = vi.mocked(
  generateBlueprintEffectPreview
);

describe("use-per-stage-regenerate utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSelectBlueprintRoute.mockResolvedValue({ ok: true, data: {} as any });
    mockedGenerateBlueprintSpecDocuments.mockResolvedValue({
      ok: true,
      data: {} as any,
    });
    mockedGenerateBlueprintEffectPreview.mockResolvedValue({
      ok: true,
      data: {} as any,
    });
  });

  it("calls route-selection for route_generation and never posts spec2 replan", async () => {
    await runPerStageRegenerate({
      jobId: "job-1",
      stage: "route_generation",
      routeId: "route-a",
      reason: "try another route",
    });

    expect(mockedSelectBlueprintRoute).toHaveBeenCalledWith("job-1", {
      routeId: "route-a",
      reason: "try another route",
    });
    expect(mockedPostBlueprintReplan).not.toHaveBeenCalled();
  });

  it("calls spec-documents for spec_documents", async () => {
    await runPerStageRegenerate({
      jobId: "job-1",
      stage: "spec_documents",
      nodeId: "node-a",
    });

    expect(mockedGenerateBlueprintSpecDocuments).toHaveBeenCalledWith("job-1", {
      nodeId: "node-a",
    });
    expect(mockedPostBlueprintReplan).not.toHaveBeenCalled();
  });

  it("calls effect-previews for effect_preview", async () => {
    await runPerStageRegenerate({
      jobId: "job-1",
      stage: "effect_preview",
      nodeId: "node-a",
    });

    expect(mockedGenerateBlueprintEffectPreview).toHaveBeenCalledWith("job-1", {
      nodeId: "node-a",
    });
    expect(mockedPostBlueprintReplan).not.toHaveBeenCalled();
  });

  it("skips disabled and in-flight duplicate triggers", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    mockedGenerateBlueprintSpecDocuments.mockReturnValueOnce(
      new Promise(resolve => {
        resolveFirst = resolve;
      }) as any
    );
    const controller = createPerStageRegenerateController();

    const disabled = await controller.trigger({
      disabled: true,
      jobId: "job-1",
      stage: "spec_documents",
    });
    const first = controller.trigger({
      jobId: "job-1",
      stage: "spec_documents",
    });
    const duplicate = await controller.trigger({
      jobId: "job-1",
      stage: "spec_documents",
    });

    resolveFirst({ ok: true, data: {} });
    await first;

    expect(disabled).toEqual({ skipped: true, reason: "disabled" });
    expect(duplicate).toEqual({ skipped: true, reason: "in_flight" });
    expect(mockedGenerateBlueprintSpecDocuments).toHaveBeenCalledTimes(1);
    expect(mockedPostBlueprintReplan).not.toHaveBeenCalled();
  });
});
