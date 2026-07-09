import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TaskHeaderCard,
  STATUS_BADGE_CLASSES,
  type TaskHeaderCardProps,
} from "../TaskHeaderCard";
import type { MissionTaskStatus } from "@/lib/tasks-store";

/* ─── Helpers ─── */

function makeProps(overrides?: Partial<TaskHeaderCardProps>): TaskHeaderCardProps {
  return {
    title: "Test Task",
    description: "A test task description",
    status: "running",
    progress: 50,
    estimatedDuration: null,
    priority: null,
    driveState: null,
    locale: "en-US",
    ...overrides,
  };
}

function render(props: TaskHeaderCardProps): string {
  return renderToStaticMarkup(<TaskHeaderCard {...props} />);
}

/* ─── Tests ─── */

describe("TaskHeaderCard", () => {
  describe("status badge color mapping", () => {
    const statusColorCases: Array<{
      status: MissionTaskStatus;
      expectedClasses: string[];
    }> = [
      {
        status: "running",
        expectedClasses: ["bg-emerald-100", "text-emerald-700"],
      },
      {
        status: "waiting",
        expectedClasses: ["bg-amber-100", "text-amber-700"],
      },
      {
        status: "failed",
        expectedClasses: ["bg-red-100", "text-red-700"],
      },
      {
        status: "done",
        expectedClasses: ["bg-slate-100", "text-slate-600"],
      },
      {
        status: "cancelled",
        expectedClasses: ["bg-slate-100", "text-slate-500"],
      },
      {
        status: "queued",
        expectedClasses: ["bg-sky-100", "text-sky-700"],
      },
    ];

    for (const { status, expectedClasses } of statusColorCases) {
      it(`maps status "${status}" to correct badge classes`, () => {
        const markup = render(makeProps({ status }));
        for (const cls of expectedClasses) {
          expect(markup).toContain(cls);
        }
      });
    }

    it("exports STATUS_BADGE_CLASSES with all six statuses", () => {
      const statuses: MissionTaskStatus[] = [
        "running",
        "waiting",
        "failed",
        "done",
        "cancelled",
        "queued",
      ];
      for (const s of statuses) {
        expect(STATUS_BADGE_CLASSES[s]).toBeDefined();
      }
    });
  });

  describe("title and description", () => {
    it("renders the title text", () => {
      const markup = render(makeProps({ title: "Deploy to production" }));
      expect(markup).toContain("Deploy to production");
    });

    it("renders the description when provided", () => {
      const markup = render(
        makeProps({ description: "Run the deployment pipeline" })
      );
      expect(markup).toContain("Run the deployment pipeline");
    });

    it("does not render description when null", () => {
      const markup = render(makeProps({ description: null }));
      expect(markup).not.toContain("line-clamp-2");
    });
  });

  describe("progress bar", () => {
    it("renders progress percentage", () => {
      const markup = render(makeProps({ progress: 75 }));
      expect(markup).toContain("75%");
    });

    it("clamps progress to 0-100 range", () => {
      const markupOver = render(makeProps({ progress: 150 }));
      expect(markupOver).toContain("100%");

      const markupUnder = render(makeProps({ progress: -10 }));
      expect(markupUnder).toContain("0%");
    });

    it("uses primary color for progress fill", () => {
      const markup = render(makeProps({ progress: 50 }));
      expect(markup).toContain("bg-primary");
    });
  });

  describe("estimated duration and priority", () => {
    it("renders estimated duration when provided", () => {
      const markup = render(makeProps({ estimatedDuration: "30min" }));
      expect(markup).toContain("30min");
    });

    it("does not render estimated duration when null", () => {
      const markup = render(makeProps({ estimatedDuration: null }));
      expect(markup).not.toContain("30min");
    });

    it("renders priority when provided", () => {
      const markup = render(makeProps({ priority: "high" }));
      expect(markup).toContain("high");
    });

    it("does not render priority when null", () => {
      const withPriority = render(makeProps({ priority: "high" }));
      const withoutPriority = render(makeProps({ priority: null }));
      // The priority tag with Flag icon should not be present when null
      expect(withPriority).toContain("high");
      expect(withoutPriority).not.toContain(">high<");
    });
  });

  describe("design tokens", () => {
    it("uses card background and foreground tokens", () => {
      const markup = render(makeProps());
      expect(markup).toContain("bg-card");
      expect(markup).toContain("text-card-foreground");
    });

    it("uses border token", () => {
      const markup = render(makeProps());
      expect(markup).toContain("border");
    });

    it("uses rounded-lg for border radius", () => {
      const markup = render(makeProps());
      expect(markup).toContain("rounded-lg");
    });
  });

  describe("i18n", () => {
    it("renders Chinese status label for zh-CN locale", () => {
      const markup = render(makeProps({ locale: "zh-CN", status: "running" }));
      expect(markup).toContain("运行中");
      expect(markup).toContain("进度");
    });

    it("renders English status label for en-US locale", () => {
      const markup = render(makeProps({ locale: "en-US", status: "running" }));
      expect(markup).toContain("Running");
      expect(markup).toContain("Progress");
    });
  });

  describe("drive state", () => {
    it("renders drive state when provided", () => {
      const markup = render(makeProps({ driveState: "executing" }));
      expect(markup).toContain("executing");
    });

    it("does not render drive state when null", () => {
      const markup = render(makeProps({ driveState: null }));
      // Only the status badge should be present, no extra drive state text
      expect(markup).not.toContain("executing");
    });
  });
});
