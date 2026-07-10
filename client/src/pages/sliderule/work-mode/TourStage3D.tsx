/**
 * TourStage3D — Work 模式 3D 巡演舞台（懒加载分包）。
 *
 * 纯演出层：只订阅 TourEvent（GameEvent 兼容），不知道运行时存在。
 * 角色 = 已采购 Quaternius UACP GLB（自带 16 动画，meshopt 压缩 →
 * 需要 MeshoptDecoder）；工位 = 按 page 摆的桌台 + CanvasTexture 名牌。
 * 「减少动态效果」偏好：瞬移替代走位、不播位移动画（诚实降级）。
 */

import React from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { isMotionReduced } from "../user-prefs";
import type { TourActor, TourStation } from "./tour-script";
import type { TourEvent } from "./tour-driver";

export interface TourStageHandle {
  dispatch: (event: TourEvent) => void;
}

const WALK_SPEED = 2.6; // 世界单位/秒
const SPAWN_GAP = 1.1;

function stationPosition(index: number, count: number): THREE.Vector3 {
  // 工位沿后场弧线排开
  const spread = Math.min(Math.PI * 0.7, 0.5 * count);
  const t = count <= 1 ? 0.5 : index / (count - 1);
  const angle = -spread / 2 + t * spread;
  const radius = 6.2;
  return new THREE.Vector3(
    Math.sin(angle) * radius,
    0,
    -Math.cos(angle) * radius + 1.2
  );
}

function labelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = "#e5e7eb";
  ctx.strokeRect(0, 0, 256, 64);
  ctx.fillStyle = "#1f2329";
  ctx.font = "500 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 10), 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true })
  );
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
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

interface ActorRig {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  current: THREE.AnimationAction | null;
  target: THREE.Vector3 | null;
  emoji: THREE.Sprite | null;
}

export default function TourStage3D({
  cast,
  stations,
  onReady,
}: {
  cast: TourActor[];
  stations: TourStation[];
  /** 舞台就绪后上交事件入口（父组件把 driver 的事件转发进来） */
  onReady: (handle: TourStageHandle) => void;
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f2f4f8");
    scene.fog = new THREE.Fog("#f2f4f8", 16, 30);

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    camera.position.set(0, 6.4, 9.6);
    camera.lookAt(0, 0.6, -1.4);

    scene.add(new THREE.HemisphereLight("#ffffff", "#d7dde6", 1.15));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(4, 8, 5);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(13, 48),
      new THREE.MeshStandardMaterial({ color: "#e6eaf0" })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.GridHelper(24, 24, 0xd3d8e0, 0xdfe3ea);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material & { opacity: number }).opacity = 0.5;
    scene.add(grid);

    // 工位：桌台 + 名牌
    const stationPos = new Map<string, THREE.Vector3>();
    stations.forEach((st, i) => {
      const pos = stationPosition(i, stations.length);
      stationPos.set(st.stationId, pos);
      const desk = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.72, 0.8),
        new THREE.MeshStandardMaterial({ color: "#ffffff" })
      );
      desk.position.copy(pos).setY(0.36);
      scene.add(desk);
      const label = labelSprite(st.title);
      label.position.copy(pos).setY(1.35);
      scene.add(label);
    });

    // 角色装配
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const rigs = new Map<string, ActorRig>();
    let disposed = false;

    for (const [i, actor] of cast.entries()) {
      const group = new THREE.Group();
      const home = new THREE.Vector3(
        (i - (cast.length - 1) / 2) * SPAWN_GAP,
        0,
        4.6
      );
      group.position.copy(home);
      group.visible = false;
      scene.add(group);
      const rig: ActorRig = {
        group,
        mixer: null,
        clips: [],
        current: null,
        target: null,
        emoji: null,
      };
      rigs.set(actor.npcId, rig);

      loader.load(
        `${import.meta.env.BASE_URL}work-mode-3d/characters/${actor.characterKey}.glb`,
        gltf => {
          if (disposed) return;
          gltf.scene.rotation.y = Math.PI; // 面向观众
          group.add(gltf.scene);
          rig.clips = gltf.animations ?? [];
          rig.mixer = new THREE.AnimationMixer(gltf.scene);
          playClip(rig, "Idle");
          const tag = labelSprite(actor.roleId);
          tag.position.set(0, 2.1, 0);
          tag.scale.set(1.6, 0.4, 1);
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
          group.add(stub);
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

    // 事件入口（父组件转发 driver 事件）
    const handle: TourStageHandle = {
      dispatch: event => {
        if (disposed) return;
        if (event.type === "npc_spawn") {
          const rig = rigs.get(event.npcId);
          if (rig) rig.group.visible = true;
          return;
        }
        if (event.type === "npc_move_to") {
          const rig = rigs.get(event.npcId);
          const pos = stationPos.get(event.stationId);
          if (!rig || !pos) return;
          const dest = pos.clone().add(new THREE.Vector3(0, 0, 1.15));
          if (isMotionReduced()) {
            rig.group.position.copy(dest);
            playClip(rig, "Idle");
          } else {
            rig.target = dest;
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
            sprite.position.set(0, 2.55, 0);
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
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose?.();
      });
    };
    // 舞台按 cast/stations 一次装配；变更走整体重挂（父组件 key 控制）
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
