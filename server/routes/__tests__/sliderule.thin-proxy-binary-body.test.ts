/**
 * 兜底薄代理转发二进制请求体：Python 收到的必须是浏览器发的原样字节。
 *
 * ⚠ 2026-10-10 用户截图：线上输入框里挂一张 PNG（面团AI渐变星球标志.png），文件卡写「解析失败」。
 *   同一时刻同一张图：本地直接调 extract_image 3 秒认出来；线上 /api/sliderule/attachments/extract
 *   回「视觉 LLM 提取失败：HTTP 400: The image data you provided does not represent a valid image」（换个时候是 502）。
 *   成因在这里：线上（Docker）浏览器 → Caddy → Node(app:3001) → 本文件末尾的兜底代理 → Python；
 *   全局只挂了 express.json / urlencoded，application/octet-stream 没有解析器，req.body 是 {}，
 *   代理照 `JSON.stringify(req.body ?? {})` 转——Python 收到的「图片」是两个字节 `{}`。
 *   本地开发时 vite 直接把 /api/sliderule 代理到 Python，不走这层，所以本地一直好的、判据也一直绿。
 *   会话上传（/sessions/:id/uploads，同样是 octet-stream）走的是同一条路。
 *
 * 全局解析器照 server/index.ts 原样挂（json 带 verify、urlencoded），后面接一个假 Python，记下它收到的字节。
 * 变异（逐条实测过）：兜底代理改回无条件 JSON.stringify(req.body) → 第一、二条红；
 *   读到空流不退回 JSON（直接转空字节）→ 第三、四条红。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const upstream = vi.hoisted(() => ({ port: 0 }));
vi.mock("../../sliderule/python-delegation.js", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolvePythonSlideRuleRuntimeConfig: vi.fn(() => ({
    baseUrl: `http://127.0.0.1:${upstream.port}`,
    internalKey: "dev-slide-rule-internal",
    timeoutMs: 120000,
    healthPath: "/health",
    proxyMode: "node-fetch-env",
  })),
}));

type Received = { url: string; contentType: string; body: Buffer };
const received: Received[] = [];
let python: Server;
let app: Server;
let base = "";

function listen(server: Server): Promise<number> {
  return new Promise(resolvePort => server.listen(0, () => {
    const address = server.address();
    resolvePort(typeof address === "object" && address ? address.port : 0);
  }));
}

beforeAll(async () => {
  python = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      received.push({ url: req.url || "", contentType: String(req.headers["content-type"] || ""), body: Buffer.concat(chunks) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  upstream.port = await listen(python);
  const { default: slideruleRouter } = await import("../sliderule.js");
  const server = express();
  // 跟 server/index.ts 的 startServer 一样的两层全局解析器
  server.use(express.json({ limit: "10mb", verify: (request, _response, buffer) => {
    (request as { rawBody?: string }).rawBody = buffer.toString("utf8");
  } }));
  server.use(express.urlencoded({ extended: true }));
  server.use("/api/sliderule", slideruleRouter);
  app = createServer(server);
  base = `http://127.0.0.1:${await listen(app)}/api/sliderule`;
});

afterAll(async () => {
  await new Promise<void>(done => app.close(() => done()));
  await new Promise<void>(done => python.close(() => done()));
});

async function post(path: string, body: BodyInit | undefined, contentType?: string) {
  received.length = 0;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: contentType ? { "Content-Type": contentType } : {},
    body,
  });
  expect(res.status).toBe(200);
  expect(received).toHaveLength(1);
  return received[0];
}

// 跟用户那张同类：仓里的品牌标志（PNG，含 0x00/0x89 等非 UTF-8 字节）
const PNG = readFileSync(resolve(process.cwd(), "client/public/miantuan-mark-512.png"));

describe("兜底薄代理：二进制请求体原样到 Python", () => {
  it("输入框附件解析：PNG 一个字节不差地到 /attachments/extract", async () => {
    const got = await post(`/attachments/extract?name=${encodeURIComponent("面团AI渐变星球标志.png")}`,
      PNG, "application/octet-stream");
    expect(got.url).toContain("/api/sliderule/attachments/extract?name=");
    expect(got.contentType).toBe("application/octet-stream");
    expect(got.body.length).toBe(PNG.length);
    expect(got.body.equals(PNG)).toBe(true);
  });

  it("会话上传（同一条路）：原件原样到 /sessions/:id/uploads", async () => {
    const got = await post("/sessions/sr-1/uploads?name=logo.png", PNG, "application/octet-stream");
    expect(got.body.equals(PNG)).toBe(true);
  });

  it("反向：JSON 请求照旧（流已被 express.json 读完，退回转 JSON），内容不丢", async () => {
    const got = await post("/prompt-refine", JSON.stringify({ text: "做一个记账小网页" }), "application/json");
    expect(JSON.parse(got.body.toString("utf8"))).toEqual({ text: "做一个记账小网页" });
  });

  it("反向：没有正文的 POST 照旧给 Python 一个 {}（有的接口签名要 payload）", async () => {
    const got = await post("/control-runs/ctr-1/cancel", undefined);
    expect(got.body.toString("utf8")).toBe("{}");
  });
});
