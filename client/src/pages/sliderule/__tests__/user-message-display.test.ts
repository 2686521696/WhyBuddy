/**
 * 发出去的 userText 仍带解析正文；气泡只留任务句和文件名。
 *
 * 反向：普通句子不能被拆空；解析正文漏进 prompt 等于又贴回气泡。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  attachmentStatusLine,
  isPreviewableImageName,
  visibleUserMessage,
} from "../user-message-display";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const PAGE = stripComments(
  readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
);
const DOCK = stripComments(
  readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
);

const DUMP = [
  "将图片内容整理成一个Work文档总结给我",
  "[附件: 微信图片_20260909165624_650_52.png]",
  "",
  "【附件内容 · 微信图片_20260909165624_650_52.png】",
  "以下是图片内容的完整提取：",
  "顶部区域左侧气泡：我们不是三个独立的学校",
  "",
  "[工作区文件 uploads/微信图片_20260909165624_650_52.png]",
].join("\n");

describe("visibleUserMessage", () => {
  it("气泡只留任务句，解析正文和工作区路径都不进", () => {
    const visible = visibleUserMessage(DUMP);
    expect(visible.prompt).toBe("将图片内容整理成一个Work文档总结给我");
    expect(visible.files).toEqual(["微信图片_20260909165624_650_52.png"]);
    expect(visible.prompt).not.toContain("完整提取");
    expect(visible.prompt).not.toContain("顶部区域");
    expect(visible.prompt).not.toContain("工作区文件");
  });

  it("没有附件标记的句子原样留下", () => {
    expect(visibleUserMessage("做个待办清单").prompt).toBe("做个待办清单");
    expect(visibleUserMessage("做个待办清单").files).toEqual([]);
    expect(visibleUserMessage("").prompt).toBe("");
  });

  it("多个文件名都留下，失败说明不进任务句", () => {
    const visible = visibleUserMessage(
      "对比这两份\n[附件: a.png, b.pdf]\n\n【附件 a.png】内容提取失败（超时），仅携带文件名。\n\n【附件内容 · b.pdf】\n第一页"
    );
    expect(visible.prompt).toBe("对比这两份");
    expect(visible.files).toEqual(["a.png", "b.pdf"]);
    expect(visible.prompt).not.toContain("第一页");
    expect(visible.prompt).not.toContain("提取失败");
  });
});

describe("attachmentStatusLine", () => {
  it("就绪只写类型和大小，不写解析字数", () => {
    expect(
      attachmentStatusLine({
        name: "微信图片.png",
        size: 2.1 * 1024 * 1024,
        extractStatus: "ready",
      })
    ).toBe("PNG · 2.1 MB");
    expect(
      attachmentStatusLine({
        name: "note.txt",
        size: 1200,
      })
    ).toBe("TXT · 1 KB");
  });

  it("解析中和失败不冒充已读完", () => {
    expect(
      attachmentStatusLine({
        name: "a.png",
        size: 10,
        extractStatus: "pending",
      })
    ).toBe("解析中…");
    expect(
      attachmentStatusLine({
        name: "a.png",
        size: 10,
        extractStatus: "failed",
      })
    ).toBe("解析失败");
  });
});

describe("isPreviewableImageName", () => {
  it("图片能点开，文档不能冒充图片", () => {
    expect(isPreviewableImageName("微信图片.PNG")).toBe(true);
    expect(isPreviewableImageName("a.jpeg")).toBe(true);
    expect(isPreviewableImageName("a.webp")).toBe(true);
    expect(isPreviewableImageName("报告.docx")).toBe(false);
    expect(isPreviewableImageName("notes")).toBe(false);
  });
});

describe("附件卡在输入框里，气泡不画解析正文", () => {
  it("文件卡画在 composer 卡片内部，不浮在卡片上面", () => {
    const dockAt = DOCK.indexOf('data-testid="sliderule-composer-dock"');
    const attachAt = DOCK.indexOf('data-testid="sliderule-attachments"');
    const actionsAt = DOCK.indexOf('data-testid="sliderule-composer-actions"');
    expect(dockAt).toBeGreaterThan(-1);
    expect(attachAt).toBeGreaterThan(dockAt);
    const actions = DOCK.slice(actionsAt, dockAt);
    expect(actions).not.toContain("sliderule-attachments");
    const card = DOCK.slice(
      DOCK.indexOf("sliderule-attachment-card"),
      DOCK.indexOf("sliderule-attachment-remove")
    );
    expect(card).toContain("attachmentStatusLine");
    expect(card).not.toContain("已解析");
  });

  it("用户气泡画的是拆出来的任务句，不是整段 userText", () => {
    const fn = PAGE.slice(
      PAGE.indexOf("function ImUserMessage"),
      PAGE.indexOf("function ImAssistantMessage")
    );
    expect(fn).toContain("visibleUserMessage");
    const bubble = fn.slice(
      fn.indexOf('data-testid="sliderule-user-bubble"'),
      fn.indexOf('data-testid="sliderule-edit-rerun"')
    );
    expect(bubble).toContain("{visible.prompt}");
    expect(bubble).not.toContain("item.turn.user");
    expect(fn).toContain('data-testid="sliderule-user-files"');
    expect(fn).toContain("<SentFileThumb");
    expect(fn).toContain("detail: { text: visible.prompt }");
    expect(fn).not.toContain("【附件内容");
    const thumb = PAGE.slice(
      PAGE.indexOf("function SentFileThumb"),
      PAGE.indexOf("function ImUserMessage")
    );
    expect(thumb).toContain('data-testid="sliderule-user-file-thumb"');
    expect(thumb).toContain("AttachmentImageLightbox");
    expect(thumb).toContain("sessionUploadUrl");
    expect(thumb).toContain("createPortal");
  });
});
