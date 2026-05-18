/**
 * `autopilot-spec-document-export` Task 1.2：sanitizeFilenameSegment 单测。
 *
 * 6 个 example-based 用例，覆盖 Req 4.1 全部规则：
 * - 保留字符替换
 * - 连续空白合并
 * - 80 字符截断
 * - 空 / 全空白结果回退到 "untitled"
 * - 全 emoji 输入（视为合法非空）
 * - Windows 保留字符 + 中文混排
 */

import { describe, expect, it } from "vitest";

import { sanitizeFilenameSegment } from "../spec-documents/export/sanitize-filename-segment.js";

describe("sanitizeFilenameSegment", () => {
  it("替换 Windows / POSIX 保留字符为短横线", () => {
    expect(sanitizeFilenameSegment(`a<b>c:d"e/f\\g|h?i*j`)).toBe(
      "a-b-c-d-e-f-g-h-i-j",
    );
  });

  it("把连续空白合并为单个下划线", () => {
    expect(sanitizeFilenameSegment("hello   world\t\nagain")).toBe(
      "hello_world_again",
    );
  });

  it("超过 80 字符时截断", () => {
    const raw = "a".repeat(120);
    const result = sanitizeFilenameSegment(raw);
    expect(result.length).toBe(80);
    expect(result).toBe("a".repeat(80));
  });

  it("空字符串 / 全空白回退到 untitled", () => {
    expect(sanitizeFilenameSegment("")).toBe("untitled");
    expect(sanitizeFilenameSegment("   ")).toBe("untitled");
    expect(sanitizeFilenameSegment("\t\n  \r\n")).toBe("untitled");
  });

  it("全 emoji 输入保留原字符", () => {
    expect(sanitizeFilenameSegment("🚀✨💡")).toBe("🚀✨💡");
  });

  it("Windows 保留字符 + 中文混排", () => {
    expect(sanitizeFilenameSegment("方案<v1>设计:第二轮 / 评审")).toBe(
      "方案-v1-设计-第二轮_-_评审",
    );
  });
});
