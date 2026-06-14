import React from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * G_READY 澄清问题卡片（多步分页）。弹在输入框上方。
 * 词汇对齐 V4 `BlueprintClarificationQuestion`（type/options:string[]/defaultAnswer/context）。
 * 数据源：sessionState.coverageGaps 的 open open_question gaps（由 SlideRule.tsx 派生传入）。
 */
export type ClarificationItem = {
  id: string;
  prompt: string;
  kind?: string;  // V4 alignment (e.g. "audience", blueprint question id)
  type?: "free_text" | "single_choice" | "multi_choice";
  options?: string[];
  defaultAnswer?: string;
  context?: string;
};

export type ClarificationAnswer = { gapId: string; answer: string };

const OTHER = "__other__";

export function ClarificationCard({
  questions,
  onSubmit,
  onClose,
}: {
  questions: ClarificationItem[];
  onSubmit: (answers: ClarificationAnswer[]) => void;
  onClose: () => void;
}) {
  const total = questions.length;
  const [step, setStep] = React.useState(0);
  // 每题：选中的 option（或 OTHER），以及 multi_choice 的多选集合 / free_text 与 其他 的文本
  const [picked, setPicked] = React.useState<Record<string, string>>({});
  const [multi, setMulti] = React.useState<Record<string, Set<string>>>({});
  const [otherText, setOtherText] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    // 预选 defaultAnswer（若匹配某个选项）
    const seedPick: Record<string, string> = {};
    for (const q of questions) {
      if (q.type !== "multi_choice" && q.defaultAnswer && (q.options || []).includes(q.defaultAnswer)) {
        seedPick[q.id] = q.defaultAnswer;
      }
    }
    setPicked(seedPick);
    setMulti({});
    setOtherText({});
    setStep(0);
  }, [questions]);

  if (total === 0) return null;
  const q = questions[Math.min(step, total - 1)];
  const isChoice = (q.type === "single_choice" || q.type === "multi_choice") && (q.options || []).length > 0;
  const isMulti = q.type === "multi_choice";

  const answerFor = (item: ClarificationItem): string => {
    if (isMultiType(item)) {
      const set = multi[item.id];
      const parts = set ? [...set] : [];
      if (set?.has(OTHER) && otherText[item.id]?.trim()) {
        parts.splice(parts.indexOf(OTHER), 1, otherText[item.id].trim());
      } else if (set?.has(OTHER)) {
        parts.splice(parts.indexOf(OTHER), 1);
      }
      return parts.join("、");
    }
    const p = picked[item.id];
    if (p === OTHER) return otherText[item.id]?.trim() || "";
    if (p) return p;
    // free_text 或未选：取 其他/文本 输入
    return otherText[item.id]?.trim() || "";
  };

  function isMultiType(item: ClarificationItem): boolean {
    return item.type === "multi_choice" && (item.options || []).length > 0;
  }

  const answeredCount = questions.filter((item) => answerFor(item).length > 0).length;

  const submit = () => {
    const answers: ClarificationAnswer[] = questions
      .map((item) => ({ gapId: item.id, answer: answerFor(item) }))
      .filter((a) => a.answer.length > 0);
    if (answers.length === 0) return;
    onSubmit(answers);
  };

  const toggleMulti = (value: string) => {
    setMulti((prev) => {
      const next = new Set(prev[q.id] ?? []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [q.id]: next };
    });
  };

  return (
    <div
      className="pointer-events-auto mb-2 w-full max-w-2xl rounded-2xl border border-indigo-200/70 bg-white/95 shadow-[0_12px_40px_rgb(79_70_229/0.12)] backdrop-blur-xl"
      data-testid="sliderule-clarification-card"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            待回答问题
          </span>
          <span className="text-[11px] tabular-nums text-slate-400" data-testid="sliderule-clarification-pager">
            {step + 1} / {total}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          title="关闭（也可直接在下方输入框补充）"
          data-testid="sliderule-clarification-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-semibold text-slate-800">{q.prompt}</p>
          {q.kind && (
            <span className={`rounded px-1 py-0 text-[9px] font-mono ${
              q.kind.includes("audience") || q.kind.includes("users") ? "bg-blue-100 text-blue-700" :
              q.kind.includes("platform") ? "bg-green-100 text-green-700" :
              q.kind.includes("scope") ? "bg-amber-100 text-amber-700" :
              q.kind.includes("success") || q.kind.includes("scenario") ? "bg-purple-100 text-purple-700" :
              "bg-indigo-100 text-indigo-700"
            }`}>{q.kind}</span>
          )}
        </div>
        {q.context && <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{q.context}</p>}

        <div className="mt-3 space-y-1.5">
          {isChoice &&
            (q.options || []).map((opt) => {
              const isRecommended = q.defaultAnswer === opt;
              const selected = isMulti ? (multi[q.id]?.has(opt) ?? false) : picked[q.id] === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    isMulti ? toggleMulti(opt) : setPicked((p) => ({ ...p, [q.id]: opt }))
                  }
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition ${
                    selected
                      ? "border-indigo-400 bg-indigo-50/70 text-slate-800"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                      isMulti ? "rounded-[5px]" : "rounded-full"
                    } ${selected ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-300"}`}
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">{opt}</span>
                  {isRecommended && (
                    <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      推荐
                    </span>
                  )}
                </button>
              );
            })}

          {/* 其他 / 自由文本 */}
          {isChoice ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  isMulti ? toggleMulti(OTHER) : setPicked((p) => ({ ...p, [q.id]: OTHER }))
                }
                className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                  isMulti ? "rounded-[5px]" : "rounded-full"
                } ${
                  (isMulti ? multi[q.id]?.has(OTHER) : picked[q.id] === OTHER)
                    ? "border-indigo-500 bg-indigo-500 text-white"
                    : "border-slate-300"
                }`}
              >
                {(isMulti ? multi[q.id]?.has(OTHER) : picked[q.id] === OTHER) && <Check className="h-3 w-3" />}
              </button>
              <input
                type="text"
                value={otherText[q.id] || ""}
                onChange={(e) => {
                  setOtherText((o) => ({ ...o, [q.id]: e.target.value }));
                  if (!isMulti && e.target.value) setPicked((p) => ({ ...p, [q.id]: OTHER }));
                }}
                placeholder="其他（自定义回答）"
                className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                data-testid="sliderule-clarification-other"
              />
            </div>
          ) : (
            <textarea
              value={otherText[q.id] || ""}
              onChange={(e) => setOtherText((o) => ({ ...o, [q.id]: e.target.value }))}
              placeholder="输入你的回答…"
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              data-testid="sliderule-clarification-text"
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
        <span className="text-[11px] text-slate-400">已答 {answeredCount} / {total}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-500 transition hover:text-slate-700"
          >
            取消
          </button>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 上一步
            </button>
          )}
          {step < total - 1 ? (
            <button
              onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-indigo-500"
              data-testid="sliderule-clarification-next"
            >
              下一步 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={answeredCount === 0}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[12px] font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="sliderule-clarification-submit"
            >
              提交补充
            </button>
          )}
          {/* UI 增强: 按 kind 批量提交基础 (如果当前题有 kind, 提供批量选项) */}
          {q.kind && total > 1 && (
            <button
              onClick={() => {
                // 简单批量: 提交所有同 kind 的已答 (基础实现, 可扩展)
                const sameKind = questions.filter(item => item.kind === q.kind);
                const answers: ClarificationAnswer[] = sameKind
                  .map((item) => ({ gapId: item.id, answer: answerFor(item) }))
                  .filter((a) => a.answer.length > 0);
                if (answers.length > 0) onSubmit(answers);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
              title={`批量提交同 kind (${q.kind})`}
            >
              批量 {q.kind}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
