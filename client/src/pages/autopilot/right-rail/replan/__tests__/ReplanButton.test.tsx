import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReplanButton, type ReplanButtonProps } from "../ReplanButton";

function makeProps(
  overrides: Partial<ReplanButtonProps> = {}
): ReplanButtonProps {
  return {
    viewingStage: "spec_tree",
    stageStatus: "completed",
    jobStatus: "completed",
    impact: {
      artifactIds: ["tasks"],
      artifactCount: 1,
      stages: ["spec_docs"],
    },
    onOpen: () => {},
    ...overrides,
  };
}

function invokeButton(props: ReplanButtonProps): ReactElement {
  return (ReplanButton as unknown as (p: ReplanButtonProps) => ReactElement)(
    props
  );
}

describe("<ReplanButton>", () => {
  it("renders the divider CTA only when the viewed stage is completed and downstream impact exists", () => {
    const markup = renderToStaticMarkup(<ReplanButton {...makeProps()} />);

    expect(markup).toContain(
      'data-testid="autopilot-replan-from-stage-divider"'
    );
    expect(markup).toContain("从这里重新规划");
    expect(markup).toContain("1 downstream");
    expect(markup).not.toContain('aria-disabled="true"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).toContain("返回上一步只是回看，不删除产物");
    expect(markup).toContain("从这里重新规划会让下游内容过期或开新分支");
  });

  it("marks running and static preview states as aria-disabled and blocks opening", () => {
    const runningOpen = vi.fn();
    const previewOpen = vi.fn();

    const running = invokeButton(
      makeProps({ jobStatus: "running", onOpen: runningOpen })
    );
    const preview = invokeButton(
      makeProps({ staticPreview: true, onOpen: previewOpen })
    );

    expect(
      renderToStaticMarkup(
        <ReplanButton
          {...makeProps({ jobStatus: "running", onOpen: runningOpen })}
        />
      )
    ).toContain('aria-disabled="true"');
    expect(
      renderToStaticMarkup(
        <ReplanButton
          {...makeProps({ staticPreview: true, onOpen: previewOpen })}
        />
      )
    ).toContain('aria-disabled="true"');

    (running.props as { onClick: () => void }).onClick();
    (preview.props as { onClick: () => void }).onClick();

    expect(runningOpen).not.toHaveBeenCalled();
    expect(previewOpen).not.toHaveBeenCalled();
  });

  it("covers the completed/downstream/static/running visibility matrix with adjacent disabled hints", () => {
    const visible = renderToStaticMarkup(
      <ReplanButton {...makeProps({ isViewingCompletedStage: true })} />
    );
    const notViewingCompleted = renderToStaticMarkup(
      <ReplanButton
        {...makeProps({
          isViewingCompletedStage: false,
          stageStatus: "completed",
        })}
      />
    );
    const emptyDownstream = renderToStaticMarkup(
      <ReplanButton
        {...makeProps({
          isViewingCompletedStage: true,
          impact: { artifactIds: [], artifactCount: 0, stages: [] },
        })}
      />
    );
    const staticPreview = renderToStaticMarkup(
      <ReplanButton
        {...makeProps({ isViewingCompletedStage: true, staticPreview: true })}
      />
    );
    const downstreamRunning = renderToStaticMarkup(
      <ReplanButton
        {...makeProps({
          isViewingCompletedStage: true,
          downstreamRunningStage: "effect_preview",
        })}
      />
    );

    expect(visible).toContain(
      'data-testid="autopilot-replan-from-stage-divider"'
    );
    expect(notViewingCompleted).toBe("");
    expect(emptyDownstream).toBe("");
    expect(staticPreview).toContain('aria-disabled="true"');
    expect(staticPreview).toContain(
      'data-testid="autopilot-replan-disabled-hint"'
    );
    expect(staticPreview).toContain("Static preview");
    expect(downstreamRunning).toContain('aria-disabled="true"');
    expect(downstreamRunning).toContain("effect_preview");
  });

  it("exposes delayed tooltip semantics and keyboard activation for Enter and Space", () => {
    const onOpen = vi.fn();
    const element = invokeButton(
      makeProps({ isViewingCompletedStage: true, onOpen })
    );

    expect(
      renderToStaticMarkup(
        <ReplanButton {...makeProps({ isViewingCompletedStage: true })} />
      )
    ).toContain('data-tooltip-hover-delay-ms="300"');
    expect(
      renderToStaticMarkup(
        <ReplanButton {...makeProps({ isViewingCompletedStage: true })} />
      )
    ).toContain('data-tooltip-long-press-ms="500"');

    const preventDefault = vi.fn();
    const keyHandler = (
      element.props as {
        onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
      }
    ).onKeyDown;
    keyHandler({ key: "Enter", preventDefault });
    keyHandler({ key: " ", preventDefault });
    keyHandler({ key: "Escape", preventDefault });

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it("disables when the viewed stage is not completed or impact is empty", () => {
    const pendingMarkup = renderToStaticMarkup(
      <ReplanButton {...makeProps({ stageStatus: "running" })} />
    );
    const emptyImpactMarkup = renderToStaticMarkup(
      <ReplanButton
        {...makeProps({
          impact: { artifactIds: [], artifactCount: 0, stages: [] },
        })}
      />
    );

    expect(pendingMarkup).toBe("");
    expect(emptyImpactMarkup).toBe("");
  });

  it("opens the confirmation modal when enabled", () => {
    const onOpen = vi.fn();
    const element = invokeButton(makeProps({ onOpen }));

    (element.props as { onClick: () => void }).onClick();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
