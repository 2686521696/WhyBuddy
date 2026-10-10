/**
 * SessionStory — 工程档一轮对话的章节面。
 *
 * 2026-09-15 对照 Manus TicketStream 完成态：对话是一篇能折起来的故事。
 * 第二刀按 GitHub 上的现成策略改折叠，不换消息协议：
 *
 *   · assistant-ui Reasoning / Vercel AI Elements：流式撑开，结束收起，
 *     人手点过一次就不再抢（`disclosureOpen`）
 *   · OpenHands EventGroup：进行中脸上是当前动作 + n/total，
 *     收尾才写「编辑了 N 个文件」（`toolGroupFace`）
 *   · assistant-ui Thread 用 ghost 组，不要灰底卡片
 *
 * 判断在 `session-story.ts`。工具组只折外观，失败那一次点得开。
 */

import React from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ProjectActionRowView,
  useSelectedProjectActionId,
} from "./ProjectTaskChecklist";
import {
  followProjectActionId,
  type ProjectActionStatus,
} from "./project-activity";
import {
  deriveSessionStory,
  disclosureOpen,
  splitClosingSpeech,
  sessionStoryCollapsedHint,
  sessionStoryDuration,
  sessionStoryHasProcess,
  toolGroupFace,
  type SessionStoryTools,
} from "./session-story";
import { CLOSING_MARKDOWN } from "./speech-links";
import { CHAT_PROSE } from "./chat-type-scale";
import type { UiTurn } from "./types";

function TimelineDot({
  status,
  last,
}: {
  status: ProjectActionStatus;
  last: boolean;
}) {
  const tone =
    status === "failed"
      ? "bg-rose-500"
      : status === "done"
        ? "bg-emerald-500"
        : "bg-[#2f6bff] shadow-[0_0_0_3px_rgba(47,107,255,0.16)]";
  return (
    <span
      className="relative flex w-4 shrink-0 flex-col items-center self-stretch"
      aria-hidden
    >
      <span
        data-testid="session-story-timeline-dot"
        data-status={status}
        className={`mt-[9px] size-2 shrink-0 rounded-full ${tone}`}
      />
      {last ? null : (
        <span className="mt-1 w-px flex-1 bg-[#e6e6e6]" />
      )}
    </span>
  );
}

function useDisclosure(streaming: boolean, defaultOpen = false) {
  const [userOpen, setUserOpen] = React.useState<boolean | null>(null);
  const open = disclosureOpen({ streaming, defaultOpen, userOpen });
  const toggle = () => setUserOpen(current => !(current ?? open));
  return { open, toggle };
}

function ToolGroup({
  block,
  selectedId,
  finalized,
}: {
  block: SessionStoryTools;
  selectedId: string | null;
  finalized: boolean;
}) {
  const face = toolGroupFace(block.rows, { finalized });
  const fold = block.rows.length > 1;
  const { open, toggle } = useDisclosure(face.running && !finalized);
  const listId = `session-story-tools-${block.id}`;

  const list = (
    <ol
      id={listId}
      data-testid="session-story-timeline"
      data-checklist="project-task-checklist"
      className="m-0 list-none space-y-0 p-0"
    >
      {block.rows.map((row, index) => (
        <li key={row.id} className="flex items-stretch gap-1">
          <TimelineDot
            status={row.status}
            last={index === block.rows.length - 1}
          />
          <div className="min-w-0 flex-1">
            <ProjectActionRowView
              row={row}
              selected={selectedId === row.id}
              variant="timeline"
            />
          </div>
        </li>
      ))}
    </ol>
  );

  if (!fold) {
    return (
      <section data-testid="session-story-tools" data-chapter={block.chapter}>
        {list}
      </section>
    );
  }

  return (
    <section
      data-testid="session-story-tools"
      data-chapter={block.chapter}
      data-tool-group-running={face.running ? "true" : "false"}
    >
      <button
        type="button"
        data-testid="session-story-tools-summary"
        data-tool-group-meta={face.meta}
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        className="flex w-full items-center gap-2 py-1 text-left text-[13px] text-[#555] outline-none hover:text-[#171717] focus-visible:ring-2 focus-visible:ring-[#2f6bff]/40"
      >
        {face.running ? (
          <LoaderCircle
            className="size-3.5 shrink-0 animate-spin text-[#2f6bff]"
            aria-hidden
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{face.title}</span>
        {face.meta ? (
          <span className="shrink-0 text-[12px] tabular-nums text-[#9a9a9a]">
            {face.meta}
          </span>
        ) : null}
        <ChevronRight
          className={`size-3.5 shrink-0 text-[#c0c0c0] transition-transform duration-150 ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        />
      </button>
      <div hidden={!open} className="mt-1">
        {list}
      </div>
    </section>
  );
}

/**
 * 模型对用户说的话按 markdown 画（收尾、以及没有工程的纯回答轮）。
 *
 * ⚠ 2026-10-02 隔离真机第 186 轮 sr-20261002070245-3CVZ2CH0XG（「给读书会想 5 个名字」）：没有工程的回答轮
 *   不走 SessionStory，走 SlideRule 的 ModelSpeechBlocks，那里按纯文本 <p> 画——左栏原样露出「1. **阅见**」。
 *   工程轮的收尾早就按 markdown 画了（上面 CLOSING_MARKDOWN），两条路画同一种话，一条画对一条画错（§四）。
 */
export function SpeechMarkdown({ text }: { text: string }) {
  return (
    <div className={CHAT_PROSE}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={CLOSING_MARKDOWN}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function SessionStory({
  turn,
  streaming,
  productSlot,
  deliverableKind,
}: {
  turn: UiTurn;
  streaming: boolean;
  productSlot?: React.ReactNode;
  deliverableKind?: string;
}) {
  const allBlocks = React.useMemo(
    () => deriveSessionStory(turn, { deliverableKind }),
    [turn, deliverableKind]
  );
  const { process: blocks, closing } = splitClosingSpeech(allBlocks, streaming);
  const duration = sessionStoryDuration(turn);
  const hasProcess = sessionStoryHasProcess(blocks);
  const collapsedHint = sessionStoryCollapsedHint(blocks);
  const inspectId = useSelectedProjectActionId();
  const selectedId = React.useMemo(
    () =>
      followProjectActionId(
        blocks.flatMap(block => (block.kind === "tools" ? block.rows : [])),
        inspectId
      ),
    [blocks, inspectId]
  );
  const canFold = Boolean(duration) && hasProcess && !streaming;
  const { open: expanded, toggle: toggleProcess } = useDisclosure(streaming);
  const bodyId = `session-story-body-${turn.id}`;
  const lastToolsId = [...blocks]
    .reverse()
    .find(block => block.kind === "tools")?.id;

  if (!hasProcess && !closing && !productSlot && !duration) return null;

  const body = (
    <div id={bodyId} data-testid="session-story-body" className="min-w-0 space-y-2">
      {blocks.map(block => {
        if (block.kind === "speech") {
          return (
            <div
              key={block.id}
              className="min-w-0 space-y-2 text-[14px] leading-[1.7] text-[#171717]"
              data-testid="sliderule-model-speech"
            >
              {/* ⚠ 2026-09-19 坦克那趟：模型把 pop-/plan- 和
                  todo_write{…} 一整段粘成无空格 token。只写
                  whitespace-pre-wrap 在空格处才折，这一行把
                  overflow-y-auto 的对话栏顶出横向滚动条。 */}
              <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {block.text}
              </p>
            </div>
          );
        }
        if (block.kind === "product") return null;
        return (
          <div key={block.id} className="space-y-1.5">
            {block.showChapter ? (
              <h3
                data-testid="session-story-chapter"
                className="pt-1 text-[13px] font-medium text-[#171717]"
              >
                {block.chapter}
              </h3>
            ) : null}
            <ToolGroup
              block={block}
              selectedId={selectedId}
              finalized={!streaming || block.id !== lastToolsId}
            />
          </div>
        );
      })}
    </div>
  );

  return (
    <section
      className="mb-2 min-w-0 space-y-2"
      data-testid="session-story"
      data-session-story="manus"
    >
      {duration ? (
        <button
          type="button"
          data-testid="session-story-duration"
          aria-expanded={canFold ? expanded : undefined}
          aria-controls={canFold ? bodyId : undefined}
          onClick={canFold ? toggleProcess : undefined}
          className="flex min-w-0 w-full items-center gap-1.5 py-0.5 text-left text-[13px] text-[#8a8a8a] outline-none focus-visible:ring-2 focus-visible:ring-[#2f6bff]/40"
        >
          <span className="tabular-nums">{duration}</span>
          {canFold && !expanded && collapsedHint ? (
            <span className="min-w-0 flex-1 truncate text-[#9a9a9a]">
              {collapsedHint}
            </span>
          ) : null}
          {canFold ? (
            <ChevronRight
              className={`size-3.5 shrink-0 text-[#c0c0c0] transition-transform duration-150 ${
                expanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
          ) : null}
        </button>
      ) : null}
      {hasProcess ? (
        <div hidden={canFold && !expanded}>{body}</div>
      ) : null}
      {/* 收尾总结在折页外面、结果卡前面（splitClosingSpeech 头注）。
          它常带下载链接，按 markdown 画；react-markdown 默认的地址过滤只放行
          http(s)/mailto/相对路径，模型写的 sandbox: 路径会被清空，不会变成
          一个点了没反应的假链接。 */}
      {closing ? (
        <div
          data-testid="session-story-closing"
          className={CHAT_PROSE}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={CLOSING_MARKDOWN}>
            {closing.text}
          </ReactMarkdown>
        </div>
      ) : null}
      {/* ⚠ 2026-09-20 番茄钟：卡是「任务已完成」，贴在过程折页后面。
          塞进 body / 创建工程后面，人圈出来位置不对。 */}
      {productSlot ? (
        <div data-testid="session-story-product">{productSlot}</div>
      ) : null}
    </section>
  );
}
