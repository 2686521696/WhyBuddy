import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open = true,
  }: {
    children: ReactNode;
    open?: boolean;
  }) => (open ? <div data-slot="dialog">{children}</div> : null),
  DialogContent: ({
    children,
    showCloseButton: _showCloseButton,
    ...props
  }: {
    children: ReactNode;
    showCloseButton?: boolean;
    [key: string]: unknown;
  }) => (
    <div data-slot="dialog-content" {...props}>
      {children}
    </div>
  ),
  DialogDescription: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <p {...props}>{children}</p>,
  DialogFooter: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <div {...props}>{children}</div>,
  DialogHeader: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <div {...props}>{children}</div>,
  DialogTitle: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <h2 {...props}>{children}</h2>,
}));

import {
  ReplanConfirmationModal,
  deriveReplanConfirmationState,
  type ReplanConfirmationModalProps,
} from "../ReplanConfirmationModal";

function makeProps(
  overrides: Partial<ReplanConfirmationModalProps> = {}
): ReplanConfirmationModalProps {
  return {
    open: true,
    mode: "in_place",
    reason: "",
    loading: false,
    impact: {
      artifactIds: ["a1", "a2"],
      artifactCount: 2,
      stages: ["spec_docs", "effect_preview"],
    },
    onModeChange: () => {},
    onReasonChange: () => {},
    onConfirm: () => {},
    onCancel: () => {},
    onClearError: () => {},
    ...overrides,
  };
}

function findElementByTestId(
  node: ReactNode,
  testId: string
): ReactElement | null {
  if (
    node === null ||
    node === undefined ||
    node === false ||
    node === true ||
    typeof node === "string" ||
    typeof node === "number"
  ) {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByTestId(child, testId);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement;
  const props = element.props as { [key: string]: unknown } | undefined;
  if (props?.["data-testid"] === testId) return element;
  return props && "children" in props
    ? findElementByTestId(props.children as ReactNode, testId)
    : null;
}

function invokeModal(props: ReplanConfirmationModalProps): ReactElement | null {
  return (
    ReplanConfirmationModal as unknown as (
      p: ReplanConfirmationModalProps
    ) => ReactElement | null
  )(props);
}

function renderModalMarkup(props: ReplanConfirmationModalProps): string {
  const modal = invokeModal(props);
  const dialog = findElementByTestId(
    modal,
    "autopilot-replan-confirmation-modal"
  );
  if (!dialog) return "";

  const {
    children,
    showCloseButton: _showCloseButton,
    onEscapeKeyDown: _onEscapeKeyDown,
    onPointerDownOutside: _onPointerDownOutside,
    ...attrs
  } = dialog.props as Record<string, unknown>;

  return renderToStaticMarkup(<div {...attrs}>{children as ReactNode}</div>);
}

describe("<ReplanConfirmationModal>", () => {
  it("uses the shared Radix Dialog shell with the required modal dimensions", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../ReplanConfirmationModal.tsx"),
      "utf8"
    );

    expect(source).toContain('from "@/components/ui/dialog"');
    expect(source).toContain("<Dialog");
    expect(source).toContain("<DialogContent");
    expect(source).toContain("min-w-[720px]");
    expect(source).toContain("max-w-[960px]");
    expect(source).toContain("max-h-[90vh]");
  });

  it("derives the explicit confirmation modal state machine states", () => {
    const base = makeProps();

    expect(deriveReplanConfirmationState({ ...base, open: false })).toEqual({
      kind: "idle",
    });
    expect(
      deriveReplanConfirmationState({ ...base, impactLoading: true })
    ).toEqual({ kind: "loading_impact" });
    expect(
      deriveReplanConfirmationState({
        ...base,
        impactError: "impact failed",
      })
    ).toEqual({ kind: "impact_failed", retryable: true });
    expect(
      deriveReplanConfirmationState({
        ...base,
        impact: { artifactIds: [], artifactCount: 0, stages: [] },
      })
    ).toEqual({ kind: "empty" });
    expect(deriveReplanConfirmationState(base)).toEqual({ kind: "ready" });
    expect(deriveReplanConfirmationState({ ...base, loading: true })).toEqual({
      kind: "in_flight",
    });
    expect(
      deriveReplanConfirmationState({ ...base, error: "request failed" })
    ).toEqual({ kind: "error" });
    expect(
      deriveReplanConfirmationState({
        ...base,
        storeSyncError: "store failed",
      })
    ).toEqual({ kind: "store_sync_failed" });
  });

  it("renders both replan modes, impact summary, reason input, confirm, and cancel controls", () => {
    const markup = renderModalMarkup(makeProps());

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain(
      'data-testid="autopilot-replan-confirmation-modal"'
    );
    expect(markup).toContain('data-testid="replan-modal-mode-in-place"');
    expect(markup).toContain('data-testid="replan-modal-mode-branch"');
    expect(markup).toContain('data-testid="replan-modal-reason"');
    expect(markup).toContain('data-testid="replan-modal-confirm"');
    expect(markup).toContain('data-testid="replan-modal-cancel"');
    expect(markup).toContain("原地标记过期");
    expect(markup).toContain("2 downstream artifacts");
    expect(markup).toContain("spec_docs");
    expect(markup).toContain("effect_preview");
    expect(markup).not.toContain("autopilot-edit-");
  });

  it("refreshes mode copy immediately and blocks confirm when reason is too long", () => {
    const branchMarkup = renderModalMarkup(
      makeProps({ mode: "branch", reason: "x".repeat(1001) })
    );

    expect(branchMarkup).toContain("新分支");
    expect(branchMarkup).toContain("1001 / 1000");
    expect(branchMarkup).toContain("reason 不能超过 1000 个字符");
    expect(branchMarkup).toMatch(
      /data-testid="replan-modal-confirm"[^>]*disabled=""/
    );
  });

  it("wires mode, reason, confirm, and cancel callbacks without depending on inline edit modal state", () => {
    const onModeChange = vi.fn();
    const onReasonChange = vi.fn();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const element = invokeModal(
      makeProps({ onModeChange, onReasonChange, onConfirm, onCancel })
    );

    const branch = findElementByTestId(element, "replan-modal-mode-branch");
    const reason = findElementByTestId(element, "replan-modal-reason");
    const confirm = findElementByTestId(element, "replan-modal-confirm");
    const cancel = findElementByTestId(element, "replan-modal-cancel");

    (branch!.props as { onClick: () => void }).onClick();
    (
      reason!.props as {
        onChange: (event: { currentTarget: { value: string } }) => void;
      }
    ).onChange({ currentTarget: { value: "Need fresher runtime docs" } });
    (confirm!.props as { onClick: () => void }).onClick();
    (cancel!.props as { onClick: () => void }).onClick();

    expect(onModeChange).toHaveBeenCalledWith("branch");
    expect(onReasonChange).toHaveBeenCalledWith("Need fresher runtime docs");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables confirm while loading and hides when open is false", () => {
    const loadingMarkup = renderModalMarkup(makeProps({ loading: true }));
    const closedMarkup = renderModalMarkup(makeProps({ open: false }));

    expect(loadingMarkup).toMatch(
      /data-testid="replan-modal-confirm"[^>]*disabled=""/
    );
    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(closedMarkup).toBe("");
  });

  it("allows Esc, outside, and cancel to close while idle but blocks them in-flight", () => {
    const idleCancel = vi.fn();
    const loadingCancel = vi.fn();
    const idle = invokeModal(makeProps({ onCancel: idleCancel }));
    const loading = invokeModal(
      makeProps({ loading: true, onCancel: loadingCancel })
    );
    const idleDialog = findElementByTestId(
      idle,
      "autopilot-replan-confirmation-modal"
    );
    const loadingDialog = findElementByTestId(
      loading,
      "autopilot-replan-confirmation-modal"
    );
    const loadingCancelButton = findElementByTestId(
      loading,
      "replan-modal-cancel"
    );
    const preventDefault = vi.fn();

    (idleDialog!.props as { onEscapeKeyDown: () => void }).onEscapeKeyDown();
    (
      idleDialog!.props as { onPointerDownOutside: () => void }
    ).onPointerDownOutside();
    (
      loadingDialog!.props as {
        onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
      }
    ).onEscapeKeyDown({ preventDefault });
    (
      loadingDialog!.props as {
        onPointerDownOutside: (event: { preventDefault: () => void }) => void;
      }
    ).onPointerDownOutside({ preventDefault });
    (loadingCancelButton!.props as { onClick: () => void }).onClick();

    expect(idleCancel).toHaveBeenCalledTimes(2);
    expect(loadingCancel).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it("shows API errors including 409 running stage and clears them when the user edits reason", () => {
    const onReasonChange = vi.fn();
    const onClearError = vi.fn();
    const modal = invokeModal(
      makeProps({
        error: "Downstream generation is already running.",
        runningStage: "effect_preview",
        onReasonChange,
        onClearError,
      })
    );
    const markup = renderModalMarkup(
      makeProps({
        error: "Downstream generation is already running.",
        runningStage: "effect_preview",
      })
    );
    const reason = findElementByTestId(modal, "replan-modal-reason");

    expect(markup).toContain('data-testid="replan-modal-error"');
    expect(markup).toContain("effect_preview");

    (
      reason!.props as {
        onChange: (event: { currentTarget: { value: string } }) => void;
      }
    ).onChange({ currentTarget: { value: "Try again after review" } });

    expect(onReasonChange).toHaveBeenCalledWith("Try again after review");
    expect(onClearError).toHaveBeenCalledTimes(1);
  });
});
