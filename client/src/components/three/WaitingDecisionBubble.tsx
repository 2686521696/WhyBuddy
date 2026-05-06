import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";

import { getProjectTaskPath } from "@/components/navigation-config";
import { resolveProjectTaskScope } from "@/lib/project-task-scope";
import { useProjectStore } from "@/lib/project-store";
import { useTasksStore, type MissionTaskSummary } from "@/lib/tasks-store";

/**
 * Floating question-mark bubble rendered above the MissionIsland area
 * when any mission is in `waiting` status.
 *
 * Clicking the bubble navigates to `/tasks/:id` for the waiting mission.
 * The bubble auto-disappears when the mission leaves `waiting` status
 * (driven by Zustand store — no extra Socket listener needed).
 */

const BUBBLE_POSITION: [number, number, number] = [0, 4.6, -2.5];

function selectWaitingMission(
  tasks: MissionTaskSummary[]
): MissionTaskSummary | null {
  return tasks.find(t => t.status === "waiting") ?? null;
}

export function WaitingDecisionBubble({
  projectId = null,
}: {
  projectId?: string | null;
}) {
  const tasks = useTasksStore(s => s.tasks);
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
  const waitingMission = useMemo(
    () => selectWaitingMission(scopedTasks),
    [scopedTasks]
  );
  const [, setLocation] = useLocation();
  const scaleRef = useRef<HTMLDivElement>(null);

  // Pulsing animation via useFrame
  useFrame(({ clock }) => {
    if (!scaleRef.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 3) * 0.08;
    scaleRef.current.style.transform = `scale(${pulse})`;
  });

  const handleClick = useCallback(() => {
    if (!waitingMission) return;
    setLocation(getProjectTaskPath(projectId, waitingMission.id));
  }, [projectId, waitingMission, setLocation]);

  if (!waitingMission) return null;

  return (
    <group position={BUBBLE_POSITION}>
      <Html center distanceFactor={7} style={{ pointerEvents: "auto" }}>
        <div
          ref={scaleRef}
          onClick={handleClick}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 border-sky-300 bg-white/95 shadow-lg backdrop-blur-sm transition-shadow hover:shadow-sky-300/50 hover:shadow-xl"
          title={waitingMission.title}
        >
          <span className="text-lg font-bold text-sky-500">?</span>
          {/* Tail triangle */}
          <div className="absolute -bottom-1.5 left-1/2 h-0 w-0 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-white/95" />
        </div>
      </Html>
    </group>
  );
}
