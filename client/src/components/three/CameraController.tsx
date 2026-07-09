import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { PerspectiveCamera } from 'three';

import type { ViewportTier } from '@/hooks/useViewportTier';

import { computeFovCompensation } from './camera-compensation';

export interface CameraControllerProps {
  /** Actual available width of the Scene3D container in pixels. */
  effectiveWidth: number;
  /** Current viewport tier from useViewportTier. */
  tier: ViewportTier;
}

/**
 * Base FOV presets matching the existing Scene3D camera config.
 *
 * 自动驾驶 3D 场景融合 follow-up（2026-05-13）：FOV 由 mobile 46 / tablet 43 /
 * desktop 40 统一抬高到 48，配合 Scene3D.tsx 中相机 position 后撤，让 1280-1440
 * 桌面 + 右栏占用场景宽度时左右 zone 标签与后墙 SandboxMonitor 仍能完整显示。
 */
const BASE_FOV: Record<ViewportTier, number> = {
  mobile: 48,
  tablet: 48,
  desktop: 48,
};

/**
 * R3F internal component that dynamically adjusts the camera FOV
 * based on the effective viewport width.
 *
 * It preserves the existing mobile / tablet / desktop three-tier
 * FOV presets and layers a continuous compensation on top so the
 * scene core area stays visible when a sidebar narrows the viewport.
 *
 * Must be rendered inside an R3F `<Canvas>`.
 */
export function CameraController({ effectiveWidth, tier }: CameraControllerProps) {
  const { camera } = useThree();

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;

    const baseFov = BASE_FOV[tier];
    const fovCompensation = computeFovCompensation(effectiveWidth);
    const targetFov = baseFov + fovCompensation;

    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }, [effectiveWidth, tier, camera]);

  return null;
}
