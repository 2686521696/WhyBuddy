import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useLocation } from "wouter";

import {
  getProjectTaskPath,
  getProjectTasksPath,
} from "@/components/navigation-config";
import { useViewportTier } from "@/hooks/useViewportTier";
import { resolveProjectTaskScope } from "@/lib/project-task-scope";
import { useProjectStore } from "@/lib/project-store";
import { FUTURE_OFFICE_COLORS } from "@/lib/scene-theme";
import { useTasksStore } from "@/lib/tasks-store";

import { MissionDetailOverlay } from "../tasks/MissionDetailOverlay";
import { MissionMiniView } from "../tasks/MissionMiniView";
import {
  getIslandScale,
  selectDisplayMission,
} from "../tasks/mission-island-helpers";

/* ── Constants ── */
const ISLAND_POSITION: [number, number, number] = [0, 0, -2.5];
const MINI_VIEW_OFFSET: [number, number, number] = [0, 2.8, 0];

const GLOW_COLOR_ACTIVE = new THREE.Color(FUTURE_OFFICE_COLORS.cyan);
const GLOW_COLOR_IDLE = new THREE.Color(FUTURE_OFFICE_COLORS.hemisphereGround);

/* ── Data Hook ── */
function useMissionIslandData(projectId: string | null) {
  const tasks = useTasksStore(s => s.tasks);
  const detailsById = useTasksStore(s => s.detailsById);
  const projectMissions = useProjectStore(state => state.missions);
  const scopedTasks = useMemo(
    () =>
      resolveProjectTaskScope({
        projectId,
        projectMissions,
        tasks,
      }).tasks,
    [projectId, projectMissions, tasks]
  );

  const selectedMission = useMemo(
    () => selectDisplayMission(scopedTasks),
    [scopedTasks]
  );

  const missionDetail = selectedMission
    ? (detailsById[selectedMission.id] ?? null)
    : null;

  const isRunning = selectedMission?.status === "running";

  return { selectedMission, missionDetail, isRunning };
}

/* ── Main Component ── */
export function MissionIsland({ projectId = null }: { projectId?: string | null }) {
  const { selectedMission, missionDetail, isRunning } =
    useMissionIslandData(projectId);
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();
  const { tier } = useViewportTier();

  const glowRef = useRef<THREE.Mesh>(null);

  const scale = getIslandScale(tier);
  const interactive = tier !== "desktop";

  /* Close overlay when selected mission disappears */
  useEffect(() => {
    if (!selectedMission && expanded) setExpanded(false);
  }, [selectedMission, expanded]);

  /* Escape key closes Detail Overlay */
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [expanded]);

  /* Glow pulse animation */
  useFrame(({ clock }) => {
    if (!glowRef.current) return;
    const mat = glowRef.current.material as THREE.MeshStandardMaterial;
    if (isRunning) {
      const pulse = 0.22 + Math.sin(clock.elapsedTime * 2.5) * 0.14;
      mat.emissive.copy(GLOW_COLOR_ACTIVE);
      mat.emissiveIntensity = pulse;
      mat.opacity = 0.18 + pulse * 0.2;
    } else {
      mat.emissive.copy(GLOW_COLOR_IDLE);
      mat.emissiveIntensity = 0.08;
      mat.opacity = 0.1;
    }
  });

  const handleIslandClick = useCallback((e: THREE.Event) => {
    (e as unknown as { stopPropagation: () => void }).stopPropagation();
    setExpanded(prev => !prev);
  }, []);

  const handleExpand = useCallback(() => setExpanded(true), []);
  const handleClose = useCallback(() => setExpanded(false), []);

  const handleNavigateToDetail = useCallback(
    (taskId: string) => {
      setExpanded(false);
      setLocation(getProjectTaskPath(projectId, taskId));
    },
    [projectId, setLocation]
  );

  const handleCreateMission = useCallback(() => {
    setLocation(`${getProjectTasksPath(projectId)}?new=1`);
  }, [projectId, setLocation]);

  return (
    <group
      position={ISLAND_POSITION}
      scale={scale}
      onClick={interactive ? handleIslandClick : undefined}
      onPointerOver={
        interactive
          ? () => {
              document.body.style.cursor = "pointer";
            }
          : undefined
      }
      onPointerOut={
        interactive
          ? () => {
              document.body.style.cursor = "auto";
            }
          : undefined
      }
    >
      {/* Floor ring */}
      <mesh
        ref={glowRef}
        position={[0, 0.035, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.82, 1.04, 48]} />
        <meshStandardMaterial
          transparent
          opacity={0.1}
          emissive={GLOW_COLOR_IDLE}
          emissiveIntensity={0.08}
          roughness={0.9}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Mini View (always visible) */}
      {interactive ? (
        <Html
          position={MINI_VIEW_OFFSET}
          center
          distanceFactor={7}
          style={{ pointerEvents: expanded ? "none" : "auto" }}
        >
          <MissionMiniView
            mission={selectedMission}
            onExpand={handleExpand}
            onCreateMission={handleCreateMission}
          />
        </Html>
      ) : null}

      {/* Detail Overlay (visible when expanded) */}
      {expanded && missionDetail && (
        <Html fullscreen style={{ pointerEvents: "auto" }}>
          <MissionDetailOverlay
            detail={missionDetail}
            onClose={handleClose}
            onNavigateToDetail={handleNavigateToDetail}
          />
        </Html>
      )}
    </group>
  );
}
