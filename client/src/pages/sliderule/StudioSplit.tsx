/**
 * 对话栏 / 舞台之间的分隔：可左右拖、可折叠。
 *
 * 2026-08-18 之前是写死 38% / 62% 一条发丝线。用户要 Cursor 那种
 * 能拖宽窄、能折掉一侧的分隔——固定比例在真机上要么对话挤、要么图看不清。
 *
 * 默认仍是 38/62（老布局的标定），拖过的比例经 autoSaveId 记住。
 * 两侧不能同时折没：折一个时另一个的折钮禁用，否则整页只剩一条缝。
 *
 * 缝上的右箭头跟顶栏一样：隐藏整块预览页，不是把舞台宽度收成 0。
 */
import React from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStudioLayout } from "./StudioLayoutContext";

const CHAT_DEFAULT = 38;
const STAGE_DEFAULT = 62;

function SplitFallback({
  chat,
  stage,
}: {
  chat: React.ReactNode;
  stage: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full" data-testid="sliderule-studio-split">
      <div className="min-h-0 min-w-0" style={{ flex: `${CHAT_DEFAULT} 1 0` }}>
        {chat}
      </div>
      <div className="min-h-0 min-w-0" style={{ flex: `${STAGE_DEFAULT} 1 0` }}>
        {stage}
      </div>
    </div>
  );
}

export function StudioSplit({
  chat,
  stage,
}: {
  chat: React.ReactNode;
  stage: React.ReactNode;
}) {
  const layout = useStudioLayout();
  if (!layout) return <SplitFallback chat={chat} stage={stage} />;

  const {
    chatRef,
    stageRef,
    collapsed,
    setChatCollapsed,
    setStageCollapsed,
    toggleChat,
    toggleStagePage,
  } = layout;

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
            aria-label={collapsed.chat ? "展开对话" : "折叠对话"}
            disabled={collapsed.stage}
            onClick={toggleChat}
            className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[#52525b] hover:bg-[#f4f4f5] disabled:opacity-30"
          >
            {collapsed.chat ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            data-testid="sliderule-studio-split-toggle-stage"
            aria-label="隐藏页面"
            onClick={toggleStagePage}
            className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[#52525b] hover:bg-[#f4f4f5]"
          >
            <ChevronRight className="h-3.5 w-3.5" />
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
