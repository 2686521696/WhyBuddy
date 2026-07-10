/**
 * office-builder — 部门分区办公室场景（Work 模式二期）。
 *
 * 结构与手法适配移植自 Agentshire（MIT，commit f54a798）的
 * town-frontend/src/game/scene/OfficeBuilder.ts + ScreenRenderer.ts：
 * 地板/墙体/工位三件套（桌+椅+显示器，显示器屏幕 CanvasTexture 可实时
 * 绘内容）/绿植点缀/灯光。差异：工位按 **RBAC menus 推导的部门区** 分组
 * （schema 真相，非造出来的分组）；家具用仓库已有的 Kenney Furniture Kit
 * （CC0，client/public/kenney_furniture-kit）。
 */

import * as THREE from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { TourStation, TourZone } from "./tour-script";

const STATION_GAP = 2.6; // 同区内工位间距
const ZONE_PAD = 1.6; // 区内左右留白
const ZONE_GAP = 1.2; // 区与区之间
const DESK_Z = -3.2; // 工位排深度

const ZONE_COLORS = ["#e8eef7", "#e9f4ec", "#f6efe6", "#efe9f5", "#e9f2f4"];

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
  /** 场景总宽（相机取景用） */
  totalWidth: number;
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
  const [deskT, chairT, screenT, plantT] = await Promise.all([
    load("desk.glb"),
    load("chairModernCushion.glb"),
    load("computerScreen.glb"),
    load("plantSmall1.glb"),
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

  // ── 地板与墙 ────────────────────────────────────────────────
  const floorW = Math.max(totalWidth + 6, 16);
  const floorD = 14;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(floorW, 0.1, floorD),
    new THREE.MeshStandardMaterial({ color: "#f1ede5" })
  );
  floor.position.set(0, -0.05, 0.6);
  add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: "#f7f4ee" });
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(floorW, 3.2, 0.18),
    wallMat
  );
  backWall.position.set(0, 1.6, 0.6 - floorD / 2);
  add(backWall);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 3.2, floorD),
      wallMat
    );
    wall.position.set((side * floorW) / 2, 1.6, 0.6);
    add(wall);
  }

  // ── 部门区 + 工位 ────────────────────────────────────────────
  const built = new Map<string, BuiltStation>();
  let cursorX = -totalWidth / 2;
  zones.forEach((zone, zi) => {
    const zoneW = zoneWidths[zi];
    const centerX = cursorX + zoneW / 2;
    // 区地毯（部门底色）
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(zoneW, 0.06, 7.4),
      new THREE.MeshStandardMaterial({
        color: ZONE_COLORS[zi % ZONE_COLORS.length],
      })
    );
    plate.position.set(centerX, 0.03, DESK_Z + 1.7);
    add(plate);
    // 部门名牌（墙上）
    const zoneLabel = makeLabelSprite(zone.label, {
      width: 320,
      fontPx: 32,
      bg: "rgba(22,119,255,0.92)",
      fg: "#ffffff",
    });
    zoneLabel.position.set(centerX, 2.55, DESK_Z - 1.6);
    add(zoneLabel);
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
    totalWidth: floorW,
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
