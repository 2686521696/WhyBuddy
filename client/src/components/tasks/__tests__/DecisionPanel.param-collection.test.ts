import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MissionDecision } from "@shared/mission/contracts";
import { useAppStore } from "@/lib/store";

import {
  DecisionPanel,
  buildDecisionInteractionKey,
  buildParamCollectionDecisionSubmission,
  buildParamCollectionSubmission,
  buildRequestInfoSubmission,
} from "../DecisionPanel";

function makeParamCollectionDecision(): MissionDecision {
  return {
    prompt: "请补充参数",
    type: "request-info",
    options: [{ id: "submit", label: "提交" }],
    payload: {
      nodeType: "param_collection",
      nodeId: "node-param-1",
      sessionId: "session-param-1",
      interactionId: "interaction-param-1",
      branchKey: "branch-param-1",
      fieldDefinitions: [
        {
          key: "title",
          label: "标题",
          type: "text",
          required: true,
        },
        {
          key: "count",
          label: "数量",
          type: "number",
          defaultValue: 2,
        },
        {
          key: "approved",
          label: "是否通过",
          type: "boolean",
        },
        {
          key: "region",
          label: "区域",
          type: "selection",
          options: [
            { value: "cn", label: "中国区" },
            { value: "global", label: "全球" },
          ],
        },
        {
          key: "attachment",
          label: "附件",
          type: "attachment",
        },
      ],
    },
  };
}

beforeEach(() => {
  useAppStore.getState().setLocale("en-US");
});

describe("DecisionPanel context rendering", () => {
  it("renders free-text request-info semantics for clarification steps", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionPanel, {
        missionId: "mission-1",
        decision: {
          prompt: "Clarify the missing release context",
          type: "request-info",
          allowFreeText: true,
          placeholder: "Tell us what is still missing",
          options: [{ id: "submit", label: "Submit" }],
          decisionId: "decision-request-info-free-text-1",
        },
      })
    );

    expect(markup).toContain("Clarify the missing release context");
    expect(markup).toMatch(
      /Input: This step accepts a free-text clarification response\.|输入方式:/
    );
    expect(markup).toMatch(/aria-label="补充信息"|aria-label="Information response"/);
    expect(markup).toContain("Tell us what is still missing");
    expect(markup).toMatch(/Submit Information|提交信息/);
  });

  it("renders confirm_judge branch semantics for approval decisions", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionPanel, {
        missionId: "mission-1",
        decision: {
          prompt: "Confirm whether the governed route may continue",
          type: "approve",
          options: [
            {
              id: "approve",
              label: "Approve",
              action: "approve",
            },
            {
              id: "reject",
              label: "Reject",
              action: "reject",
              requiresComment: true,
            },
          ],
          decisionId: "decision-confirm-judge-1",
          payload: {
            nodeType: "confirm_judge",
            branchKey: "approved",
          },
        },
      })
    );

    expect(markup).toContain("Confirm whether the governed route may continue");
    expect(markup).toMatch(
      /Node: Confirm Judge routes the next branch with branchKey "approved"\.|节点:/
    );
    expect(markup).toContain("Approve");
    expect(markup).toContain("Reject");
  });

  it("renders route-selection semantics and required-comment hints for route choices", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionPanel, {
        missionId: "mission-1",
        decision: {
          prompt: "Choose the route to continue",
          type: "multi-choice",
          decisionId: "decision-route-selection-1",
          options: [
            {
              id: "fast",
              label: "Fast route",
              description: "Keep the current path moving.",
            },
            {
              id: "safe",
              label: "Safe route",
              description: "Reduce risk before external write.",
              requiresComment: true,
            },
          ],
          payload: {
            nodeType: "selection",
            sessionId: "session-route-selection-1",
            interactionId: "interaction-route-selection-1",
            branchKey: "branch-route-selection-1",
            recommendedRouteId: "wf-route:safe",
            candidateRoutes: [
              {
                optionId: "fast",
                routeId: "wf-route:fast",
                label: "Fast route",
              },
              {
                optionId: "safe",
                routeId: "wf-route:safe",
                label: "Safe route",
              },
            ],
          },
        },
      })
    );

    expect(markup).toContain("Choose the route to continue");
    expect(markup).toMatch(
      /Route Selection: Recommended route: Safe route\.|路线选择:/
    );
    expect(markup).toMatch(
      /Submission: The submission records the selected route option, route label, and route id; any comment is submitted as the route change reason\.|提交语义:/
    );
    expect(markup).toMatch(
      /Context: Session: session-route-selection-1 \| Interaction: interaction-route-selection-1 \| Branch: branch-route-selection-1|上下文:/
    );
    expect(markup).toMatch(/Comment required|需要评论/);
    expect(markup).toContain("Safe route");
  });
});

describe("buildParamCollectionSubmission", () => {
  it("builds metadata.formData with normalized values", () => {
    const result = buildParamCollectionSubmission(makeParamCollectionDecision(), {
      title: "上线任务",
      count: "5" as unknown as number,
      approved: true,
      region: "cn",
      attachment: {
        kind: "attachment",
        ref: "artifact-123",
        name: "需求说明.pdf",
        url: "https://files.example.test/spec.pdf",
        source: "manual",
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.fieldErrors).toEqual({});
    expect(result.metadata).toEqual({
      nodeType: "param_collection",
      nodeId: "node-param-1",
      sessionId: "session-param-1",
      interactionId: "interaction-param-1",
      branchKey: "branch-param-1",
      formData: {
        title: "上线任务",
        count: 5,
        approved: true,
        region: "cn",
        attachment: {
          kind: "attachment",
          ref: "artifact-123",
          name: "需求说明.pdf",
          url: "https://files.example.test/spec.pdf",
          source: "manual",
        },
      },
    });
  });

  it("accepts attachment references as the minimal attachment payload", () => {
    const result = buildParamCollectionSubmission(makeParamCollectionDecision(), {
      title: "附件引用任务",
      attachment: "artifact-ref-1" as unknown as never,
    });

    expect(result.error).toBeUndefined();
    expect(result.fieldErrors).toEqual({});
    expect(result.metadata?.formData.attachment).toEqual({
      kind: "attachment",
      ref: "artifact-ref-1",
    });
    expect(result.metadata?.nodeId).toBe("node-param-1");
    expect(result.metadata?.sessionId).toBe("session-param-1");
  });

  it("returns field-level errors for invalid required and typed values", () => {
    const result = buildParamCollectionSubmission(makeParamCollectionDecision(), {
      title: "",
      count: "abc" as unknown as number,
      region: "mars",
      attachment: {} as unknown as never,
    });

    expect(result.metadata).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(result.fieldErrors.title).toContain("必填");
    expect(result.fieldErrors.count).toContain("数字");
    expect(result.fieldErrors.region).toContain("选项不合法");
    expect(result.fieldErrors.attachment).toContain("附件");
  });
});

describe("buildParamCollectionDecisionSubmission", () => {
  it("builds the request-info param collection payload submitted by the panel", () => {
    const result = buildParamCollectionDecisionSubmission(
      makeParamCollectionDecision(),
      "submit",
      {
        title: "CN launch brief",
        count: "3" as unknown as number,
        approved: false,
        region: "global",
        attachment: "artifact-ref-3" as unknown as never,
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.fieldErrors).toEqual({});
    expect(result.submission).toEqual({
      optionId: "submit",
      metadata: {
        nodeType: "param_collection",
        nodeId: "node-param-1",
        sessionId: "session-param-1",
        interactionId: "interaction-param-1",
        branchKey: "branch-param-1",
        formData: {
          title: "CN launch brief",
          count: 3,
          approved: false,
          region: "global",
          attachment: {
            kind: "attachment",
            ref: "artifact-ref-3",
          },
        },
      },
    });
  });

  it("surfaces field errors instead of returning a malformed param collection request", () => {
    const result = buildParamCollectionDecisionSubmission(
      makeParamCollectionDecision(),
      "submit",
      {
        title: "",
        count: "not-a-number" as unknown as number,
      }
    );

    expect(result.submission).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(result.fieldErrors.title).toBeTruthy();
    expect(result.fieldErrors.count).toBeTruthy();
  });

  it("rejects request-info param collection submissions without an option id", () => {
    const result = buildParamCollectionDecisionSubmission(
      makeParamCollectionDecision(),
      "   ",
      {
        title: "Missing option id",
      }
    );

    expect(result.submission).toBeUndefined();
    expect(result.error).toContain("option");
  });
});

describe("buildRequestInfoSubmission", () => {
  it("submits free text without optionId when request-info allows free text", () => {
    const decision: MissionDecision = {
      prompt: "Please clarify the missing context",
      type: "request-info",
      allowFreeText: true,
      options: [{ id: "submit", label: "Submit" }],
    };

    const result = buildRequestInfoSubmission(
      decision,
      "  The customer needs the CN rollout first.  "
    );

    expect(result.error).toBeUndefined();
    expect(result.submission).toEqual({
      freeText: "The customer needs the CN rollout first.",
    });
  });

  it("binds free text to the clarification option when request-info requires a comment-bound option", () => {
    const decision: MissionDecision = {
      prompt: "Explain what is still missing",
      type: "request-info",
      allowFreeText: false,
      options: [
        {
          id: "skip",
          label: "Skip",
        },
        {
          id: "request-details",
          label: "Request details",
          requiresComment: true,
        },
      ],
    };

    const result = buildRequestInfoSubmission(
      decision,
      "Need the target audience and launch region."
    );

    expect(result.error).toBeUndefined();
    expect(result.submission).toEqual({
      optionId: "request-details",
      freeText: "Need the target audience and launch region.",
    });
  });

  it("prefers allowFreeText over any clarification option binding", () => {
    const decision: MissionDecision = {
      prompt: "Clarify the market scope",
      type: "request-info",
      allowFreeText: true,
      options: [
        {
          id: "request-details",
          label: "Request details",
          requiresComment: true,
        },
      ],
    };

    const result = buildRequestInfoSubmission(
      decision,
      "Only include the CN launch scope."
    );

    expect(result.error).toBeUndefined();
    expect(result.submission).toEqual({
      freeText: "Only include the CN launch scope.",
    });
  });

  it("rejects whitespace-only clarification text even when the step accepts free text", () => {
    const decision: MissionDecision = {
      prompt: "Clarify the missing data",
      type: "request-info",
      allowFreeText: true,
      options: [{ id: "submit", label: "Submit" }],
    };

    const result = buildRequestInfoSubmission(decision, "   ");

    expect(result.submission).toBeUndefined();
    expect(result.error).toContain("Please provide");
  });

  it("rejects request-info free text when neither allowFreeText nor a comment option is available", () => {
    const decision: MissionDecision = {
      prompt: "Clarify the missing data",
      type: "request-info",
      allowFreeText: false,
      options: [{ id: "submit", label: "Submit" }],
    };

    const result = buildRequestInfoSubmission(decision, "Need more detail");

    expect(result.submission).toBeUndefined();
    expect(result.error).toContain("does not accept free-text");
  });
});

describe("buildDecisionInteractionKey", () => {
  it("stays stable for semantically identical param collection decisions", () => {
    const baseDecision = makeParamCollectionDecision();
    const clonedDecision: MissionDecision = {
      ...baseDecision,
      options: baseDecision.options?.map(option => ({ ...option })),
      payload: {
        ...baseDecision.payload,
        fieldDefinitions:
          (
            baseDecision.payload as {
              fieldDefinitions: Array<Record<string, unknown>>;
            }
          ).fieldDefinitions.map(field => ({ ...field })),
      },
    };

    expect(buildDecisionInteractionKey(clonedDecision)).toBe(
      buildDecisionInteractionKey(baseDecision)
    );
  });

  it("changes when the structured clarification schema changes", () => {
    const baseDecision = makeParamCollectionDecision();
    const changedDecision: MissionDecision = {
      ...baseDecision,
      payload: {
        ...baseDecision.payload,
        fieldDefinitions: [
          ...(
            baseDecision.payload as {
              fieldDefinitions: Array<Record<string, unknown>>;
            }
          ).fieldDefinitions,
          {
            key: "market",
            label: "Market",
            type: "text",
          },
        ],
      },
    };

    expect(buildDecisionInteractionKey(changedDecision)).not.toBe(
      buildDecisionInteractionKey(baseDecision)
    );
  });

  it("changes when request-info free-text semantics change", () => {
    const baseDecision: MissionDecision = {
      prompt: "Clarify the scope",
      type: "request-info",
      allowFreeText: true,
      options: [{ id: "submit", label: "Submit" }],
    };
    const changedDecision: MissionDecision = {
      ...baseDecision,
      allowFreeText: false,
      options: [
        { id: "skip", label: "Skip" },
        {
          id: "request-details",
          label: "Request details",
          requiresComment: true,
        },
      ],
    };

    expect(buildDecisionInteractionKey(changedDecision)).not.toBe(
      buildDecisionInteractionKey(baseDecision)
    );
  });

  it("changes when the decision prompt changes even if the schema stays the same", () => {
    const baseDecision = makeParamCollectionDecision();
    const changedDecision: MissionDecision = {
      ...baseDecision,
      prompt: "Please confirm the updated parameters",
    };

    expect(buildDecisionInteractionKey(changedDecision)).not.toBe(
      buildDecisionInteractionKey(baseDecision)
    );
  });

  it("changes when clarification options change for the next decision", () => {
    const baseDecision: MissionDecision = {
      prompt: "Clarify the launch scope",
      type: "request-info",
      allowFreeText: false,
      options: [
        {
          id: "request-details",
          label: "Request details",
          requiresComment: true,
        },
      ],
    };
    const changedDecision: MissionDecision = {
      ...baseDecision,
      options: [
        {
          id: "confirm-scope",
          label: "Confirm scope",
        },
        {
          id: "request-details",
          label: "Request more details",
          requiresComment: true,
        },
      ],
    };

    expect(buildDecisionInteractionKey(changedDecision)).not.toBe(
      buildDecisionInteractionKey(baseDecision)
    );
  });
});

describe("DecisionPanel rendering", () => {
  it("renders the active takeover actions for multi-choice decisions", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionPanel, {
        missionId: "mission-1",
        decision: {
          prompt: "Choose how the mission should continue",
          type: "multi-choice",
          options: [
            {
              id: "retry",
              label: "Retry current executor",
              description: "Keep the current route and retry the last step.",
            },
            {
              id: "escalate",
              label: "Escalate to operator",
              description: "Pause automation and request human follow-up.",
              requiresComment: true,
            },
          ],
          decisionId: "decision-multi-1",
        },
      })
    );

    expect(markup).toMatch(/Decision Required|需要人工决策/);
    expect(markup).toContain("Choose how the mission should continue");
    expect(markup).toContain("Retry current executor");
    expect(markup).toContain("Escalate to operator");
    expect(markup).toMatch(/Submit Selection|提交选择/);
  });

  it("renders structured request-info fields together with the submit action", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionPanel, {
        missionId: "mission-1",
        decision: {
          prompt: "Collect the missing launch parameters",
          type: "request-info",
          options: [{ id: "submit", label: "Submit parameters" }],
          decisionId: "decision-request-info-1",
          payload: {
            nodeType: "param_collection",
            fieldDefinitions: [
              {
                key: "title",
                label: "Launch title",
                type: "text",
                required: true,
              },
              {
                key: "region",
                label: "Launch region",
                type: "selection",
                options: [
                  { value: "cn", label: "China" },
                  { value: "global", label: "Global" },
                ],
              },
            ],
          },
        },
      })
    );

    expect(markup).toMatch(/Decision Required|需要人工决策/);
    expect(markup).toContain("Collect the missing launch parameters");
    expect(markup).toContain("Launch title *");
    expect(markup).toContain("Launch region");
    expect(markup).toMatch(/Submit Parameters|提交参数/);
  });
});
