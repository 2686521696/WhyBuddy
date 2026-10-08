/**
 * 脱敏成对判据的 TS 一侧：跟 Python（slide-rule-python/tests/test_errors_reach_one_place_scrubbed.py）读同一份样本。
 * 只改一侧，另一侧这份照样红（error-scrub.ts 头注）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FILTERED, scrubEvent, scrubText } from "./error-scrub";

const SAMPLES = JSON.parse(readFileSync(resolve(__dirname, "scrub-samples.json"), "utf-8")) as {
  texts: Array<{ text: string; secret: string[]; keep: string[] }>;
  headers: Record<string, "secret" | "keep">;
};

describe("脱敏：同一份样本", () => {
  for (const sample of SAMPLES.texts) {
    it(sample.text.slice(0, 40), () => {
      const out = scrubText(sample.text);
      for (const secret of sample.secret) expect(out, secret).not.toContain(secret);
      for (const keep of sample.keep) expect(out, keep).toContain(keep);
    });
  }

  it("头：敏感的整值剥掉，不相干的原样", () => {
    const headers = Object.fromEntries(Object.keys(SAMPLES.headers).map(k => [k, `value-of-${k}`]));
    const out = scrubEvent({ request: { headers, cookies: { a: "b" }, data: { userText: "报价" } } }) as {
      request: { headers: Record<string, string>; cookies?: unknown; data?: unknown };
    };
    for (const [key, kind] of Object.entries(SAMPLES.headers)) {
      if (kind === "secret") expect(out.request.headers[key], key).toBe(FILTERED);
      else expect(out.request.headers[key], key).toBe(`value-of-${key}`);
    }
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.data).toBeUndefined();
  });

  it("脱敏自己出错就不发", () => {
    const hostile = new Proxy({}, { get() { throw new Error("boom"); } });
    expect(scrubEvent(hostile)).toBeNull();
  });
});
