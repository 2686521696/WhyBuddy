/**
 * OfficeBuilder — Agentshire 办公室场景（地板/墙体/窗/白板/工位/访客区/装饰/灯光）。
 *
 * 适配移植自 Agentshire（MIT，https://github.com/xiaojilele-glitch/agentshire
 * commit f54a798）town-frontend/src/game/scene/OfficeBuilder.ts。
 * 房间结构、家具坐标、灯光配方逐字保留；差异两处（SlideRule 语义）：
 *   1. 工位不再是固定 10 席，按五系统 model 推导的 stations/zones 参数化
 *      生成（部门连片 + 蓝色部门牌，RBAC menus 是 schema 真相）；
 *   2. 白板不接原项目后端轮询（WhiteboardRenderer 不搬），改由调用方传入
 *      CanvasTexture（巡演进度板，绑真 progress/narration 事件）。
 */

import * as THREE from "three";
import type { TourStation, TourZone } from "../../tour-script";
import { AssetLoader } from "./AssetLoader";
import { ScreenRenderer, type ScreenState } from "./ScreenRenderer";

export interface BuiltStation {
  stationId: string;
  /** NPC 停靠点（椅后站位） */
  approach: THREE.Vector3;
  setScreen: (state: ScreenState) => void;
}

export interface OfficeHandle {
  stations: Map<string, BuiltStation>;
  /** 房间中心（相机取景基准；房间固定 30×25） */
  center: THREE.Vector3;
  /** 每帧推进（显示器打字动画） */
  updateScreens: (dt: number) => void;
  dispose: () => void;
}

const ROOM_W = 30;
const ROOM_D = 25;

function makeZoneLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(22,119,255,0.92)";
  ctx.fillRect(0, 0, 320, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "500 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 12), 160, 33);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
    })
  );
  sprite.scale.set(2.76, 0.55, 1);
  return sprite;
}

export function buildAgentshireOffice(
  scene: THREE.Scene,
  assets: AssetLoader,
  zones: TourZone[],
  stations: TourStation[],
  boardTexture: THREE.CanvasTexture
): OfficeHandle {
  const objects: THREE.Object3D[] = [];
  const screenRenderers: ScreenRenderer[] = [];
  const add = (o: THREE.Object3D) => {
    scene.add(o);
    objects.push(o);
  };

  const box = (
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color })
    );
    mesh.position.set(x, y, z);
    add(mesh);
    return mesh;
  };

  const placeModel = (
    key: string,
    x: number,
    y: number,
    z: number,
    scale = 1.0,
    rotationY = 0
  ): THREE.Group | null => {
    const model = assets.getFurnitureModel(key);
    if (!model) return null;
    model.position.set(x, y, z);
    model.scale.setScalar(scale);
    if (rotationY !== 0) model.rotation.y = rotationY;
    add(model);
    return model;
  };

  // ── 地板（原坐标系：x 0..30，z 0..25，北墙 z=0）────────────────
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    new THREE.MeshStandardMaterial({ color: 0xc4a882 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(15, 0, 12.5);
  add(floor);

  // ── 墙体 + 窗 + 门框 ─────────────────────────────────────────
  const c = 0xf0ebe0;
  const h = 3;
  const t = 0.2;
  box(30, h, t, c, 15, h / 2, 0);
  box(13.5, h, t, c, 6.75, h / 2, 25);
  box(13.5, h, t, c, 23.25, h / 2, 25);
  box(t, h, 25, c, 0, h / 2, 12.5);
  box(t, h, 25, c, 30, h / 2, 12.5);
  for (const wx of [5, 15, 25]) {
    box(2, 1.2, 0.05, 0x87ceeb, wx, 1.8, 0.15);
  }
  box(0.15, h, t, 0xb89068, 13.5, h / 2, 25);
  box(0.15, h, t, 0xb89068, 16.5, h / 2, 25);
  box(3, 0.15, t, 0xb89068, 15, h, 25);

  // ── 设备角（书 + 柜 + 打印机替身 + 仙人掌）──────────────────────
  if (!placeModel("cabinet_medium", 25, 0, 1.5)) {
    box(1.2, 0.6, 0.8, 0x888888, 25, 0.3, 1.5);
    box(1.0, 0.1, 0.6, 0x444444, 25, 0.65, 1.5);
  }
  placeModel("book_set", 25, 0.65, 1.5);
  placeModel("book_single", 25.4, 0.65, 1.5);
  if (!placeModel("cactus_medium_A", 2, 0, 1.5, 2)) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.3, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b4513 })
    );
    pot.position.set(2, 0.2, 1.5);
    add(pot);
  }
  if (!placeModel("cabinet_small", 28, 0, 1.5)) {
    box(1.2, 0.75, 0.6, 0xd4a56a, 28, 0.375, 1.5);
  }

  // ── 白板（北墙中央）：贴调用方的巡演进度画布 ─────────────────────
  const wbMesh = new THREE.Mesh(
    new THREE.BoxGeometry(4.0, 2.5, 0.1),
    new THREE.MeshBasicMaterial({ map: boardTexture, color: 0xd0d0d0 })
  );
  wbMesh.position.set(15, 1.6, 0.25);
  add(wbMesh);
  box(4.16, 0.08, 0.12, 0x444444, 15, 2.89, 0.25);
  box(4.16, 0.08, 0.12, 0x444444, 15, 0.31, 0.25);
  box(0.08, 2.5, 0.12, 0x444444, 12.96, 1.6, 0.25);
  box(0.08, 2.5, 0.12, 0x444444, 17.04, 1.6, 0.25);

  // ── 工位（参数化：部门连片，行距/间距沿用原 5 席网格节奏）─────────
  const built = new Map<string, BuiltStation>();
  const ordered: TourStation[] = [];
  for (const z of zones) {
    for (const st of stations) if (st.zoneId === z.zoneId) ordered.push(st);
  }
  for (const st of stations) if (!ordered.includes(st)) ordered.push(st);

  const n = ordered.length;
  const perRow = n <= 5 ? n : Math.ceil(n / 2);
  const gap = perRow <= 5 ? 5 : Math.max(3, 25 / (perRow - 1));
  const rowZ = (row: number) => (n <= 5 ? 10 : row === 0 ? 8 : 16);

  const slotOf = (i: number): { x: number; z: number } => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const rowCount = Math.min(perRow, n - row * perRow);
    const x = 15 + (col - (rowCount - 1) / 2) * gap;
    return { x, z: rowZ(row) };
  };

  ordered.forEach((st, i) => {
    const { x, z } = slotOf(i);

    if (!placeModel("table_medium", x, 0, z, 1.2)) {
      box(2, 0.8, 1, 0xd4a56a, x, 0.4, z);
    }
    // 键盘 + 显示器支架
    box(0.4, 0.04, 0.25, 0x333333, x, 1.4, z - 0.3);
    box(0.08, 0.25, 0.08, 0x444444, x, 1.55, z - 0.3);

    // 动态屏幕（ScreenRenderer：打字机代码/等待/完成/报错）
    const sr = new ScreenRenderer();
    screenRenderers.push(sr);
    const screenMaterial = new THREE.MeshBasicMaterial({
      map: sr.getTexture(),
    });
    const monitorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.5, 0.05),
      screenMaterial
    );
    monitorMesh.position.set(x, 1.8, z - 0.3);
    add(monitorMesh);
    box(0.84, 0.54, 0.04, 0x222222, x, 1.8, z - 0.32);
    sr.setState({ mode: "waiting", label: st.title.slice(0, 8) });

    if (!placeModel("chair_A", x, 0, z + 1)) {
      box(0.5, 0.5, 0.06, 0x333333, x, 0.75, z + 1.28);
    }

    built.set(st.stationId, {
      stationId: st.stationId,
      // 停靠点离桌远一点：z+1.7 会踩进椅子（用户实测人椅穿模）
      approach: new THREE.Vector3(x, 0, z + 2.15),
      setScreen: state => sr.setState(state),
    });
  });

  // 部门牌：按「区 × 排」分组，各自贴在本排工位簇正上方——双排布局时
  // 一个区可能跨排，单块牌子取整区均值会悬空在过道上（用户实测）
  const zoneRowGroups = new Map<string, number[]>();
  for (const zone of zones) {
    ordered.forEach((st, i) => {
      if (st.zoneId !== zone.zoneId) return;
      const key = `${zone.zoneId}|${slotOf(i).z}`;
      (zoneRowGroups.get(key) ?? zoneRowGroups.set(key, []).get(key)!).push(i);
    });
  }
  for (const [key, idxs] of zoneRowGroups) {
    const zoneId = key.split("|")[0];
    const zone = zones.find(z => z.zoneId === zoneId);
    if (!zone || idxs.length === 0) continue;
    const xs = idxs.map(i => slotOf(i).x);
    const rowZ = slotOf(idxs[0]).z;
    const label = makeZoneLabel(zone.label);
    label.position.set(
      xs.reduce((a, b) => a + b, 0) / xs.length,
      2.35,
      rowZ - 1.0
    );
    add(label);
  }

  // ── 访客区（沙发 + 矮桌 + 单椅 + 地毯）─────────────────────────
  if (!placeModel("couch_pillows", 3, 0, 23, 1.2, Math.PI)) {
    box(3, 0.45, 1, 0x4a6fa5, 3, 0.225, 23);
  }
  if (!placeModel("table_low", 3, 0, 21)) {
    box(1.5, 0.05, 0.8, 0xd4a56a, 3, 0.38, 21);
  }
  placeModel("armchair_pillows", 5.5, 0, 21, 1, -Math.PI / 2);
  placeModel("rug_rectangle_A", 4, 0.01, 22, 2);

  // ── 装饰（台灯/挂画/书柜/边柜/仙人掌，坐标逐字保留）───────────────
  placeModel("lamp_standing", 1, 0, 24);
  placeModel("lamp_standing", 29, 0, 24);
  placeModel("pictureframe_large_A", 7, 1.5, 0.15, 1, 0);
  placeModel("pictureframe_large_A", 22, 1.5, 0.15, 1, 0);
  placeModel("shelf_A_big", 0.6, 0, 5, 1, Math.PI / 2);
  placeModel("cabinet_medium_decorated", 0.6, 0, 8, 1, Math.PI / 2);
  placeModel("cactus_small_A", 0.8, 0, 11, 1.5);
  placeModel("lamp_standing", 0.8, 0, 14);
  placeModel("pictureframe_medium", 0.15, 1.5, 6, 1, Math.PI / 2);
  placeModel("pictureframe_medium", 0.15, 1.5, 13, 1, Math.PI / 2);
  placeModel("cabinet_medium_decorated", 29.4, 0, 5, 1, -Math.PI / 2);
  placeModel("book_set", 29.2, 0.65, 5.3);
  placeModel("armchair", 29, 0, 12, 1, -Math.PI / 2);
  placeModel("cactus_small_A", 29.2, 0, 15, 1.5);
  placeModel("book_set", 29.3, 0.55, 5);
  placeModel("pictureframe_large_B", 29.85, 1.5, 10, 1, -Math.PI / 2);
  placeModel("pictureframe_medium", 29.85, 1.5, 15, 1, -Math.PI / 2);

  // ── 灯光（原配方：暖白环境光 + 三盏顶灯）────────────────────────
  const ambient = new THREE.AmbientLight(0xfff5e8, 0.7);
  add(ambient);
  for (const [lx, lz, intensity] of [
    [8, 8, 1.2],
    [20, 8, 1.2],
    [14, 18, 1.0],
  ] as const) {
    const light = new THREE.PointLight(0xfff5e8, intensity, 30);
    light.position.set(lx, 2.8, lz);
    add(light);
  }

  return {
    stations: built,
    center: new THREE.Vector3(15, 0, 12.5),
    updateScreens: dt => {
      for (const sr of screenRenderers) sr.update(dt);
    },
    dispose: () => {
      for (const sr of screenRenderers) sr.dispose();
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
