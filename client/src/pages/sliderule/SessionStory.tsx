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
import {
  ProjectActionRowView,
  useSelectedProjectActionId,
} from "./ProjectTaskChecklist";
import { followProjectActionId } from "./project-activity";
import {
  deriveSessionStory,
  disclosureOpen,
  sessionStoryCollapsedHint,
  sessionStoryDuration,
  sessionStoryHasProcess,
  toolGroupFace,
  type SessionStoryTools,
} from "./session-story";
import type { UiTurn } from "./types";

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
      data-testid="project-task-checklist"
      className="space-y-0.5"
    >
      {block.rows.map(row => (
        <li key={row.id}>
          <ProjectActionRowView
            row={row}
            selected={selectedId === row.id}
          />
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

export function SessionStory({
  turn,
  streaming,
  productSlot,
}: {
  turn: UiTurn;
  streaming: boolean;
  productSlot?: React.ReactNode;
}) {
  const blocks = React.useMemo(() => deriveSessionStory(turn), [turn]);
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
  const insertedProduct = blocks.some(block => block.kind === "product");
  const bodyId = `session-story-body-${turn.id}`;
  const lastToolsId = [...blocks]
    .reverse()
    .find(block => block.kind === "tools")?.id;

  if (!hasProcess && !productSlot && !duration) return null;

  const body = (
    <div id={bodyId} data-testid="session-story-body" className="space-y-2">
      {blocks.map(block => {
        if (block.kind === "speech") {
          return (
            <div
              key={block.id}
              className="space-y-2 text-[14px] leading-[1.7] text-[#171717]"
              data-testid="sliderule-model-speech"
            >
              <p className="whitespace-pre-wrap">{block.text}</p>
            </div>
          );
        }
        if (block.kind === "product") {
          return productSlot ? (
            <div key={block.id} data-testid="session-story-product">
              {productSlot}
            </div>
          ) : null;
        }
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
      {!insertedProduct && productSlot ? (
        <div data-testid="session-story-product">{productSlot}</div>
      ) : null}
    </div>
  );

  return (
    <section
      className="mb-2 space-y-2"
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
          className="flex w-full items-center gap-1.5 py-0.5 text-left text-[13px] text-[#8a8a8a] outline-none focus-visible:ring-2 focus-visible:ring-[#2f6bff]/40"
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
      ) : productSlot ? (
        productSlot
      ) : null}
    </section>
  );
}
