/**
 * 对话/舞台折叠的命令中心。顶栏图标簇和分隔条折钮共用这一份。
 *
 * 状态不能只活在 StudioSplit 里：图标簇挂在舞台头条右侧，
 * 跟分隔条折钮不在同一棵子树，靠这份 context 共用折叠态。
 */
import React from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  canCollapsePart,
  maximizeIntent,
  nextStagePageHidden,
  type StudioCollapsed,
} from "./studio-layout";

export type StudioLayoutApi = {
  available: boolean;
  collapsed: StudioCollapsed;
  /** 整块预览页不渲染。跟 collapsed.stage（改宽度）不是一回事。 */
  stagePageHidden: boolean;
  /**
   * 正在拖分栏缝。舞台里的同源 iframe 是按 1920×1080 画的整页，
   * 拖的时候每帧 ResizeObserver → setScale 会把拖条拖成一卡一卡。
   * 对照：VS Code sash-dragging 期间 iframe { pointer-events:none }，
   * Gutenberg ScaledBlockPreview 拖时不重算缩放，松手再量一次。
   */
  resizing: boolean;
  chatRef: React.RefObject<ImperativePanelHandle | null>;
  stageRef: React.RefObject<ImperativePanelHandle | null>;
  setChatCollapsed: (next: boolean) => void;
  setStageCollapsed: (next: boolean) => void;
  setResizing: (next: boolean) => void;
  toggleChat: () => void;
  toggleStage: () => void;
  toggleStagePage: () => void;
  toggleMaximize: () => void;
};

const StudioLayoutContext = React.createContext<StudioLayoutApi | null>(null);

export function StudioLayoutProvider({
  available,
  children,
}: {
  available: boolean;
  children: React.ReactNode;
}) {
  const chatRef = React.useRef<ImperativePanelHandle>(null);
  const stageRef = React.useRef<ImperativePanelHandle>(null);
  const [chatCollapsed, setChatCollapsed] = React.useState(false);
  const [stageCollapsed, setStageCollapsed] = React.useState(false);
  const [stagePageHidden, setStagePageHidden] = React.useState(false);
  const [resizing, setResizing] = React.useState(false);
  const collapsed = { chat: chatCollapsed, stage: stageCollapsed };

  React.useEffect(() => {
    if (available) return;
    setChatCollapsed(false);
    setStageCollapsed(false);
    setStagePageHidden(false);
    setResizing(false);
  }, [available]);

  const toggleStagePage = React.useCallback(() => {
    // 只翻显隐。collapse/expand 是改宽度，这里不许碰。
    setStagePageHidden(prev => nextStagePageHidden(prev));
    setChatCollapsed(false);
    setStageCollapsed(false);
  }, []);

  const toggleChat = React.useCallback(() => {
    const panel = chatRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else if (canCollapsePart("chat", { chat: panel.isCollapsed(), stage: stageCollapsed })) {
      panel.collapse();
    }
  }, [stageCollapsed]);

  const toggleStage = React.useCallback(() => {
    const panel = stageRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else if (canCollapsePart("stage", { chat: chatCollapsed, stage: panel.isCollapsed() })) {
      panel.collapse();
    }
  }, [chatCollapsed]);

  const toggleMaximize = React.useCallback(() => {
    const chat = chatRef.current;
    if (!chat) return;
    const intent = maximizeIntent({
      chat: chat.isCollapsed(),
      stage: stageCollapsed,
    });
    if (intent === "maximize") chat.collapse();
    else if (intent === "restore") chat.expand();
  }, [stageCollapsed]);

  const value = React.useMemo<StudioLayoutApi>(
    () => ({
      available,
      collapsed,
      stagePageHidden,
      resizing,
      chatRef,
      stageRef,
      setChatCollapsed,
      setStageCollapsed,
      setResizing,
      toggleChat,
      toggleStage,
      toggleStagePage,
      toggleMaximize,
    }),
    [
      available,
      chatCollapsed,
      stageCollapsed,
      stagePageHidden,
      resizing,
      toggleChat,
      toggleStage,
      toggleStagePage,
      toggleMaximize,
    ]
  );

  return (
    <StudioLayoutContext.Provider value={value}>
      {children}
    </StudioLayoutContext.Provider>
  );
}

export function useStudioLayout(): StudioLayoutApi | null {
  return React.useContext(StudioLayoutContext);
}
