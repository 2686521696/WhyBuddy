/**
 * TourStage3D — Work 模式 3D 巡演舞台（懒加载分包，四期器官移植）。
 *
 * 纯演出层：只订阅 TourEvent（GameEvent 兼容），不知道运行时存在。
 * 四期：场景与画风整体换成 Agentshire 器官（vendor/agentshire：
 * AssetLoader + OfficeBuilder 房间/家具/灯光配方 + ScreenRenderer 动态
 * 屏幕），角色换 Kenney 卡通小人（自带 idle/walk/pick-up/emote 等 32
 * 剪辑）；白板改画巡演进度（绑真 progress/narration 事件）。
 * 保留：SpotAllocator 站位防重叠、台词气泡/状态泡/名牌、点击出档案卡、
 * 「减少动态效果」偏好（瞬移替代走位、不播过渡——诚实降级）。
 */

import React from "react";
import * as THREE from "three";
import { isMotionReduced } from "../user-prefs";
import type { TourActor, TourStation, TourZone } from "./tour-script";
import type { TourEvent } from "./tour-driver";
import { SpotAllocator } from "./vendor/SpotAllocator";
import { AssetLoader } from "./vendor/agentshire/AssetLoader";
import {
  buildAgentshireOffice,
  type OfficeHandle,
} from "./vendor/agentshire/OfficeBuilder";

export interface TourStageHandle {
  dispatch: (event: TourEvent) => void;
  /** 开演清场：上一轮巡演的状态泡/台词泡/表情/工位屏/白板全部复位 */
  reset: () => void;
}

const WALK_SPEED = 4.2; // 世界单位/秒（房间坐标系 30×25）
// Kenney 小人 A-pose 带臂宽约 1.5（1.7 身高），1.5 间距=胳膊插进邻居
const SPAWN_GAP = 2.2;
const HOME = { x: 15, z: 19 }; // 集结区（访客区旁的空地）
const CHAR_HEIGHT = 1.7; // 角色身高归一化（与桌 0.96/墙 3 比例对齐）
// 台词气泡基准高度；相邻角色同时说话时逐帧纵向错层（气泡宽 2.76）
const SAY_BASE_Y = 2.95;
const SAY_LIFT = 0.95;

/** Kenney 角色剪辑名映射（driver 事件词汇 → 资产剪辑名） */
const ANIM_MAP: Record<string, string> = {
  Idle: "idle",
  Walk: "walk",
  PickUp: "pick-up",
  Interact: "interact-right",
  Victory: "emote-yes",
  Defeat: "emote-no",
};

interface ActorRig {
  group: THREE.Group;
  /** 集结区座次（开演清场时瞬移回位） */
  home: THREE.Vector3;
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  current: THREE.AnimationAction | null;
  target: THREE.Vector3 | null;
  emoji: THREE.Sprite | null;
  status: {
    sprite: THREE.Sprite;
    draw: (text: string | null) => void;
  } | null;
  /** 台词气泡（Agentshire 式深色对话泡，narration 绑 npcId 时冒出） */
  say: {
    sprite: THREE.Sprite;
    draw: (text: string | null) => void;
  } | null;
  sayTimer: ReturnType<typeof setTimeout> | null;
  /** 最近走向的工位（录入/审批时把状态同步到该工位屏幕） */
  stationId: string | null;
}

/** Agentshire 式对话气泡：深色圆角 + 白字两行 + 底部小尖角 */
function makeSaySprite(): {
  sprite: THREE.Sprite;
  draw: (text: string | null) => void;
} {
  const W = 460;
  const H = 150;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );
  sprite.scale.set(2.76, 0.9, 1);
  sprite.visible = false;
  const draw = (text: string | null) => {
    ctx.clearRect(0, 0, W, H);
    if (!text) {
      sprite.visible = false;
      texture.needsUpdate = true;
      return;
    }
    const line1 = text.slice(0, 15);
    const line2 =
      text.length > 15
        ? text.slice(15, 29) + (text.length > 29 ? "…" : "")
        : "";
    ctx.fillStyle = "rgba(24,26,30,0.92)";
    ctx.beginPath();
    ctx.roundRect(10, 8, W - 20, H - 36, 18);
    ctx.fill();
    // 底部小尖角（指向说话人）
    ctx.beginPath();
    ctx.moveTo(W / 2 - 14, H - 28);
    ctx.lineTo(W / 2 + 14, H - 28);
    ctx.lineTo(W / 2, H - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "500 30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (line2) {
      ctx.fillText(line1, W / 2, 44);
      ctx.fillText(line2, W / 2, 84);
    } else {
      ctx.fillText(line1, W / 2, 64);
    }
    sprite.visible = true;
    texture.needsUpdate = true;
  };
  return { sprite, draw };
}

function makeStatusSprite(): {
  sprite: THREE.Sprite;
  draw: (text: string | null) => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 52;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );
  sprite.scale.set(1.15, 0.31, 1);
  sprite.visible = false;
  const draw = (text: string | null) => {
    ctx.clearRect(0, 0, 192, 52);
    if (!text) {
      sprite.visible = false;
      texture.needsUpdate = true;
      return;
    }
    ctx.fillStyle = "rgba(31,35,41,0.88)";
    ctx.beginPath();
    ctx.roundRect(8, 4, 176, 44, 22);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "500 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 6), 96, 27);
    sprite.visible = true;
    texture.needsUpdate = true;
  };
  return { sprite, draw };
}

function emojiSprite(emoji: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "48px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 32, 36);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
    })
  );
  sprite.scale.set(0.7, 0.7, 1);
  return sprite;
}

/** 名字牌：Agentshire 式小号深色药丸（不喧宾夺主） */
function nameSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 56;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "600 26px sans-serif";
  const label = text.slice(0, 10);
  const tw = Math.min(ctx.measureText(label).width + 36, 248);
  ctx.fillStyle = "rgba(24,26,30,0.78)";
  ctx.beginPath();
  ctx.roundRect((256 - tw) / 2, 8, tw, 40, 20);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 29);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
    })
  );
  sprite.scale.set(1.45, 0.32, 1);
  return sprite;
}

/** 白板巡演进度画布（白底马克笔风，贴 Agentshire 白板网格） */
function makeBoardCanvas(): {
  texture: THREE.CanvasTexture;
  draw: (progress: string, narration: string) => void;
} {
  const W = 512;
  const H = 320;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  const draw = (progress: string, narration: string) => {
    ctx.fillStyle = "#fafaf7";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1d4ed8";
    ctx.font = "700 40px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("角色巡演", 28, 62);
    ctx.strokeStyle = "#c9c9c2";
    ctx.beginPath();
    ctx.moveTo(28, 82);
    ctx.lineTo(W - 28, 82);
    ctx.stroke();
    ctx.fillStyle = "#333333";
    ctx.font = "500 30px sans-serif";
    ctx.fillText(progress.slice(0, 16), 28, 136);
    ctx.fillStyle = "#555555";
    ctx.font = "400 26px sans-serif";
    ctx.fillText(narration.slice(0, 17), 28, 196);
    if (narration.length > 17) ctx.fillText(narration.slice(17, 34), 28, 236);
    texture.needsUpdate = true;
  };
  draw("等待开演…", "");
  return { texture, draw };
}

export default function TourStage3D({
  cast,
  stations,
  zones,
  onReady,
  onActorClick,
}: {
  cast: TourActor[];
  stations: TourStation[];
  zones: TourZone[];
  /** 舞台就绪后上交事件入口（父组件把 driver 的事件转发进来） */
  onReady: (handle: TourStageHandle) => void;
  /** 点击角色 → 角色档案卡 */
  onActorClick?: (npcId: string) => void;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [fatal, setFatal] = React.useState<string | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFatal("当前环境不支持 WebGL，无法渲染 3D 巡演舞台");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    // 暖暗环境色（房间是亮岛，画布边缘暗场）
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#37322c");

    // 透视相机（Agentshire 办公室观感：南侧高位俯视北墙白板）
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.position.set(15, 13, 28);
    camera.lookAt(15, 0, 9.5);

    // 基础补光（室内点灯由 OfficeBuilder 配方提供）
    scene.add(new THREE.HemisphereLight("#ffffff", "#8a8378", 0.85));
    const sun = new THREE.DirectionalLight("#fff6e8", 0.9);
    sun.position.set(20, 24, 26);
    scene.add(sun);

    // 白板巡演进度画布（绑真事件：progress + 最近一条 narration）
    const board = makeBoardCanvas();
    let boardProgress = "等待开演…";
    let boardNarration = "";
    const redrawBoard = () => board.draw(boardProgress, boardNarration);

    // Agentshire 器官装配：资产预载 → 办公室 →（同一批资产）角色
    const assets = new AssetLoader();
    let office: OfficeHandle | null = null;
    let disposed = false;

    // 站位防重叠（Agentshire SpotAllocator 直搬）
    const spots = new SpotAllocator();

    // 角色装配（骨架容器先建好，模型资产到位后填充）
    const rigs = new Map<string, ActorRig>();
    const clickables: THREE.Object3D[] = [];

    for (const [i, actor] of cast.entries()) {
      const group = new THREE.Group();
      const home = new THREE.Vector3(
        HOME.x + (i - (cast.length - 1) / 2) * SPAWN_GAP,
        0,
        HOME.z
      );
      group.position.copy(home);
      group.visible = false;
      group.userData.npcId = actor.npcId;
      scene.add(group);
      const status = makeStatusSprite();
      status.sprite.position.set(0, 2.15, 0);
      group.add(status.sprite);
      const say = makeSaySprite();
      say.sprite.position.set(0, SAY_BASE_Y, 0);
      group.add(say.sprite);
      rigs.set(actor.npcId, {
        group,
        home,
        mixer: null,
        clips: [],
        current: null,
        target: null,
        emoji: null,
        status,
        say,
        sayTimer: null,
        stationId: null,
      });
    }

    // 资产预载完成前的事件先排队（office 未建时走位/屏幕都没有落点）
    let stageReady = false;
    const pendingEvents: TourEvent[] = [];

    void assets.preload(["characters", "furniture"]).then(() => {
      if (disposed) return;
      office = buildAgentshireOffice(
        scene,
        assets,
        zones,
        stations,
        board.texture
      );
      redrawBoard();

      for (const actor of cast) {
        const rig = rigs.get(actor.npcId);
        if (!rig) continue;
        const model = assets.getCharacterModel(actor.characterKey);
        if (model) {
          // 身高归一化（Kenney 小人与家具/房间比例对齐）
          const bbox = new THREE.Box3().setFromObject(model);
          const height = bbox.getSize(new THREE.Vector3()).y || 1;
          model.scale.setScalar(CHAR_HEIGHT / height);
          model.traverse(o => {
            o.userData.npcId = actor.npcId;
          });
          rig.group.add(model);
          clickables.push(model);
          rig.clips = assets.getAnimations("characters", actor.characterKey);
          rig.mixer = new THREE.AnimationMixer(model);
          playClip(rig, "Idle");
        } else {
          // 模型加载失败 → 诚实立方体替身（不装作加载成功）
          const stub = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 1.6, 0.4),
            new THREE.MeshStandardMaterial({ color: "#93a4bd" })
          );
          stub.position.y = 0.8;
          stub.userData.npcId = actor.npcId;
          rig.group.add(stub);
          clickables.push(stub);
        }
        const tag = nameSprite(actor.roleId);
        tag.position.set(0, 1.88, 0);
        rig.group.add(tag);
      }

      stageReady = true;
      const pending = pendingEvents.splice(0, pendingEvents.length);
      for (const event of pending) handle.dispatch(event);
    });

    function playClip(rig: ActorRig, name: string, once = false) {
      if (!rig.mixer) return;
      const mapped = ANIM_MAP[name] ?? name;
      const clip =
        rig.clips.find(c => c.name === mapped) ??
        rig.clips.find(c =>
          c.name.toLowerCase().includes(mapped.toLowerCase())
        );
      if (!clip) return;
      const action = rig.mixer.clipAction(clip);
      if (once) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      if (rig.current && rig.current !== action) {
        action.reset();
        if (isMotionReduced()) {
          rig.current.stop();
          action.play();
        } else {
          action.crossFadeFrom(rig.current, 0.25, false).play();
        }
      } else {
        action.reset().play();
      }
      rig.current = action;
    }

    // 工位屏幕状态映射（绑真事件：driver 的 npc_status 驱动 ScreenRenderer）
    const screenFor = (rig: ActorRig, status: string) => {
      if (!rig.stationId || !office) return;
      const st = office.stations.get(rig.stationId);
      const title =
        stations.find(s => s.stationId === rig.stationId)?.title ?? "";
      if (!st) return;
      if (status === "移动中") st.setScreen({ mode: "waiting", label: title });
      else if (status === "录入中" || status === "审批中")
        st.setScreen({ mode: "coding", fileName: `${title}.flow` });
      else if (status === "被拦截") st.setScreen({ mode: "error" });
      else if (status === "完成") st.setScreen({ mode: "done" });
    };

    // 点击角色 → 档案卡（raycaster）
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (ev: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickables, true);
      const npcId = hits[0]?.object?.userData?.npcId as string | undefined;
      if (npcId) onActorClick?.(npcId);
    };
    renderer.domElement.addEventListener("click", onClick);

    // 事件入口（父组件转发 driver 事件）
    const handle: TourStageHandle = {
      reset: () => {
        if (disposed) return;
        pendingEvents.length = 0;
        spots.clear();
        for (const rig of rigs.values()) {
          if (rig.sayTimer) clearTimeout(rig.sayTimer);
          rig.sayTimer = null;
          rig.say?.draw(null);
          rig.status?.draw(null);
          if (rig.emoji) {
            rig.group.remove(rig.emoji);
            rig.emoji = null;
          }
          rig.stationId = null;
          // 瞬移回集结区（清场要看得见：人不归位=没清场）
          rig.target = null;
          rig.group.position.copy(rig.home);
          rig.group.rotation.y = 0;
          playClip(rig, "Idle");
        }
        boardProgress = "开演…";
        boardNarration = "";
        redrawBoard();
        for (const st of stations) {
          office?.stations
            .get(st.stationId)
            ?.setScreen({ mode: "waiting", label: st.title.slice(0, 8) });
        }
      },
      dispatch: event => {
        if (disposed) return;
        if (!stageReady) {
          pendingEvents.push(event);
          return;
        }
        if (event.type === "narration" || event.type === "npc_line") {
          // 台词气泡：narration 绑出演者 / LLM 台词（npc_line）都冒
          // Agentshire 式对话泡，随后自动隐去
          const npcId = event.npcId;
          if (npcId) {
            const rig = rigs.get(npcId);
            if (rig?.say) {
              if (rig.sayTimer) clearTimeout(rig.sayTimer);
              rig.say.draw(event.text);
              rig.sayTimer = setTimeout(
                () => {
                  if (!disposed) rig.say?.draw(null);
                },
                isMotionReduced() ? 2000 : 3800
              );
            }
          }
          if (event.type === "narration") {
            boardNarration = event.text;
            redrawBoard();
          }
          return;
        }
        if (event.type === "progress") {
          boardProgress = `进度 ${event.current}/${event.total} · ${event.label}`;
          redrawBoard();
          return;
        }
        if (event.type === "npc_spawn") {
          const rig = rigs.get(event.npcId);
          if (rig) rig.group.visible = true;
          return;
        }
        if (event.type === "npc_move_to") {
          const rig = rigs.get(event.npcId);
          const station = office?.stations.get(event.stationId);
          if (!rig) return;
          rig.stationId = event.stationId;
          const raw = station
            ? station.approach
            : new THREE.Vector3(HOME.x, 0, HOME.z);
          // 防重叠：同一工位多人停靠时环形让位
          // 间距按角色实际肩宽给：1.75 身高的小人肩宽约 0.9，
          // 1.1 的环形半径等于贴身站（用户实测"重叠"）
          const spot = spots.allocate({ x: raw.x, z: raw.z }, event.npcId, 1.7);
          const dest = new THREE.Vector3(spot.x, 0, spot.z);
          if (isMotionReduced()) {
            rig.group.position.copy(dest);
            rig.group.rotation.y = Math.PI; // 面向工位（北）
            playClip(rig, "Idle");
          } else {
            rig.target = dest;
          }
          return;
        }
        if (event.type === "npc_status") {
          const rig = rigs.get(event.npcId);
          rig?.status?.draw(event.status);
          if (rig && event.status && event.status !== "移动中") {
            screenFor(rig, event.status);
          }
          return;
        }
        if (event.type === "npc_anim") {
          const rig = rigs.get(event.npcId);
          if (!rig) return;
          const once = ["Victory", "PickUp", "Interact", "Defeat"].includes(
            event.anim
          );
          playClip(rig, event.anim, once);
          return;
        }
        if (event.type === "npc_emoji") {
          const rig = rigs.get(event.npcId);
          if (!rig) return;
          if (rig.emoji) {
            rig.group.remove(rig.emoji);
            rig.emoji = null;
          }
          if (event.emoji) {
            const sprite = emojiSprite(event.emoji);
            // 侧上方：不与台词气泡/状态泡叠位
            sprite.position.set(0.6, 2.35, 0);
            rig.group.add(sprite);
            rig.emoji = sprite;
          }
          return;
        }
        if (event.type === "npc_work_done") {
          const rig = rigs.get(event.npcId);
          if (rig)
            playClip(
              rig,
              event.status === "completed" ? "Victory" : "Defeat",
              true
            );
          return;
        }
      },
    };
    onReady(handle);

    // 尺寸自适应
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // 帧循环：走位插值 + 动画混合器 + 工位屏幕打字动画
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      for (const rig of rigs.values()) {
        if (rig.target) {
          const delta = rig.target.clone().sub(rig.group.position);
          delta.y = 0;
          const dist = delta.length();
          if (dist < 0.08) {
            rig.group.position.copy(rig.target);
            rig.target = null;
            rig.group.rotation.y = Math.PI; // 到位后面向工位（北）
            playClip(rig, "Idle");
          } else {
            const stepLen = Math.min(dist, WALK_SPEED * dt);
            rig.group.position.add(delta.normalize().multiplyScalar(stepLen));
            rig.group.rotation.y = Math.atan2(delta.x, delta.z);
          }
        }
        rig.mixer?.update(dt);
      }
      // 台词气泡防叠：相邻角色同时说话（3.8s 自动隐去前的窗口期）时
      // 后到者纵向抬一层——气泡宽 2.76，人距 1.7 时同高必然互压
      const talking: ActorRig[] = [];
      for (const rig of rigs.values()) {
        if (rig.group.visible && rig.say?.sprite.visible) talking.push(rig);
      }
      talking.sort((a, b) => a.group.position.x - b.group.position.x);
      const placedSays: Array<{ x: number; z: number; y: number }> = [];
      for (const rig of talking) {
        const px = rig.group.position.x;
        const pz = rig.group.position.z;
        let y = SAY_BASE_Y;
        let lifted = true;
        while (lifted) {
          lifted = false;
          for (const p of placedSays) {
            if (
              Math.abs(px - p.x) < 3.0 &&
              Math.abs(pz - p.z) < 2.5 &&
              Math.abs(y - p.y) < SAY_LIFT
            ) {
              y = p.y + SAY_LIFT;
              lifted = true;
            }
          }
        }
        rig.say!.sprite.position.y = y;
        placedSays.push({ x: px, z: pz, y });
      }
      office?.updateScreens(dt);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const rig of rigs.values()) {
        if (rig.sayTimer) clearTimeout(rig.sayTimer);
      }
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      office?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose?.();
      });
    };
    // 舞台按 cast/stations/zones 一次装配；变更走整体重挂（父组件 key 控制）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fatal) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-stone-400">
        {fatal}
      </div>
    );
  }
  return <div ref={hostRef} className="h-full w-full" />;
}
