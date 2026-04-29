import { ContactShadows, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import { ACESFilmicToneMapping } from "three";

import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useIdleActivation } from "@/hooks/useIdleActivation";
import { useViewportTier } from "@/hooks/useViewportTier";
import { FURNITURE_MODELS, PET_MODELS } from "@/lib/assets";
import { FUTURE_OFFICE_COLORS } from "@/lib/scene-theme";
import { useTasksStore } from "@/lib/tasks-store";

import { CameraController } from "./three/CameraController";
import { CrossFrameworkParticles } from "./three/CrossFrameworkParticles";
import { CrossPodParticles } from "./three/CrossPodParticles";
import { MissionIsland } from "./three/MissionIsland";
import { OfficeRoom } from "./three/OfficeRoom";
import { PetWorkers } from "./three/PetWorkers";
import { SandboxMonitor } from "./three/SandboxMonitor";
import { SceneStageFlow } from "./three/SceneStageFlow";
import { WaitingDecisionBubble } from "./three/WaitingDecisionBubble";

const CRITICAL_FURNITURE_MODELS = [
  FURNITURE_MODELS.floorFull,
  FURNITURE_MODELS.floorHalf,
  FURNITURE_MODELS.floorCornerRound,
  FURNITURE_MODELS.wallCorner,
  FURNITURE_MODELS.wallCornerRond,
  FURNITURE_MODELS.desk,
  FURNITURE_MODELS.chairDesk,
  FURNITURE_MODELS.computerScreen,
  FURNITURE_MODELS.computerKeyboard,
  FURNITURE_MODELS.computerMouse,
  FURNITURE_MODELS.rugRounded,
  FURNITURE_MODELS.rugRectangle,
  FURNITURE_MODELS.laptop,
  FURNITURE_MODELS.tableRound,
];

const SECONDARY_SCENE_MODELS = [
  ...Object.values(FURNITURE_MODELS).filter(
    url => !CRITICAL_FURNITURE_MODELS.includes(url)
  ),
  ...Object.values(PET_MODELS),
];

export type ScenePerformanceProfile = "balanced" | "resizing";

export interface Scene3DProps {
  performanceProfile?: ScenePerformanceProfile;
  /** Current sidebar width in pixels, used for camera compensation. Default 0. */
  sidebarWidth?: number;
  /** Hide the scene via CSS visibility (preserves WebGL context). Default false. */
  hidden?: boolean;
}

export function Scene3D({
  performanceProfile = "balanced",
  sidebarWidth = 0,
  hidden = false,
}: Scene3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isMobile, isTablet, tier } = useViewportTier();
  const effectiveWidth = useContainerWidth(containerRef);
  const deferredDetailsReady = useIdleActivation(
    performanceProfile === "balanced",
    600
  );
  const reducedSceneEffects = performanceProfile === "resizing";

  // Sandbox shield: show when the selected mission runs at strict security level.
  const isStrictSandbox = useTasksStore(state => {
    const detail = state.selectedTaskId
      ? state.detailsById[state.selectedTaskId]
      : null;
    return (
      detail?.securitySummary?.level === "strict" &&
      detail?.status === "running"
    );
  });

  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    (
      globalThis as { __sceneSetRecovering?: (value: boolean) => void }
    ).__sceneSetRecovering = (value: boolean) => {
      setIsRecovering(value);
    };

    return () => {
      delete (globalThis as { __sceneSetRecovering?: (value: boolean) => void })
        .__sceneSetRecovering;
    };
  }, []);

  useEffect(() => {
    CRITICAL_FURNITURE_MODELS.forEach(url => {
      useGLTF.preload(url);
    });
  }, []);

  useEffect(() => {
    if (!deferredDetailsReady || typeof window === "undefined") return;

    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const preloadSecondary = () => {
      SECONDARY_SCENE_MODELS.forEach(url => {
        useGLTF.preload(url);
      });
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(
        () => {
          preloadSecondary();
        },
        { timeout: 1200 }
      );
    } else {
      timeoutId = window.setTimeout(preloadSecondary, 900);
    }

    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [deferredDetailsReady]);

  const camera = isMobile
    ? {
        position: [0, 8.4, 16.2] as [number, number, number],
        fov: 46,
        near: 0.1,
        far: 100,
      }
    : isTablet
      ? {
          position: [0, 7.8, 14.6] as [number, number, number],
          fov: 43,
          near: 0.1,
          far: 100,
        }
      : {
          position: [0, 7.3, 13.8] as [number, number, number],
          fov: 40,
          near: 0.1,
          far: 100,
        };
  const dpr: [number, number] = reducedSceneEffects
    ? [1, 1]
    : isMobile
      ? [1, 1.35]
      : [1, 1.5];
  const primaryShadowSize = reducedSceneEffects ? 768 : 1024;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 h-full w-full touch-pan-y bg-[linear-gradient(180deg,#eef6fb_0%,#f7fbfd_48%,#e5f1f4_100%)]"
      style={{ visibility: hidden ? "hidden" : "visible" }}
    >
      <Canvas
        shadows
        camera={camera}
        dpr={dpr}
        frameloop={hidden ? "demand" : "always"}
        gl={{ antialias: !reducedSceneEffects, alpha: false }}
        resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
        onCreated={({ gl, camera: sceneCamera }) => {
          gl.setClearColor(FUTURE_OFFICE_COLORS.sceneBackground);
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = isMobile ? 1.04 : 1;
          sceneCamera.lookAt(0, isMobile ? 1.6 : 1.35, 0);
        }}
      >
        <CameraController effectiveWidth={effectiveWidth} tier={tier} />
        <Suspense fallback={null}>
          <ambientLight intensity={0.48} color={FUTURE_OFFICE_COLORS.ambient} />
          <hemisphereLight
            color={FUTURE_OFFICE_COLORS.hemisphereSky}
            groundColor={FUTURE_OFFICE_COLORS.hemisphereGround}
            intensity={0.42}
          />

          <directionalLight
            position={[-5.2, 7.2, 4.4]}
            intensity={1.08}
            color={FUTURE_OFFICE_COLORS.keyLight}
            castShadow
            shadow-mapSize-height={primaryShadowSize}
            shadow-mapSize-width={primaryShadowSize}
            shadow-camera-bottom={-11}
            shadow-camera-far={22}
            shadow-camera-left={-11}
            shadow-camera-right={11}
            shadow-camera-top={11}
            shadow-bias={-0.00025}
          />

          <directionalLight
            position={[6.4, 4.5, 5.5]}
            intensity={0.32}
            color={FUTURE_OFFICE_COLORS.fillLight}
          />

          <spotLight
            position={[-7.2, 2.9, 0.3]}
            angle={0.92}
            penumbra={1}
            intensity={0.3}
            color={FUTURE_OFFICE_COLORS.practicalLight}
            distance={18}
            decay={2}
          />

          <pointLight
            position={[0.3, 2.35, -1.1]}
            intensity={0.22}
            color={FUTURE_OFFICE_COLORS.cyanSoft}
            distance={6.6}
            decay={2}
          />

          <OfficeRoom
            showSecondaryDecor={deferredDetailsReady && !reducedSceneEffects}
            reducedEffects={reducedSceneEffects}
          />
          <SceneStageFlow />
          <PetWorkers
            reducedOverlays={!deferredDetailsReady || reducedSceneEffects}
          />
          <MissionIsland />
          <SandboxMonitor />
          <WaitingDecisionBubble />
          {!reducedSceneEffects && deferredDetailsReady ? (
            <>
              <CrossPodParticles active />
              <CrossFrameworkParticles active showLabels={false} />
            </>
          ) : null}

          {!reducedSceneEffects ? (
            <ContactShadows
              position={[0, 0.01, 0]}
              opacity={0.24}
              scale={15}
              blur={2.6}
              far={5.5}
              color={FUTURE_OFFICE_COLORS.contactShadow}
            />
          ) : null}
        </Suspense>
      </Canvas>

      {isRecovering && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="mb-4 size-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
          <p className="text-base font-medium text-white drop-shadow-md">
            Recovering previous task...
          </p>
        </div>
      )}

      {isStrictSandbox && (
        <div
          className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-2xl border border-rose-200/60 bg-white/80 px-3.5 py-2 shadow-lg backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <span className="text-lg" aria-hidden="true">
            {"\uD83D\uDEE1\uFE0F"}
          </span>
          <span className="text-xs font-semibold text-rose-700">
            Sandbox Protected
          </span>
        </div>
      )}
    </div>
  );
}
