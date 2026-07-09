import { useEffect, useState } from "react";

import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { fetchLatestBlueprintGenerationJob } from "@/lib/blueprint-api/jobs";

export interface StaticPreviewProbeResult {
  ok: boolean;
}

export interface DetectStaticPreviewModeOptions {
  moduleStaticFlag?: boolean;
  fallbackStaticPreview?: boolean;
  probeLatestJobs?: () => Promise<StaticPreviewProbeResult>;
}

export interface UseIsStaticPreviewModeOptions
  extends DetectStaticPreviewModeOptions {
  initialStaticPreview?: boolean;
}

export async function detectStaticPreviewMode({
  moduleStaticFlag = IS_GITHUB_PAGES,
  fallbackStaticPreview = false,
  probeLatestJobs = fetchLatestBlueprintGenerationJob,
}: DetectStaticPreviewModeOptions = {}): Promise<boolean> {
  if (moduleStaticFlag) return true;

  const result = await probeLatestJobs();
  if (result.ok) return false;

  return fallbackStaticPreview;
}

export function useIsStaticPreviewMode({
  initialStaticPreview,
  moduleStaticFlag = IS_GITHUB_PAGES,
  fallbackStaticPreview = false,
  probeLatestJobs = fetchLatestBlueprintGenerationJob,
}: UseIsStaticPreviewModeOptions = {}): boolean {
  const [isStaticPreview, setIsStaticPreview] = useState(
    initialStaticPreview ?? moduleStaticFlag,
  );

  useEffect(() => {
    let active = true;

    detectStaticPreviewMode({
      moduleStaticFlag,
      fallbackStaticPreview,
      probeLatestJobs,
    }).then((detected) => {
      if (active) setIsStaticPreview(detected);
    });

    return () => {
      active = false;
    };
  }, [fallbackStaticPreview, moduleStaticFlag, probeLatestJobs]);

  return isStaticPreview;
}
