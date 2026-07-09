import { useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  FileSearch,
  GitBranch,
  Layers3,
  LifeBuoy,
  Lightbulb,
  Paperclip,
  PlayCircle,
  Route,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  AUTOPILOT_LAUNCH_EXAMPLES,
  type AutopilotLaunchExample,
} from "@/lib/autopilot-launch-examples";
import { cn } from "@/lib/utils";

export const AUTOPILOT_LAUNCH_EXAMPLE_CONSISTENCY_MARKER =
  "code-side-autopilot-launch-examples-v1";

export const AUTOPILOT_ONBOARDING_LAYER_MARKERS = [
  "destination",
  "route",
  "fleet",
  "takeover-evidence",
  "first-entry-cockpit",
] as const;

function isZhLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith("zh");
}

function copy(locale: string, zh: string, en: string): string {
  return isZhLocale(locale) ? zh : en;
}

function exampleLabel(locale: string, example: AutopilotLaunchExample): string {
  return isZhLocale(locale) ? example.label : example.englishLabel;
}

function ExampleIcon({ kind }: { kind: AutopilotLaunchExample["kind"] }) {
  switch (kind) {
    case "analysis":
      return <FileSearch className="size-3.5" />;
    case "generation":
      return <Lightbulb className="size-3.5" />;
    case "implementation":
      return <GitBranch className="size-3.5" />;
    case "research":
      return <ClipboardCheck className="size-3.5" />;
    case "attachment":
      return <Paperclip className="size-3.5" />;
    case "advanced-execution":
      return <PlayCircle className="size-3.5" />;
  }
}

function FlowStep({
  icon,
  title,
  description,
  layer,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  layer: string;
}) {
  return (
    <div
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-reduce:animate-none rounded-[14px] border border-[#ead8c3]/75 bg-white/70 p-2.5"
      data-explanation-layer={layer}
    >
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#9a5d32]">
        {icon}
        {title}
      </div>
      <p className="mt-1 text-[10px] leading-4 text-stone-600">
        {description}
      </p>
    </div>
  );
}

export function AutopilotLaunchEmptyState({
  locale,
  onSelectExample,
  className,
}: {
  locale: string;
  onSelectExample: (example: AutopilotLaunchExample) => void;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "mt-2 rounded-[20px] border border-[#ead8c3]/70 bg-[linear-gradient(135deg,rgba(255,250,244,0.92),rgba(247,253,249,0.84))] p-3 shadow-[0_12px_30px_rgba(98,73,48,0.08)]",
        className
      )}
      data-testid="autopilot-launch-empty-state"
      data-onboarding-state={collapsed ? "collapsed" : "expanded"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#267064]">
            <Sparkles className="size-4" />
            {copy(locale, "\u81ea\u52a8\u9a7e\u9a76\u53d1\u8d77", "Autopilot launch")}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-stone-950">
            {copy(
              locale,
              "\u5148\u8f93\u5165\u76ee\u7684\u5730\uff0c\u518d\u8ba9\u7cfb\u7edf\u89c4\u5212\u8def\u7ebf",
              "Start with a destination, then let the system plan the route"
            )}
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-stone-600">
            {copy(
              locale,
              "\u628a\u4f60\u8981\u8fbe\u6210\u7684\u76ee\u6807\u3001\u4ea4\u4ed8\u7269\u3001\u7ea6\u675f\u548c\u9a8c\u6536\u6807\u51c6\u5199\u8fdb\u8f93\u5165\u6846\uff1b\u81ea\u52a8\u9a7e\u9a76\u4f1a\u5148\u89e3\u6790\u76ee\u7684\u5730\uff0c\u518d\u63a8\u8350\u8def\u7ebf\u3001\u7ec4\u5efa\u7f16\u961f\uff0c\u5e76\u5728\u9700\u8981\u65f6\u8bf7\u6c42\u63a5\u7ba1\u4e0e\u4fdd\u7559\u8bc1\u636e\u3002",
              "Describe the goal, deliverable, constraints, and acceptance criteria. Autopilot parses the destination, recommends a route, forms a fleet, and asks for takeover while keeping evidence when needed."
            )}
          </p>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-[#d8e6dd] bg-white/76 px-2.5 py-1 text-[10px] font-semibold text-[#267064] transition hover:bg-[#f7fdf9]"
          data-testid="autopilot-launch-empty-state-toggle"
          onClick={() => setCollapsed(value => !value)}
        >
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          {collapsed
            ? copy(locale, "\u91cd\u65b0\u6253\u5f00\u5f15\u5bfc", "Reopen guide")
            : copy(locale, "\u6298\u53e0\u5f15\u5bfc", "Collapse guide")}
        </button>
      </div>

      {!collapsed ? (
        <>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
              <FlowStep
                icon={<Route className="size-3.5" />}
                title={copy(locale, "\u8f93\u5165\u76ee\u7684\u5730", "Destination")}
                layer={AUTOPILOT_ONBOARDING_LAYER_MARKERS[0]}
              description={copy(
                locale,
                "\u5199\u6e05\u76ee\u6807\u3001\u4ea4\u4ed8\u7269\u3001\u7ea6\u675f\u548c\u6210\u529f\u6807\u51c6\u3002",
                "State the goal, deliverable, constraints, and success criteria."
              )}
            />
            <FlowStep
              icon={<GitBranch className="size-3.5" />}
              title={copy(locale, "\u8def\u7ebf\u89c4\u5212", "Route planning")}
              layer={AUTOPILOT_ONBOARDING_LAYER_MARKERS[1]}
              description={copy(
                locale,
                "\u7cfb\u7edf\u9884\u89c8\u5feb\u901f\u3001\u6807\u51c6\u3001\u6df1\u5ea6\u6216\u5148\u6f84\u6e05\u8def\u7ebf\u3002",
                "Preview fast, standard, deep, or clarification-first routes."
              )}
            />
            <FlowStep
              icon={<Layers3 className="size-3.5" />}
              title={copy(locale, "\u7f16\u961f\u6267\u884c", "Fleet execution")}
              layer={AUTOPILOT_ONBOARDING_LAYER_MARKERS[2]}
              description={copy(
                locale,
                "\u590d\u6742\u8f93\u5165\u4f1a\u8fdb\u5165\u7f16\u961f\u6216\u9ad8\u7ea7\u7f16\u6392\u3002",
                "Complex inputs can move into fleet or advanced orchestration."
              )}
            />
            <FlowStep
              icon={<ShieldCheck className="size-3.5" />}
              title={copy(locale, "\u63a5\u7ba1 / \u8bc1\u636e", "Takeover / Evidence")}
              layer={AUTOPILOT_ONBOARDING_LAYER_MARKERS[3]}
              description={copy(
                locale,
                "\u5173\u952e\u8282\u70b9\u4f1a\u8bf7\u6c42\u4eba\u5de5\u63a5\u7ba1\u5e76\u7559\u4e0b\u8bc1\u636e\u8bb0\u5f55\u3002",
                "Key points request human takeover and keep evidence records."
              )}
            />
          </div>

          <div
            className="mt-3 rounded-[16px] border border-[#d8e6dd]/80 bg-white/70 p-2.5 motion-reduce:transition-none"
            data-testid="autopilot-first-entry-cockpit-guide"
            data-explanation-layer={AUTOPILOT_ONBOARDING_LAYER_MARKERS[4]}
          >
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#267064]">
              <LifeBuoy className="size-3.5" />
              {copy(locale, "\u9996\u6b21\u8fdb\u5165 cockpit", "First cockpit entry")}
            </div>
            <div className="mt-2 grid gap-1.5 text-[10px] leading-4 text-stone-600 sm:grid-cols-3">
              <span className="rounded-[12px] border border-[#d8e6dd] bg-[#f7fdf9]/76 px-2 py-1.5">
                {copy(
                  locale,
                  "\u5148\u770b\u5de6\u4fa7\u76ee\u7684\u5730\u4e0e\u8def\u7ebf\uff0c\u786e\u8ba4\u7cfb\u7edf\u7406\u89e3\u662f\u5426\u6b63\u786e\u3002",
                  "Start left: confirm the destination and route match your intent."
                )}
              </span>
              <span className="rounded-[12px] border border-[#ead8c3] bg-[#fffaf4]/80 px-2 py-1.5">
                {copy(
                  locale,
                  "\u518d\u770b\u4e2d\u95f4\u6267\u884c\u8f68\u8ff9\uff0c\u8ddf\u8e2a\u7f16\u961f\u6b63\u5728\u63a8\u8fdb\u7684\u4e8b\u3002",
                  "Then scan center: follow what the fleet is driving now."
                )}
              </span>
              <span className="rounded-[12px] border border-amber-200 bg-amber-50/70 px-2 py-1.5">
                {copy(
                  locale,
                  "\u6700\u540e\u770b\u53f3\u4fa7\u63a5\u7ba1\u4e0e\u8bc1\u636e\uff0c\u53ea\u5728\u9700\u8981\u4f60\u51b3\u7b56\u65f6\u505c\u4e0b\u3002",
                  "Finish right: takeover and evidence only interrupt when a decision is needed."
                )}
              </span>
            </div>
          </div>

          <div
            className="mt-3 rounded-[16px] border border-[#ead8c3]/70 bg-[#fffaf4]/72 p-2.5"
            data-example-consistency-marker={
              AUTOPILOT_LAUNCH_EXAMPLE_CONSISTENCY_MARKER
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a5d32]">
                  {copy(locale, "\u76ee\u7684\u5730\u793a\u4f8b", "Destination examples")}
                </div>
                <p className="mt-0.5 text-[10px] leading-4 text-stone-600">
                  {copy(
                    locale,
                    "\u8fd9\u4e9b\u793a\u4f8b\u53ea\u4f1a\u89e6\u53d1\u5f53\u524d\u652f\u6301\u7684\u8def\u7ebf\u9884\u89c8\uff1b\u9ad8\u7ea7\u6267\u884c\u793a\u4f8b\u4f1a\u5148\u63d0\u793a\u5207\u6362\u8fd0\u884c\u65f6\u3002",
                    "These examples only trigger supported route previews; advanced execution first asks to switch runtime."
                  )}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#d8e6dd] bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-[#267064]">
                <LifeBuoy className="size-3.5" />
                {copy(locale, "\u53ef\u968f\u65f6\u91cd\u65b0\u6253\u5f00", "Reopen anytime")}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {AUTOPILOT_LAUNCH_EXAMPLES.map(example => (
                <button
                  key={example.kind}
                  type="button"
                  className="group inline-flex items-center gap-1.5 rounded-full border border-[#ead8c3]/80 bg-white/78 px-2.5 py-1 text-left text-[10px] font-semibold text-[#9a5d32] transition hover:border-[#d9a47c] hover:bg-[#fff7ed]"
                  data-testid={`autopilot-launch-example-${example.kind}`}
                  onClick={() => onSelectExample(example)}
                  title={example.description}
                >
                  <ExampleIcon kind={example.kind} />
                  {exampleLabel(locale, example)}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
