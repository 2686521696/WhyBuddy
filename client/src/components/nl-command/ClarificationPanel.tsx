import { useCallback, useState } from "react";
import { MessageCircleQuestion, Send, Sparkles } from "lucide-react";

import { GlowButton } from "@/components/ui/GlowButton";
import { useI18n } from "@/i18n";
import { localizeTaskHubQuestion } from "@/lib/task-hub-copy";
import { cn } from "@/lib/utils";
import type {
  ClarificationDialog,
  ClarificationQuestion,
} from "@shared/nl-command/contracts";

export interface ClarificationPanelProps {
  dialog: ClarificationDialog;
  onAnswer: (
    questionId: string,
    text: string,
    selectedOptions?: string[],
  ) => void | Promise<void>;
  title?: string;
  answerPlaceholder?: string;
  answerLabel?: string;
  answeringLabel?: string;
  hideHeader?: boolean;
  chrome?: "default" | "minimal";
  className?: string;
}

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export function ClarificationPanel({
  dialog,
  onAnswer,
  title,
  answerPlaceholder,
  answerLabel,
  answeringLabel,
  hideHeader = false,
  chrome = "default",
  className,
}: ClarificationPanelProps) {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const isMinimal = chrome === "minimal";
  const answeredIds = new Set(dialog.answers.map(answer => answer.questionId));
  const unanswered = dialog.questions.filter(
    question => !answeredIds.has(question.questionId),
  );
  const resolvedTitle = title ?? (isZh ? "需要补充信息" : "Clarification needed");
  const resolvedAnswerPlaceholder =
    answerPlaceholder ?? (isZh ? "请在这里输入你的回答..." : "Type your answer here...");
  const resolvedAnswerLabel = answerLabel ?? (isZh ? "发送" : "Send");
  const resolvedAnsweringLabel =
    answeringLabel ?? (isZh ? "发送中..." : "Sending...");

  if (unanswered.length === 0) return null;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        isMinimal
          ? "gap-2"
          : "rounded-xl border border-amber-200 bg-amber-50/60 p-3",
        className,
      )}
    >
      {hideHeader ? null : (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2",
            isMinimal
              ? "text-[11px] font-medium text-stone-600"
              : "mb-3 text-sm font-medium text-amber-800",
          )}
        >
          <MessageCircleQuestion className={cn("size-4", isMinimal && "size-3.5")} />
          {isZh
            ? `${resolvedTitle}（${unanswered.length} 个问题）`
            : `${resolvedTitle} (${unanswered.length} question${unanswered.length > 1 ? "s" : ""})`}
        </div>
      )}

      <div className={cn("min-h-0 flex-1 overflow-y-auto", isMinimal ? "" : "pr-1")}>
        <div className={cn(isMinimal ? "space-y-0" : "space-y-3")}>
          {unanswered.map((question, index) => (
            <div
              key={question.questionId}
              className={cn(
                isMinimal && index > 0 && "mt-3 border-t border-[#efe3d6] pt-3",
              )}
            >
              <QuestionCard
                question={question}
                onAnswer={onAnswer}
                answerPlaceholder={resolvedAnswerPlaceholder}
                answerLabel={resolvedAnswerLabel}
                answeringLabel={resolvedAnsweringLabel}
                chrome={chrome}
                locale={locale}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  onAnswer,
  answerPlaceholder,
  answerLabel,
  answeringLabel,
  chrome,
  locale,
}: {
  question: ClarificationQuestion;
  onAnswer: (
    questionId: string,
    text: string,
    selectedOptions?: string[],
  ) => void | Promise<void>;
  answerPlaceholder: string;
  answerLabel: string;
  answeringLabel: string;
  chrome: "default" | "minimal";
  locale: string;
}) {
  const [freeText, setFreeText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const isMinimal = chrome === "minimal";
  const resolvedQuestion = localizeTaskHubQuestion(
    question,
    locale === "zh-CN" ? "zh-CN" : "en-US",
  );

  const isSingleChoice = resolvedQuestion.type === "single_choice";
  const isMultiChoice = resolvedQuestion.type === "multi_choice";
  const hasOptions =
    (isSingleChoice || isMultiChoice) &&
    Array.isArray(resolvedQuestion.options) &&
    resolvedQuestion.options.length > 0;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      if (hasOptions) {
        const options = Array.from(selected);
        await onAnswer(question.questionId, options.join(", "), options);
        return;
      }

      await onAnswer(question.questionId, freeText.trim());
    } finally {
      setSubmitting(false);
    }
  }, [freeText, hasOptions, onAnswer, question.questionId, selected]);

  const handleOptionPress = useCallback(
    async (option: string) => {
      if (submitting) return;

      if (isSingleChoice) {
        setSelected(new Set([option]));
        setSubmitting(true);
        try {
          await onAnswer(question.questionId, option, [option]);
        } finally {
          setSubmitting(false);
        }
        return;
      }

      setSelected(previous => {
        const next = new Set(previous);
        if (next.has(option)) {
          next.delete(option);
        } else {
          next.add(option);
        }
        return next;
      });
    },
    [isSingleChoice, onAnswer, question.questionId, submitting],
  );

  const canSubmit = hasOptions ? selected.size > 0 : freeText.trim().length > 0;
  const keyboardHint = t(
    locale,
    "Enter 发送 · Shift + Enter 换行",
    "Enter to send · Shift + Enter for a new line",
  );
  const selectionHint =
    hasOptions && !isSingleChoice
      ? selected.size > 0
        ? t(
            locale,
            `已选择 ${selected.size} 项，确认后即可发送。`,
            `${selected.size} options selected. Send to continue.`,
          )
        : t(
            locale,
            "请选择一个或多个答案后发送。",
            "Choose one or more options before sending.",
          )
      : null;
  const minimalSubmitClass = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-[22px] px-2.5 py-2 text-sm font-semibold transition-all",
    canSubmit && !submitting
      ? "bg-[linear-gradient(180deg,#db893c,#c76d1d)] text-white shadow-[0_16px_32px_rgba(199,109,29,0.26)] hover:-translate-y-[1px] hover:brightness-105"
      : "cursor-not-allowed bg-[#f2e6da] text-[#c0a58c] shadow-none",
  );

  return (
    <div
      className={cn(
        "overflow-hidden",
        isMinimal ? "px-0 py-0" : "rounded-lg bg-white/80 p-3",
      )}
    >
      <p
        className={cn(
          "font-medium text-stone-800",
          isMinimal
            ? "max-w-4xl text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[#24160d]"
            : "text-sm",
        )}
      >
        {resolvedQuestion.text}
      </p>

      <div className={cn(isMinimal ? "mt-3" : "mt-3")}>
        {hasOptions ? (
          <div className={cn(isMinimal ? "space-y-2.5" : "")}>
            <div className={cn("flex flex-wrap", isMinimal ? "gap-2" : "gap-2")}>
              {resolvedQuestion.options!.map(option => (
                <button
                  key={option}
                  type="button"
                  disabled={submitting}
                  className={cn(
                    "font-medium transition-colors",
                    isMinimal
                      ? "min-h-[34px] rounded-full border px-3 py-1.5 text-[12px]"
                      : "rounded-lg border px-3 py-1.5 text-xs",
                    selected.has(option)
                      ? isMinimal
                        ? "border-[#e4b183] bg-[#fff2e5] text-[#9a5e30] shadow-[0_10px_24px_rgba(217,152,106,0.12)]"
                        : "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : isMinimal
                        ? "border-[#eadfd2] bg-white/96 text-stone-600 hover:border-[#d9b89b] hover:bg-white"
                        : "border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-300",
                  )}
                  onClick={() => void handleOptionPress(option)}
                >
                  {option}
                </button>
              ))}
            </div>

            {isMinimal ? (
              isSingleChoice ? null : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-[11px] leading-5 text-stone-400">
                    {selectionHint}
                  </div>
                  <button
                    type="button"
                    disabled={!canSubmit || submitting}
                    className={cn("min-h-[48px] min-w-[112px]", minimalSubmitClass)}
                    onClick={() => void handleSubmit()}
                  >
                    <Send className="size-4" />
                    {submitting ? answeringLabel : answerLabel}
                  </button>
                </div>
              )
            ) : null}
          </div>
        ) : isMinimal ? (
          <div className="space-y-2.5">
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-stretch">
              <div className="flex min-h-[58px] flex-1 items-end gap-2 rounded-[20px] border border-[#eadfd2] bg-white/96 px-3 py-2.5 shadow-[0_14px_30px_rgba(112,84,51,0.05),inset_0_1px_0_rgba(255,255,255,0.72)] transition focus-within:border-[#d89a6a]/48 focus-within:ring-4 focus-within:ring-[#f5e2d0]/70">
                <textarea
                  value={freeText}
                  onChange={event => setFreeText(event.target.value)}
                  placeholder={answerPlaceholder}
                  rows={1}
                  className="max-h-[140px] min-h-[28px] flex-1 resize-none bg-transparent text-[14px] leading-6 text-stone-900 placeholder:text-stone-400 focus:outline-none"
                  aria-label={
                    locale === "zh-CN"
                      ? `回答：${resolvedQuestion.text}`
                      : `Answer for: ${resolvedQuestion.text}`
                  }
                  onKeyDown={event => {
                    if (event.key === "Enter" && !event.shiftKey && canSubmit) {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                />
                <Sparkles className="mb-1 size-5 shrink-0 text-[#c58a58]" />
              </div>

              <button
                type="button"
                disabled={!canSubmit || submitting}
                className={cn("min-h-[58px] min-w-[116px]", minimalSubmitClass)}
                onClick={() => void handleSubmit()}
              >
                <Send className="size-4" />
                {submitting ? answeringLabel : answerLabel}
              </button>
            </div>

            <div className="flex justify-end text-[11px] text-stone-400">
              {keyboardHint}
            </div>
          </div>
        ) : (
          <textarea
            value={freeText}
            onChange={event => setFreeText(event.target.value)}
            placeholder={answerPlaceholder}
            rows={3}
            className="min-h-[92px] w-full resize-y rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            aria-label={
              locale === "zh-CN"
                ? `回答：${resolvedQuestion.text}`
                : `Answer for: ${resolvedQuestion.text}`
            }
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && canSubmit) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
        )}
      </div>

      {isMinimal || hasOptions && isSingleChoice ? null : (
        <div className="mt-3 flex justify-end">
          <GlowButton
            type="button"
            disabled={!canSubmit || submitting}
            className="rounded-lg"
            onClick={() => void handleSubmit()}
          >
            <Send className="size-3.5" />
            {submitting ? answeringLabel : answerLabel}
          </GlowButton>
        </div>
      )}
    </div>
  );
}
