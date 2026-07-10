/**
 * ScreenRenderer — 工位显示器动态屏幕（打字机代码/等待/完成/报错）。
 *
 * 逐字搬运自 Agentshire（MIT，https://github.com/xiaojilele-glitch/agentshire
 * commit f54a798）town-frontend/src/game/scene/ScreenRenderer.ts。
 * 改动仅两处：i18n t() 换成内联中文；ScreenState 类型内联（原在
 * data/GameProtocol.ts）。
 */

import * as THREE from "three";

export type ScreenState =
  | { mode: "off" }
  | { mode: "waiting"; label?: string }
  | { mode: "thinking" }
  | { mode: "coding"; fileName: string }
  | { mode: "done" }
  | { mode: "error" };

const W = 256;
const H = 160;
const BG = "#0d1117";
const CODE_COLORS = [
  "#79c0ff",
  "#ff7b72",
  "#d2a8ff",
  "#7ee787",
  "#ffa657",
  "#a5d6ff",
];

const FAKE_CODE = [
  'import { Engine } from "./core"',
  "const app = new Engine()",
  "",
  "function update(dt: number) {",
  "  world.step(dt)",
  "  renderer.render(scene)",
  "}",
  "",
  'app.on("ready", () => {',
  "  loadAssets(manifest)",
  "  initPhysics()",
  "  startLoop(update)",
  "})",
  "",
  "export default app",
];

export class ScreenRenderer {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private state: ScreenState = { mode: "off" };
  private elapsed = 0;
  private codeLine = 0;
  private codeCharIdx = 0;
  private cursorBlink = 0;

  constructor() {
    if (typeof OffscreenCanvas !== "undefined") {
      this.canvas = new OffscreenCanvas(W, H);
      this.ctx = this.canvas.getContext(
        "2d"
      )! as OffscreenCanvasRenderingContext2D;
    } else {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      this.canvas = c;
      this.ctx = c.getContext("2d")!;
    }
    this.texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.renderOff();
  }

  getTexture(): THREE.CanvasTexture {
    return this.texture;
  }

  setState(state: ScreenState): void {
    const sameMode = state.mode === this.state.mode;
    if (
      sameMode &&
      (state.mode !== "coding" ||
        (state as { fileName: string }).fileName ===
          (this.state as { fileName: string }).fileName)
    )
      return;
    this.state = state;
    this.elapsed = 0;
    this.codeLine = 0;
    this.codeCharIdx = 0;
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.cursorBlink += dt;

    switch (this.state.mode) {
      case "off":
        this.renderOff();
        break;
      case "waiting":
        this.renderWaiting();
        break;
      case "thinking":
        this.renderThinking();
        break;
      case "coding":
        this.renderCoding();
        break;
      case "done":
        this.renderDone();
        break;
      case "error":
        this.renderError();
        break;
    }
    this.texture.needsUpdate = true;
  }

  private renderOff(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#080808";
    ctx.fillRect(0, 0, W, H);
    if (Math.sin(this.cursorBlink * 2) > 0) {
      ctx.fillStyle = "#333333";
      ctx.fillRect(10, H - 20, 8, 12);
    }
  }

  private renderWaiting(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#0a0e2a";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#5577aa";
    ctx.font = "16px monospace";
    ctx.textAlign = "center";
    const label = ("label" in this.state && this.state.label) || "待命中";
    ctx.fillText(label, W / 2, H / 2 - 10);

    const cx = W / 2,
      cy = H / 2 + 20,
      r = 12;
    ctx.strokeStyle = "#334466";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#6699cc";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const start = this.elapsed * 3;
    ctx.arc(cx, cy, r, start, start + Math.PI * 0.7);
    ctx.stroke();
    ctx.textAlign = "left";
  }

  private renderThinking(): void {
    const ctx = this.ctx;
    const pulse = 0.3 + 0.15 * Math.sin(this.elapsed * 4);
    ctx.fillStyle = `rgba(15, 15, 30, 1)`;
    ctx.fillRect(0, 0, W, H);

    const grd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 80);
    grd.addColorStop(0, `rgba(80, 80, 40, ${pulse})`);
    grd.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#888855";
    ctx.font = "13px monospace";
    ctx.textAlign = "center";
    const dots = ".".repeat(1 + (Math.floor(this.elapsed * 2) % 4));
    ctx.fillText("分析中" + dots, W / 2, H / 2);
    ctx.textAlign = "left";
  }

  private renderCoding(): void {
    const ctx = this.ctx;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const fileName =
      (this.state as { mode: "coding"; fileName: string }).fileName ||
      "index.ts";
    ctx.fillStyle = "#1c2028";
    ctx.fillRect(0, 0, W, 18);
    ctx.fillStyle = "#8b949e";
    ctx.font = "10px monospace";
    ctx.fillText("  " + fileName, 4, 13);

    const lineH = 13;
    const startY = 24;
    const targetLine = Math.min(Math.floor(this.elapsed * 3), FAKE_CODE.length);

    if (this.codeLine < targetLine) {
      this.codeLine = targetLine;
      this.codeCharIdx = 0;
    }

    for (let i = 0; i < Math.min(this.codeLine, FAKE_CODE.length); i++) {
      const y = startY + i * lineH;
      if (y > H - 5) break;
      ctx.fillStyle = "#484f58";
      ctx.font = "9px monospace";
      ctx.fillText(String(i + 1).padStart(3), 4, y);
      ctx.fillStyle = CODE_COLORS[i % CODE_COLORS.length];
      ctx.font = "10px monospace";
      ctx.fillText(FAKE_CODE[i], 30, y);
    }

    if (this.codeLine < FAKE_CODE.length) {
      const y = startY + this.codeLine * lineH;
      if (y <= H - 5) {
        const line = FAKE_CODE[this.codeLine] || "";
        this.codeCharIdx = Math.min(this.codeCharIdx + 1, line.length);
        ctx.fillStyle = "#484f58";
        ctx.font = "9px monospace";
        ctx.fillText(String(this.codeLine + 1).padStart(3), 4, y);
        ctx.fillStyle = CODE_COLORS[this.codeLine % CODE_COLORS.length];
        ctx.font = "10px monospace";
        ctx.fillText(line.slice(0, this.codeCharIdx), 30, y);

        if (Math.sin(this.cursorBlink * 5) > 0) {
          const cx = 30 + this.codeCharIdx * 6;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(cx, y - 10, 6, 12);
        }
      }
    }
  }

  private renderDone(): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#0a1a0a";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#44ff44";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 20, H / 2);
    ctx.lineTo(W / 2 - 5, H / 2 + 15);
    ctx.lineTo(W / 2 + 20, H / 2 - 15);
    ctx.stroke();

    ctx.fillStyle = "#44ff44";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("BUILD SUCCESS", W / 2, H / 2 + 40);
    ctx.textAlign = "left";
  }

  private renderError(): void {
    const ctx = this.ctx;
    const flash = Math.sin(this.elapsed * 6) > 0 ? "#2a0a0a" : "#1a0505";
    ctx.fillStyle = flash;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 15, H / 2 - 15);
    ctx.lineTo(W / 2 + 15, H / 2 + 15);
    ctx.moveTo(W / 2 + 15, H / 2 - 15);
    ctx.lineTo(W / 2 - 15, H / 2 + 15);
    ctx.stroke();

    ctx.fillStyle = "#ff4444";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ERROR", W / 2, H / 2 + 35);
    ctx.textAlign = "left";
  }

  dispose(): void {
    this.texture.dispose();
  }
}
