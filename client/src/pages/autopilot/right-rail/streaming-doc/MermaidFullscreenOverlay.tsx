/**
 * MermaidFullscreenOverlay — 全屏查看 Mermaid SVG 图表。
 *
 * 使用 Radix Dialog 实现模态覆盖层：
 * - 深色背景 + 毛玻璃效果
 * - SVG 以自然尺寸居中展示
 * - 右上角关闭按钮 + Escape 键关闭
 * - 通过 overflow auto 实现大图滚动浏览（pan）
 */

import { type FC } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export interface MermaidFullscreenOverlayProps {
  /** Whether the overlay is open. */
  open: boolean;
  /** Callback to close the overlay. */
  onClose: () => void;
  /** The rendered SVG HTML string to display. */
  svgHtml: string;
}

export const MermaidFullscreenOverlay: FC<MermaidFullscreenOverlayProps> = ({
  open,
  onClose,
  svgHtml,
}) => {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed inset-4 z-50 overflow-auto rounded-lg bg-slate-900 p-6 shadow-2xl focus:outline-none"
          onEscapeKeyDown={onClose}
        >
          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 z-10 rounded-full bg-slate-800 p-2 text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-white/50"
              aria-label="Close fullscreen preview"
            >
              ✕
            </button>
          </Dialog.Close>
          <div
            className="flex min-h-full items-center justify-center"
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default MermaidFullscreenOverlay;
