/**
 * 对话栏 / 舞台之间的分隔：可左右拖、可折叠。
 *
 * 2026-08-18 之前是写死 38% / 62% 一条发丝线。用户要 Cursor 那种
 * 能拖宽窄、能折掉一侧的分隔——固定比例在真机上要么对话挤、要么图看不清。
 *
 * 默认仍是 38/62（老布局的标定），拖过的比例经 autoSaveId 记住。
 * 两侧不能同时折没：折一个时另一个的折钮禁用，否则整页只剩一条缝。
 */
import React from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ChevronLeft, ChevronRight } from "lucide-react";

const CHAT_DEFAULT = 38;
const STAGE_DEFAULT = 62;

export function StudioSplit({
  chat,
  stage,
}: {
  chat: React.ReactNode;
  stage: React.ReactNode;
}) {
  const chatRef = React.useRef<ImperativePanelHandle>(null);
  const stageRef = React.useRef<ImperativePanelHandle>(null);
  const [chatCollapsed, setChatCollapsed] = React.useState(false);
  const [stageCollapsed, setStageCollapsed] = React.useState(false);

  const toggleChat = () => {
    const panel = chatRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else if (!stageCollapsed) panel.collapse();
  };

  const toggleStage = () => {
    const panel = stageRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else if (!chatCollapsed) panel.collapse();
  };

  const resetSplit = () => {
    chatRef.current?.resize(CHAT_DEFAULT);
    stageRef.current?.resize(STAGE_DEFAULT);
  };

  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId="sliderule-studio-split"
      className="h-full w-full"
      data-testid="sliderule-studio-split"
    >
      <Panel
        id="sliderule-chat"
        ref={chatRef}
        defaultSize={CHAT_DEFAULT}
        minSize={20}
        maxSize={72}
        collapsible
        collapsedSize={0}
        onCollapse={() => setChatCollapsed(true)}
        onExpand={() => setChatCollapsed(false)}
        className="min-h-0 min-w-0"
      >
        {chat}
      </Panel>

      <PanelResizeHandle
        data-testid="sliderule-studio-split-handle"
        className="group relative z-20 flex w-1.5 shrink-0 items-center justify-center bg-transparent outline-none hover:bg-[#d4d4d8] data-[resize-handle-active]:bg-[#a1a1aa]"
        onDoubleClick={resetSplit}
        title="拖动调整宽度 · 双击恢复默认"
      >
        <span className="pointer-events-none absolute inset-y-0 w-px bg-[#e5e7eb] group-hover:bg-transparent group-data-[resize-handle-active]:bg-transparent" />
        <div
          className="relative z-10 flex flex-col gap-px rounded-md border border-[#e5e7eb] bg-white p-px opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[resize-handle-active]:opacity-100"
          onPointerDown={event => event.stopPropagation()}
        >
          <button
            type="button"
            data-testid="sliderule-studio-split-toggle-chat"
            aria-label={chatCollapsed ? "展开对话" : "折叠对话"}
            disabled={stageCollapsed}
            onClick={toggleChat}
            className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[#52525b] hover:bg-[#f4f4f5] disabled:opacity-30"
          >
            {chatCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            data-testid="sliderule-studio-split-toggle-stage"
            aria-label={stageCollapsed ? "展开舞台" : "折叠舞台"}
            disabled={chatCollapsed}
            onClick={toggleStage}
            className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[#52525b] hover:bg-[#f4f4f5] disabled:opacity-30"
          >
            {stageCollapsed ? (
              <ChevronLeft className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </PanelResizeHandle>

      <Panel
        id="sliderule-stage"
        ref={stageRef}
        defaultSize={STAGE_DEFAULT}
        minSize={24}
        collapsible
        collapsedSize={0}
        onCollapse={() => setStageCollapsed(true)}
        onExpand={() => setStageCollapsed(false)}
        className="min-h-0 min-w-0"
      >
        {stage}
      </Panel>
    </PanelGroup>
  );
}
