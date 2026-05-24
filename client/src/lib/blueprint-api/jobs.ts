/**
 * Blueprint SDK 子域 3：Job Lifecycle & Events（方案 B）。
 *
 * 对应需求 2.1 子域 3、2.3、6.4。
 */

export {
  BLUEPRINT_JOBS_ENDPOINT,
  BLUEPRINT_GENERATIONS_ENDPOINT,
  createBlueprintGenerationJob,
  createBlueprintGenerationCompatJob,
  fetchBlueprintGenerationJob,
  fetchBlueprintJobEvents,
  fetchBlueprintJobEventStreamUrl,
  fetchLatestBlueprintGenerationJob,
  normalizeBlueprintLatestGenerationJobResponse,
} from "../blueprint-api.js";

export type {
  FetchBlueprintJobEventsResult,
  FetchBlueprintGenerationJobResult,
  BlueprintCreateGenerationJobSnapshotResponse,
  BlueprintGenerationJobResult,
} from "../blueprint-api.js";
