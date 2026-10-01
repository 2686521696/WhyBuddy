import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enqueueOfficeRender } from "../project-runtime/OfficeThumbnail";

/**
 * ⚠ 2026-10-01 隔离真机「我的应用」文件栏：同屏 6 份 Word 一起画，4 份停在 loading 30 秒以上；同一份单独画一下就好。
 *   Word 排队画；排队的每一张有超时，一份卡死的不许把后面整队堵住；被卸载的那张不占队。
 */
describe("Word 缩略图排队画", () => {
  it("一次只画一份", async () => {
    let running = 0;
    let peak = 0;
    const job = () => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 5));
      running -= 1;
      return "ok";
    };
    const signal = new AbortController().signal;
    const done = await Promise.all([1, 2, 3, 4].map(() => enqueueOfficeRender(job(), signal)));
    expect(done).toEqual(["ok", "ok", "ok", "ok"]);
    expect(peak).toBe(1);
  });

  it("卡死的那一张超时放行，后面的照画", async () => {
    const signal = new AbortController().signal;
    const stuck = enqueueOfficeRender(() => new Promise<string>(() => {}), signal, 20);
    const next = enqueueOfficeRender(async () => "drawn", signal, 20);
    await expect(stuck).rejects.toThrow("office_render_timeout");
    await expect(next).resolves.toBe("drawn");
  });

  it("排队时被卸载的那张不画", async () => {
    const ac = new AbortController();
    let ran = false;
    const blocker = enqueueOfficeRender(() => new Promise(r => setTimeout(r, 10)), new AbortController().signal);
    const gone = enqueueOfficeRender(async () => { ran = true; }, ac.signal);
    ac.abort();
    await blocker;
    await expect(gone).rejects.toThrow();
    expect(ran).toBe(false);
  });

  it("接在链路上：只有 Word 进队，PPT / Excel 照旧直接画", () => {
    const src = readFileSync(new URL("../project-runtime/OfficeThumbnail.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/name\.endsWith\("\.docx"\) \? enqueueOfficeRender\(draw, ac\.signal\) : draw\(\)/);
  });
});
