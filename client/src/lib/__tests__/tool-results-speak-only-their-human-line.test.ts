/**
 * 工具回执只把 human 念给用户；summary / available 是给模型和日志的（sliderule-marathon-driver 那段头注）。
 *
 * ⚠ 2026-10-08 sr-20261008133007-7R99SM9WXK：文件清单、证据检索给模型的提醒、记忆召回的笔记、待办清单都被念成了模型发言。
 * 回执形状照 Python 侧原样（rehearsal_control：skill_file_not_found / search_evidence / recall / todo_write）。
 */
import { describe, expect, it } from "vitest";
import { consumeControlStreamResponse } from "../sliderule-marathon-driver";

const RUN = "ctr-x";
async function spoken(results: Array<Record<string, unknown>>): Promise<string[]> {
  const said: string[] = [];
  const events = [
    ...results.map((r, i) => ({ type: "control_tool_result", controlRunId: RUN, seq: i + 1, ...r })),
    { type: "complete", controlRunId: RUN, seq: results.length + 1, state: { sessionId: "s" } },
  ];
  const body = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("");
  await consumeControlStreamResponse(new Response(body), { onControlText: (t: string) => said.push(t) } as never);
  return said;
}

describe("工具回执念给用户的只有 human", () => {
  it("给模型的 summary / available 不念", async () => {
    const said = await spoken([
      { tool: "skill", ok: false, error: "skill_file_not_found", file: "standards/structure/docx-structure.md",
        available: "包里有：scripts/office/schemas/ISO-IEC29500-4_2016/wml.xsd、…", human: "「office-skills」包里没有 standards/structure/docx-structure.md，换一份读。" },
      { tool: "search_evidence", ok: false, outcome: "failed",
        summary: "证据检索失败（外部检索不可用）。这一轮**没有**外部证据——不是「查过了、没有」，是没查成。" },
      { tool: "recall", ok: true, count: 2, summary: "- 用户偏好深色主题\n- 公司叫面团" },
      { tool: "todo_write", ok: true, count: 1, summary: "◐ t1: 读取 DOCX 规范" },
    ]);
    expect(said).toEqual(["「office-skills」包里没有 standards/structure/docx-structure.md，换一份读。"]);
  });
});
