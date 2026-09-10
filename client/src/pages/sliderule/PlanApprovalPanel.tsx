import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Pencil, X } from "lucide-react";
import type { ControlPlanApprovalWire } from "@/lib/sliderule-marathon-driver";

export type PlanApprovalOutcome = {
  reqId: string;
  outcome: "approved" | "cancelled" | "abandoned";
  feedback?: string;
};

export function PlanApprovalPanel({
  plan,
  onSubmit,
}: {
  plan: ControlPlanApprovalWire;
  onSubmit: (result: PlanApprovalOutcome) => void;
}) {
  const [feedback, setFeedback] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const submittedRef = React.useRef(false);
  const submit = (outcome: PlanApprovalOutcome["outcome"]) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    onSubmit({
      reqId: plan.reqId,
      outcome,
      ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
    });
  };

  return (
    <section
      aria-label="计划审批"
      data-testid="sliderule-plan-approval"
      className="flex max-h-[calc(100dvh-24px)] min-h-0 flex-col rounded-lg border border-[#d4d4d8] bg-white text-[#27272a] shadow-lg sm:max-h-[min(70dvh,640px)]"
    >
      <header className="shrink-0 border-b border-[#e4e4e7] px-4 py-3 text-sm font-semibold">
        计划审批
      </header>
      <div
        data-testid="sliderule-plan-content"
        className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere] [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-[#f4f4f5] [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_a]:text-[#166534] [&_a]:underline"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {plan.planContent}
        </ReactMarkdown>
      </div>
      <footer className="shrink-0 border-t border-[#e4e4e7] p-3">
        {editing ? (
          <textarea
            autoFocus
            aria-label="计划修改意见"
            value={feedback}
            onChange={event => setFeedback(event.target.value)}
            disabled={submitted}
            rows={3}
            className="mb-3 block w-full resize-y rounded border border-[#d4d4d8] px-3 py-2 text-sm outline-none focus:border-[#52525b]"
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="sliderule-plan-approve"
            disabled={submitted}
            onClick={() => submit("approved")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded bg-[#166534] px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            <Check className="h-4 w-4 shrink-0" />
            批准并执行
          </button>
          <button
            type="button"
            data-testid="sliderule-plan-revise"
            disabled={submitted}
            onClick={() => (editing ? submit("cancelled") : setEditing(true))}
            className="inline-flex min-h-9 items-center gap-1.5 rounded border border-[#d4d4d8] px-3 py-2 text-sm disabled:opacity-50"
          >
            <Pencil className="h-4 w-4 shrink-0" />
            {editing ? "提交修改" : "修改计划"}
          </button>
          <button
            type="button"
            data-testid="sliderule-plan-abandon"
            disabled={submitted}
            onClick={() => submit("abandoned")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded px-2 py-2 text-sm text-[#71717a] disabled:opacity-50"
          >
            <X className="h-4 w-4 shrink-0" />
            退出计划
          </button>
        </div>
      </footer>
    </section>
  );
}
