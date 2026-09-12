// @vitest-environment jsdom
/** Real Studio and the application's actual modal body consume the same HTTP
 * surface. Residual HTML/model data must not choose an alternate renderer or
 * trigger its connector, seed or landing-shot effects for a project artifact.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideRuleStudio } from "../SlideRuleStudio";
import {
  AppArtifactPreview,
  deriveAppCardDetail,
} from "@/pages/agent-loop/dashboard/AppsWorkbench";

let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
const stored = {
  runtimeKind: "project",
  projectId: "project-one",
  projectRevision: "revision-one",
  specFirstPages: {
    pages: { home: "<html><body>HISTORICAL HTML</body></html>" },
  },
  publishClosure: {
    evidencePresentCount: 6,
    blocked: false,
    perSkillEvidence: {
      datamodel: { modelSection: { entities: [{ id: "tasks" }] } },
    },
  },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  fetcher = vi.fn(async () =>
    Response.json({
      operationId: "operation-one",
      available: true,
      reason: null,
      descriptor: {
        kind: "project",
        projectId: "project-one",
        runtimeId: "runtime-one",
        revision: "revision-one",
        status: "failed",
        entryUrl: null,
      },
    })
  );
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("both project artifact consumers", () => {
  it.each([false, true])(
    "Studio preserves the project stage with old HTML and running=%s",
    async running => {
      await act(async () =>
        root.render(
          <SlideRuleStudio
            chatSlot={<p>conversation</p>}
            activeSkillId={null}
            runtimeKind="project"
            projectId={stored.projectId}
            projectRevision={stored.projectRevision}
            sessionId="session-one"
            isRunning={running}
            specFirstPages={stored.specFirstPages}
          />
        )
      );
      expect(container.textContent).toContain("应用运行失败");
      expect(
        container.querySelector('[data-testid="sandbox-preview-surface"]')
      ).not.toBeNull();
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.textContent).not.toContain("HISTORICAL HTML");
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        "/api/sliderule/projects/project-one/preview",
      ]);
      expect(localStorage.length).toBe(0);
    }
  );

  it("App center keeps project references, suppresses old closure success, and consumes the shared preview", async () => {
    const detail = deriveAppCardDetail(stored);
    expect(detail.projectId).toBe(stored.projectId);
    expect(detail.projectRevision).toBe(stored.projectRevision);
    expect(detail.status).not.toBe("runnable");
    expect(detail.evidenceCount).toBe(0);
    expect(detail.model).toBeNull();
    expect(detail.specPages).toBeNull();
    await act(async () =>
      root.render(
        <AppArtifactPreview
          detail={detail}
          previewKey="session-one"
          appTitle="任务管理"
        />
      )
    );
    expect(container.textContent).toContain("应用运行失败");
    expect(container.textContent).toContain(
      "工程历史版本与复刻尚未接入应用中心"
    );
    expect(container.textContent).not.toContain("HISTORICAL HTML");
    expect(container.querySelector("iframe")).toBeNull();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/sliderule/projects/project-one/preview",
    ]);
  });

  it("project modal type wins even if another caller supplies both project and HTML data", async () => {
    const detail = {
      ...deriveAppCardDetail(stored),
      specPages: { ...stored.specFirstPages, navItems: [], boundPages: 0 },
    };
    await act(async () =>
      root.render(
        <AppArtifactPreview
          detail={detail}
          previewKey="session-one"
          appTitle="任务管理"
        />
      )
    );
    expect(
      container.querySelector('[data-testid="sandbox-preview-surface"]')
    ).not.toBeNull();
    expect(container.textContent).not.toContain("HISTORICAL HTML");
    expect(container.querySelector("iframe")).toBeNull();
  });
});
