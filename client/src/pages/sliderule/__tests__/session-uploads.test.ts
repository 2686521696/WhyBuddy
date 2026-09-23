import { describe, expect, it } from "vitest";
import {
  sessionUploadUrl,
  workspaceUploadNote,
} from "../session-uploads";

describe("session uploads", () => {
  it("posts the original name, and the note is the workspace path", () => {
    expect(sessionUploadUrl("sess 1", "报告.docx")).toBe(
      "/api/sliderule/sessions/sess%201/uploads?name=%E6%8A%A5%E5%91%8A.docx"
    );
    expect(
      workspaceUploadNote(
        [{ name: "报告.docx", path: "/home/user/workspace/报告.docx" }],
        ["缺了.xlsx"]
      )
    ).toBe(
      "[工作区文件 /home/user/workspace/报告.docx]\n【附件 缺了.xlsx】没有放进工作区。"
    );
  });
});
