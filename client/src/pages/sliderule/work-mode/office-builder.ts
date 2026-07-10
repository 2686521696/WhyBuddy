/**
 * office-builder — 部门分区办公室场景（Work 模式二期/三期沉浸化）。
 *
 * 结构与手法适配移植自 Agentshire（MIT，commit f54a798）的
 * town-frontend/src/game/scene/OfficeBuilder.ts + ScreenRenderer.ts：
 * 地板/墙体/工位三件套（桌+椅+显示器，显示器屏幕 CanvasTexture 可实时
 * 绘内容）/绿植点缀/灯光。差异：工位按 **RBAC menus 推导的部门区** 分组
 * （schema 真相，非造出来的分组）；家具用仓库已有的 Kenney Furniture Kit
 * （CC0，client/public/kenney_furniture-kit）。
 *
 * 三期（对照 Agentshire 官方演示）：暖木地板 + 奶油墙 + 墙面窗景、
 * 侧墙巡演进度大屏（drawBoard，绑真 progress/narration 事件）、
 * 休息角（沙发/咖啡桌/咖啡机）、书柜/盆栽/垃圾桶环境密度。
 */

import * as THREE from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { TourStation, TourZone } from "./tour-script";

const STATION_GAP = 2.6; // 同区内工位间距
const ZONE_PAD = 1.6; // 区内左右留白
const ZONE_GAP = 1.2; // 区与区之间
const DESK_Z = -3.2; // 工位排深度

const ZONE_COLORS = ["#dbe6f3", "#dcebe0", "#f0e5d3", "#e6ddef", "#dceaee"];

export interface BuiltStation {
  stationId: string;
  /** 桌位中心 */
  position: THREE.Vector3;
  /** NPC 停靠点（桌前） */
  approach: THREE.Vector3;
  /** 实时绘制显示器屏幕内容（ScreenRenderer 手法：CanvasTexture 重绘） */
  drawScreen: (lines: string[]) => void;
}

export interface OfficeLayout {
  stations: Map<string, BuiltStation>;
  /** 工位排总宽（相机取景用——只框工位区，地板留出画面外余量） */
  totalWidth: number;
  /** 侧墙进度大屏（绑真事件：progress/narration 写上去） */
  drawBoard: (lines: string[]) => void;
  dispose: () => void;
}

function makeLabelSprite(
  text: string,
  opts: { width?: number; fontPx?: number; bg?: string; fg?: string } = {}
): THREE.Sprite {
  const {
    width = 256,
    fontPx = 26,
    bg = "rgba(255,255,255,0.92)",
    fg = "#1f2329",
  } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, 64);
  ctx.fillStyle = fg;
  ctx.font = `500 ${fontPx}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 12), width / 2, 33);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
    })
  );
  sprite.scale.set(width / 116, 0.55, 1);
  return sprite;
}

/** 把模型等比缩放到目标宽度（Kenney 件与角色比例对齐） */
function normalizeWidth(obj: THREE.Object3D, targetWidth: number): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const w = Math.max(size.x, 0.001);
  const s = targetWidth / w;
  obj.scale.setScalar(s);
}

const FURNITURE_BASE = "kenney_furniture-kit/Models/GLTF format";

export async function buildOffice(
  scene: THREE.Scene,
  loader: GLTFLoader,
  zones: TourZone[],
  stations: TourStation[],
  baseUrl: string
): Promise<OfficeLayout> {
  const objects: THREE.Object3D[] = [];
  const add = (o: THREE.Object3D) => {
    scene.add(o);
    objects.push(o);
  };

  // 家具模板：加载一次、按工位克隆；失败给诚实几何替身
  const load = (file: string): Promise<THREE.Object3D | null> =>
    new Promise(resolve => {
      loader.load(
        `${baseUrl}${FURNITURE_BASE}/${file}`,
        gltf => resolve(gltf.scene),
        undefined,
        () => resolve(null)
      );
    });
  const [
    deskT,
    chairT,
    screenT,
    plantT,
    bookcaseT,
    sofaT,
    coffeeTableT,
    coffeeMachineT,
    sideTableT,
    rugT,
    pottedT,
    trashT,
  ] = await Promise.all([
    load("desk.glb"),
    load("chairModernCushion.glb"),
    load("computerScreen.glb"),
    load("plantSmall1.glb"),
    load("bookcaseClosedWide.glb"),
    load("loungeSofa.glb"),
    load("tableCoffee.glb"),
    load("kitchenCoffeeMachine.glb"),
    load("sideTable.glb"),
    load("rugRounded.glb"),
    load("pottedPlant.glb"),
    load("trashcan.glb"),
  ]);

  // ── 分区布局计算 ─────────────────────────────────────────────
  const byZone = new Map<string, TourStation[]>();
  for (const z of zones) byZone.set(z.zoneId, []);
  for (const st of stations) {
    (byZone.get(st.zoneId) ?? byZone.set(st.zoneId, []).get(st.zoneId)!).push(
      st
    );
  }
  const zoneWidths = zones.map(z => {
    const n = Math.max(byZone.get(z.zoneId)?.length ?? 0, 1);
    return n * STATION_GAP + ZONE_PAD;
  });
  const totalWidth =
    zoneWidths.reduce((a, b) => a + b, 0) + ZONE_GAP * (zones.length - 1);

  // ── 地板与墙（暖木地板铺出取景外，看不到"世界边缘"）──────────────
  const floorW = Math.max(totalWidth + 7, 22);
  const floorD = 12.5;
  const floorZ = 0.8; // 地板中心（前方留出走位/休息角）
  const wallZ = floorZ - floorD / 2; // 后墙
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(floorW, 0.1, floorD),
    new THREE.MeshStandardMaterial({ color: "#c09468" })
  );
  floor.position.set(0, -0.05, floorZ);
  add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: "#efe6d7" });
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(floorW, 3.4, 0.18),
    wallMat
  );
  backWall.position.set(0, 1.7, wallZ);
  add(backWall);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 3.4, floorD),
      wallMat
    );
    wall.position.set((side * floorW) / 2, 1.7, floorZ);
    add(wall);
  }

  // 后墙窗景（Agentshire 式浅青窗块，环境密度不空墙；中央让位进度大屏）
  const windowMat = new THREE.MeshBasicMaterial({ color: "#bfe0e8" });
  const frameMat = new THREE.MeshStandardMaterial({ color: "#d9cbb4" });
  const winCount = Math.max(2, Math.round(floorW / 6));
  for (let i = 0; i < winCount; i++) {
    const wx = (i - (winCount - 1) / 2) * (floorW / winCount);
    if (Math.abs(wx) < 1.9) continue; // 中央墙面留给进度大屏
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 1.15, 0.06),
      frameMat
    );
    frame.position.set(wx, 1.8, wallZ + 0.12);
    add(frame);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.95), windowMat);
    win.position.set(wx, 1.8, wallZ + 0.17);
    add(win);
  }

  // 后墙中央巡演进度大屏（ScreenRenderer 手法，绑真事件由舞台层写入）
  const boardCanvas = document.createElement("canvas");
  boardCanvas.width = 512;
  boardCanvas.height = 288;
  const boardCtx = boardCanvas.getContext("2d")!;
  const boardTexture = new THREE.CanvasTexture(boardCanvas);
  const drawBoard = (lines: string[]) => {
    boardCtx.fillStyle = "#101722";
    boardCtx.fillRect(0, 0, 512, 288);
    boardCtx.fillStyle = "#39424e";
    boardCtx.fillRect(0, 0, 512, 6);
    boardCtx.textAlign = "left";
    lines.slice(0, 5).forEach((line, li) => {
      boardCtx.fillStyle = li === 0 ? "#8ecbff" : "#dbe6f2";
      boardCtx.font = li === 0 ? "700 34px sans-serif" : "500 26px sans-serif";
      boardCtx.fillText(line.slice(0, 18), 24, 58 + li * 50);
    });
    boardTexture.needsUpdate = true;
  };
  drawBoard(["角色巡演", "等待开演…"]);
  const boardBezel = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 1.42, 0.08),
    new THREE.MeshStandardMaterial({ color: "#20242a" })
  );
  boardBezel.position.set(0, 2.5, wallZ + 0.16);
  add(boardBezel);
  const boardPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.34, 1.28),
    new THREE.MeshBasicMaterial({ map: boardTexture })
  );
  boardPlane.position.set(0, 2.5, wallZ + 0.22);
  add(boardPlane);

  // 休息角（左前，填 iso 视角的前场空地）：沙发 + 咖啡桌 + 咖啡机 + 圆毯
  const loungeX = -totalWidth / 2 + 2.0;
  const loungeZ = floorZ + floorD / 2 - 2.2;
  if (rugT) {
    const rug = rugT.clone(true);
    normalizeWidth(rug, 3.4);
    rug.position.set(loungeX, 0.01, loungeZ);
    add(rug);
  }
  if (sofaT) {
    const sofa = sofaT.clone(true);
    normalizeWidth(sofa, 1.9);
    sofa.position.set(loungeX, 0, loungeZ - 0.8);
    add(sofa);
  }
  if (coffeeTableT) {
    const table = coffeeTableT.clone(true);
    normalizeWidth(table, 1.1);
    table.position.set(loungeX, 0, loungeZ + 0.55);
    add(table);
  }
  if (sideTableT && coffeeMachineT) {
    const side = sideTableT.clone(true);
    normalizeWidth(side, 0.7);
    side.position.set(loungeX + 1.5, 0, loungeZ - 0.8);
    add(side);
    const machine = coffeeMachineT.clone(true);
    normalizeWidth(machine, 0.34);
    machine.position.set(loungeX + 1.5, 0.5, loungeZ - 0.8);
    add(machine);
  }

  // 右前盆栽（与左前休息角对角平衡）
  if (pottedT) {
    const potted = pottedT.clone(true);
    normalizeWidth(potted, 0.7);
    potted.position.set(totalWidth / 2 + 1.2, 0, floorZ + floorD / 2 - 2.0);
    add(potted);
  }

  // ── 部门区 + 工位 ────────────────────────────────────────────
  const built = new Map<string, BuiltStation>();
  let cursorX = -totalWidth / 2;
  zones.forEach((zone, zi) => {
    const zoneW = zoneWidths[zi];
    const centerX = cursorX + zoneW / 2;
    // 区地毯（部门底色，收深不显空）
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(zoneW, 0.06, 5.2),
      new THREE.MeshStandardMaterial({
        color: ZONE_COLORS[zi % ZONE_COLORS.length],
      })
    );
    plate.position.set(centerX, 0.03, DESK_Z + 1.4);
    add(plate);
    // 部门名牌（工位排上方）
    const zoneLabel = makeLabelSprite(zone.label, {
      width: 320,
      fontPx: 32,
      bg: "rgba(22,119,255,0.92)",
      fg: "#ffffff",
    });
    zoneLabel.position.set(centerX, 2.45, DESK_Z - 0.9);
    add(zoneLabel);
    // 靠墙书柜（每区一个，环境密度）
    if (bookcaseT) {
      const bookcase = bookcaseT.clone(true);
      normalizeWidth(bookcase, 1.5);
      bookcase.position.set(centerX, 0, wallZ + 0.55);
      add(bookcase);
    }
    // 区间绿植
    if (zi > 0 && plantT) {
      const plant = plantT.clone(true);
      normalizeWidth(plant, 0.5);
      plant.position.set(cursorX - ZONE_GAP / 2, 0, DESK_Z + 2.6);
      add(plant);
    }

    const zoneStations = byZone.get(zone.zoneId) ?? [];
    zoneStations.forEach((st, si) => {
      const n = zoneStations.length;
      const x = centerX + (si - (n - 1) / 2) * STATION_GAP;
      const pos = new THREE.Vector3(x, 0, DESK_Z);

      // 桌
      if (deskT) {
        const desk = deskT.clone(true);
        normalizeWidth(desk, 1.7);
        desk.position.set(x, 0, DESK_Z);
        add(desk);
      } else {
        const stub = new THREE.Mesh(
          new THREE.BoxGeometry(1.7, 0.72, 0.8),
          new THREE.MeshStandardMaterial({ color: "#ffffff" })
        );
        stub.position.set(x, 0.36, DESK_Z);
        add(stub);
      }
      // 椅（桌前，朝桌）
      if (chairT) {
        const chair = chairT.clone(true);
        normalizeWidth(chair, 0.62);
        chair.position.set(x, 0, DESK_Z + 0.95);
        chair.rotation.y = Math.PI;
        add(chair);
      }
      // 工位尽头垃圾桶（每区最后一位）
      if (trashT && si === n - 1) {
        const trash = trashT.clone(true);
        normalizeWidth(trash, 0.3);
        trash.position.set(x + STATION_GAP / 2 - 0.35, 0, DESK_Z + 0.4);
        add(trash);
      }
      // 显示器 + 可绘屏幕（ScreenRenderer 手法）
      const screenCanvas = document.createElement("canvas");
      screenCanvas.width = 256;
      screenCanvas.height = 160;
      const screenCtx = screenCanvas.getContext("2d")!;
      const screenTexture = new THREE.CanvasTexture(screenCanvas);
      const drawScreen = (lines: string[]) => {
        screenCtx.fillStyle = "#0f1520";
        screenCtx.fillRect(0, 0, 256, 160);
        screenCtx.fillStyle = "#8ecbff";
        screenCtx.font = "600 22px sans-serif";
        screenCtx.textAlign = "left";
        lines.slice(0, 4).forEach((line, li) => {
          screenCtx.fillText(line.slice(0, 14), 14, 36 + li * 34);
        });
        screenTexture.needsUpdate = true;
      };
      drawScreen([st.title]);
      if (screenT) {
        const monitor = screenT.clone(true);
        normalizeWidth(monitor, 0.72);
        monitor.position.set(x, 0.74, DESK_Z - 0.12);
        monitor.rotation.y = Math.PI;
        add(monitor);
      }
      const screenPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.4),
        new THREE.MeshBasicMaterial({ map: screenTexture })
      );
      screenPlane.position.set(x, 1.06, DESK_Z + 0.02);
      add(screenPlane);
      built.set(st.stationId, {
        stationId: st.stationId,
        position: pos,
        approach: new THREE.Vector3(x, 0, DESK_Z + 1.55),
        drawScreen,
      });
    });

    cursorX += zoneW + ZONE_GAP;
  });

  return {
    stations: built,
    totalWidth,
    drawBoard,
    dispose: () => {
      for (const o of objects) {
        scene.remove(o);
        o.traverse(child => {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose?.();
        });
      }
    },
  };
}
