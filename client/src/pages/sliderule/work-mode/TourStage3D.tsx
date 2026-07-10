/**
 * TourStage3D — Work 模式 3D 巡演舞台（懒加载分包，二期办公室化）。
 *
 * 纯演出层：只订阅 TourEvent（GameEvent 兼容），不知道运行时存在。
 * 二期：部门分区办公室（office-builder，Kenney 家具 + RBAC menus 真部门）、
 * SpotAllocator 站位防重叠（Agentshire 直搬）、NPC 头顶实时状态气泡、
 * 点击角色上报 onActorClick（角色档案卡）。
 * 「减少动态效果」偏好：瞬移替代走位、不播过渡（诚实降级）。
 */

import React from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { isMotionReduced } from "../user-prefs";
import type { TourActor, TourStation, TourZone } from "./tour-script";
import type { TourEvent } from "./tour-driver";
import { SpotAllocator } from "./vendor/SpotAllocator";
import { buildOffice, type OfficeLayout } from "./office-builder";

export interface TourStageHandle {
  dispatch: (event: TourEvent) => void;
}

const WALK_SPEED = 2.6; // 世界单位/秒
const SPAWN_GAP = 1.1;
const HOME_Z = 2.6;

interface ActorRig {
  group: THREE.Group;
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

    // 暖暗环境色（Agentshire 观感：暖木地板亮岛 + 周边暗场）
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#37322c");

    // 等距俯视（参考图观感）：正交相机 45° 方位角 + 俯角
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    let sceneW = 14; // 工位排宽（世界单位），办公室装配后更新
    let aspect = 1;
    const frameCamera = () => {
      // 横向框全工位排（含侧余量），纵向不低于房间深度需要
      const viewSize = Math.max(8.4, (sceneW + 5) / Math.max(aspect, 0.8));
      camera.left = (-viewSize * aspect) / 2;
      camera.right = (viewSize * aspect) / 2;
      camera.top = viewSize / 2;
      camera.bottom = -viewSize / 2;
      camera.updateProjectionMatrix();
    };
    camera.position.set(16, 14, 16);
    camera.lookAt(3.0, 1.6, 1.6);
    frameCamera();

    scene.add(new THREE.HemisphereLight("#ffffff", "#e3e0d8", 1.65));
    scene.add(new THREE.AmbientLight("#ffffff", 0.35));
    const sun = new THREE.DirectionalLight("#ffffff", 1.7);
    sun.position.set(6, 10, 4);
    scene.add(sun);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    // 办公室（异步装配：家具 GLB 到位前先有地板墙体不至于空场）
    let office: OfficeLayout | null = null;
    let disposed = false;
    void buildOffice(
      scene,
      loader,
      zones,
      stations,
      import.meta.env.BASE_URL
    ).then(layout => {
      if (disposed) {
        layout.dispose();
        return;
      }
      office = layout;
      // 等距取景：只框工位区（totalWidth 为工位排宽），地板铺出画面外
      sceneW = layout.totalWidth;
      frameCamera();
    });

    // 站位防重叠（Agentshire SpotAllocator 直搬）
    const spots = new SpotAllocator();

    // 角色装配
    const rigs = new Map<string, ActorRig>();
    const clickables: THREE.Object3D[] = [];

    for (const [i, actor] of cast.entries()) {
      const group = new THREE.Group();
      const home = new THREE.Vector3(
        (i - (cast.length - 1) / 2) * SPAWN_GAP,
        0,
        HOME_Z
      );
      group.position.copy(home);
      group.visible = false;
      group.userData.npcId = actor.npcId;
      scene.add(group);
      const status = makeStatusSprite();
      status.sprite.position.set(0, 2.12, 0);
      group.add(status.sprite);
      const say = makeSaySprite();
      say.sprite.position.set(0, 2.95, 0);
      group.add(say.sprite);
      const rig: ActorRig = {
        group,
        mixer: null,
        clips: [],
        current: null,
        target: null,
        emoji: null,
        status,
        say,
        sayTimer: null,
        stationId: null,
      };
      rigs.set(actor.npcId, rig);

      loader.load(
        `${import.meta.env.BASE_URL}work-mode-3d/characters/${actor.characterKey}.glb`,
        gltf => {
          if (disposed) return;
          gltf.scene.rotation.y = Math.PI; // 面向观众
          // 身高归一化到 1.75：与 Kenney 家具比例对齐、iso 视角下有存在感
          const bbox = new THREE.Box3().setFromObject(gltf.scene);
          const height = bbox.getSize(new THREE.Vector3()).y || 1;
          gltf.scene.scale.setScalar(1.75 / height);
          gltf.scene.traverse(o => {
            o.userData.npcId = actor.npcId;
          });
          group.add(gltf.scene);
          clickables.push(gltf.scene);
          rig.clips = gltf.animations ?? [];
          rig.mixer = new THREE.AnimationMixer(gltf.scene);
          playClip(rig, "Idle");
          const tag = nameSprite(actor.roleId);
          tag.position.set(0, 1.82, 0);
          group.add(tag);
        },
        undefined,
        () => {
          // 模型加载失败 → 诚实立方体替身（不装作加载成功）
          if (disposed) return;
          const stub = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 1.6, 0.4),
            new THREE.MeshStandardMaterial({ color: "#93a4bd" })
          );
          stub.position.y = 0.8;
          stub.userData.npcId = actor.npcId;
          group.add(stub);
          clickables.push(stub);
        }
      );
    }

    function playClip(rig: ActorRig, name: string, once = false) {
      if (!rig.mixer) return;
      const clip =
        rig.clips.find(c => c.name === name) ??
        rig.clips.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
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

    // 侧墙进度大屏内容（绑真事件：progress + 最近一条 narration）
    let boardProgress = "等待开演…";
    let boardNarration = "";
    const redrawBoard = () => {
      const lines = ["角色巡演", boardProgress];
      if (boardNarration) {
        lines.push(boardNarration.slice(0, 18));
        if (boardNarration.length > 18)
          lines.push(boardNarration.slice(18, 36));
      }
      office?.drawBoard(lines);
    };

    // 事件入口（父组件转发 driver 事件）
    const handle: TourStageHandle = {
      dispatch: event => {
        if (disposed) return;
        if (event.type === "narration") {
          // 台词气泡：narration 绑出演者时冒 Agentshire 式对话泡，随后自动隐去
          if (event.npcId) {
            const rig = rigs.get(event.npcId);
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
          boardNarration = event.text;
          redrawBoard();
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
            : new THREE.Vector3(0, 0, HOME_Z);
          // 防重叠：同一工位多人停靠时环形让位
          const spot = spots.allocate(
            { x: raw.x, z: raw.z },
            event.npcId,
            1.05
          );
          const dest = new THREE.Vector3(spot.x, 0, spot.z);
          if (isMotionReduced()) {
            rig.group.position.copy(dest);
            playClip(rig, "Idle");
          } else {
            rig.target = dest;
          }
          return;
        }
        if (event.type === "npc_status") {
          const rig = rigs.get(event.npcId);
          rig?.status?.draw(event.status);
          // 工位屏幕同步（录入/审批把动作写上显示器——ScreenRenderer 手法）
          if (rig?.stationId && event.status && event.status !== "移动中") {
            const station = office?.stations.get(rig.stationId);
            const actor = cast.find(a => a.npcId === event.npcId);
            station?.drawScreen([
              stations.find(s => s.stationId === rig.stationId)?.title ?? "",
              `${actor?.roleId ?? ""} · ${event.status}`,
            ]);
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
      aspect = w / h;
      frameCamera();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // 帧循环：走位插值 + 动画混合器推进
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
            playClip(rig, "Idle");
          } else {
            const stepLen = Math.min(dist, WALK_SPEED * dt);
            rig.group.position.add(delta.normalize().multiplyScalar(stepLen));
            rig.group.rotation.y = Math.atan2(delta.x, delta.z);
          }
        }
        rig.mixer?.update(dt);
      }
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
