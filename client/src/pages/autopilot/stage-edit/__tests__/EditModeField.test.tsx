import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  deriveEditErrorMessage,
  EditModeField,
  editModeReducer,
  getEditModeFieldKeyIntent,
  initialEditModeState,
} from "../EditModeField";

describe("<EditModeField>", () => {
  it("renders the edit affordance with Pencil icon when editing is allowed", () => {
    const markup = renderToStaticMarkup(
      <EditModeField
        canEdit
        fieldKey="target"
        impactSummary={{ downstreamCount: 2 }}
        label="Target"
        onSubmit={vi.fn()}
        value="Build the route"
      />
    );

    expect(markup).toContain('data-testid="autopilot-edit-target"');
    expect(markup).toContain('aria-label="Edit Target"');
    expect(markup).toContain("lucide-pencil");
  });

  it("hides the edit affordance and marks preview disabled when editing is not allowed", () => {
    const markup = renderToStaticMarkup(
      <EditModeField
        canEdit={false}
        fieldKey="target"
        impactSummary={{ downstreamCount: 0 }}
        label="Target"
        onSubmit={vi.fn()}
        value="Static preview"
      />
    );

    expect(markup).not.toContain('data-testid="autopilot-edit-target"');
    expect(markup).toContain('aria-disabled="true"');
  });

  it("gates edit affordance to completed upstream stages outside static preview and active advancement", () => {
    const render = (props: Partial<Parameters<typeof EditModeField>[0]>) =>
      renderToStaticMarkup(
        <EditModeField
          canEdit
          fieldKey="target"
          fromStage="input"
          impactSummary={{ downstreamCount: 0 }}
          isAdvancingThroughStage={false}
          isStaticPreview={false}
          isViewingCompletedStage
          label="Target"
          onSubmit={vi.fn()}
          value="Target"
          {...props}
        />
      );

    expect(render({})).toContain('data-testid="autopilot-edit-target"');
    expect(render({ fromStage: "spec_tree" })).not.toContain(
      'data-testid="autopilot-edit-target"'
    );
    expect(render({ isViewingCompletedStage: false })).not.toContain(
      'data-testid="autopilot-edit-target"'
    );
    expect(render({ isAdvancingThroughStage: true })).not.toContain(
      'data-testid="autopilot-edit-target"'
    );
    expect(render({ isStaticPreview: true })).not.toContain(
      'data-testid="autopilot-edit-target"'
    );
  });

  it("keeps draft changes in editing state and restores the original value on cancel", () => {
    const editing = editModeReducer(initialEditModeState("Original"), {
      type: "startEditing",
    });
    const changed = editModeReducer(editing, {
      type: "changeDraft",
      value: "Draft",
    });
    const canceled = editModeReducer(changed, { type: "cancel" });

    expect(changed).toMatchObject({ mode: "editing", draftValue: "Draft" });
    expect(canceled).toEqual(initialEditModeState("Original"));
  });

  it("captures textarea changes before React clears the event currentTarget", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../EditModeField.tsx"),
      "utf8"
    );

    const handlerStart = source.indexOf("const handleDraftChange");
    const textareaStart = source.indexOf("<textarea");
    const handlerSource = source.slice(handlerStart, textareaStart);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerSource).toContain("const value = event.currentTarget.value");
    expect(handlerSource).toContain("value,");
    expect(handlerSource).not.toContain("event.currentTarget.value,");
  });

  it("exits editing with the submitted value after save succeeds", () => {
    const editing = editModeReducer(initialEditModeState("Original"), {
      type: "startEditing",
    });
    const changed = editModeReducer(editing, {
      type: "changeDraft",
      value: "Saved",
    });
    const submitting = editModeReducer(changed, { type: "submit" });
    const success = editModeReducer(submitting, {
      type: "submitSuccess",
      value: "Saved",
    });

    expect(submitting).toMatchObject({
      mode: "submitting",
      draftValue: "Saved",
    });
    expect(success).toEqual(initialEditModeState("Saved"));
  });

  it("returns to editing with an error message when save fails", () => {
    const submitting = editModeReducer(
      editModeReducer(initialEditModeState("Original"), {
        type: "startEditing",
      }),
      { type: "submit" }
    );
    const failed = editModeReducer(submitting, {
      type: "submitError",
      message: "spec_tree is still running. Please wait for completion.",
    });

    expect(failed).toMatchObject({
      mode: "error",
      draftValue: "Original",
      errorMessage: "spec_tree is still running. Please wait for completion.",
    });
  });

  it("leaves submitting state after 4xx and 5xx save failures so actions can be retried", () => {
    const submitting = editModeReducer(
      editModeReducer(initialEditModeState("Original"), {
        type: "startEditing",
      }),
      { type: "submit" }
    );

    const clientFailure = editModeReducer(submitting, {
      type: "submitError",
      message: deriveEditErrorMessage({
        status: 400,
        message: "targetText must be a string.",
      }),
    });
    const serverFailure = editModeReducer(submitting, {
      type: "submitError",
      message: deriveEditErrorMessage({
        status: 500,
        message: "Could not save intake.",
      }),
    });

    expect(clientFailure).toMatchObject({
      mode: "error",
      errorMessage: "targetText must be a string.",
    });
    expect(serverFailure).toMatchObject({
      mode: "error",
      errorMessage: "Could not save intake.",
    });
  });

  it("shows downstream_running 409 failures as a wait-for-stage message", () => {
    expect(
      deriveEditErrorMessage({
        code: "downstream_running",
        status: 409,
        runningStage: "spec_docs",
      })
    ).toBe("spec_docs is still running. Please wait for completion.");
  });

  it("maps field keyboard shortcuts to submit, cancel, or text editing", () => {
    expect(getEditModeFieldKeyIntent({ key: "Enter", shiftKey: false })).toBe(
      "submit"
    );
    expect(getEditModeFieldKeyIntent({ key: "Escape", shiftKey: false })).toBe(
      "cancel"
    );
    expect(getEditModeFieldKeyIntent({ key: "Enter", shiftKey: true })).toBe(
      "none"
    );
    expect(getEditModeFieldKeyIntent({ key: "a", shiftKey: false })).toBe(
      "none"
    );
  });
});
