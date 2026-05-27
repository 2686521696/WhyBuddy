# Bugfix Requirements Document

## Introduction

When the user clicks "全部生成" (Generate All) in the SpecTreeWorkbench to generate spec documents for all SPEC tree nodes, the UI provides no real-time progress feedback. The user waits 30-60 seconds seeing only a disabled "生成中..." button, with no indication of which node is being processed, how many are complete, or estimated time remaining. All results appear at once when the batch completes. If the request fails midway, the user cannot determine which nodes succeeded.

The root cause is that the backend `generateSpecDocuments()` function processes all nodes in a single batch (via `Promise.all` or LLM batch generation) without emitting per-node progress events through the existing `BlueprintEventBus` → `BlueprintSocketRelay` → `useBlueprintRealtimeStore` pipeline. The frontend awaits the entire HTTP response before updating the UI.

The existing infrastructure (`createStageProgressEmitter`, `BlueprintEventBus`, `BlueprintSocketRelay`, `useBlueprintRealtimeStore`) already supports real-time streaming progress for other stages (route_generation, spec_tree, intake). This fix extends that mechanism to cover per-node spec document generation.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user clicks "全部生成" to generate spec documents for multiple nodes THEN the system only shows a disabled "生成中..." button with no per-node progress indication for 30-60 seconds

1.2 WHEN spec document generation is in progress for multiple nodes THEN the system does not emit any per-node progress events through the existing `BlueprintEventBus` / socket relay pipeline

1.3 WHEN spec document generation fails midway through the batch THEN the system does not indicate which nodes completed successfully and which failed

1.4 WHEN spec document generation is in progress THEN the right rail does not display streaming status updates showing which node is currently being processed or how many are complete

### Expected Behavior (Correct)

2.1 WHEN the user clicks "全部生成" to generate spec documents for multiple nodes THEN the system SHALL emit a per-node progress event through `BlueprintEventBus` as each node begins processing, indicating the node name/id and its position in the queue (e.g., "正在生成节点 3/8: 用户认证模块")

2.2 WHEN each node's spec documents finish generating THEN the system SHALL emit a per-node completion event through `BlueprintEventBus` indicating the node completed successfully, updating the completed count

2.3 WHEN spec document generation fails for a specific node THEN the system SHALL emit a per-node error event identifying which node failed, while continuing to process remaining nodes, so the user knows exactly which nodes succeeded and which failed

2.4 WHEN per-node progress events are emitted during "全部生成" THEN the right rail SHALL display streaming status updates showing the currently processing node, the completion count (e.g., "3/8 已完成"), and individual node status (pending/processing/completed/failed)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user generates spec documents for a single node (not "全部生成") THEN the system SHALL CONTINUE TO use the existing single-node generation flow without additional progress overhead

3.2 WHEN spec document generation completes (all nodes) THEN the system SHALL CONTINUE TO return the same `BlueprintSpecDocumentsResponse` payload format and update the job state identically to the current behavior

3.3 WHEN the `useBlueprintRealtimeStore` receives progress events from other stages (route_generation, spec_tree, intake) THEN the system SHALL CONTINUE TO process and display those events without interference from the new spec_docs progress events

3.4 WHEN `BUILD_TARGET=test` THEN the system SHALL CONTINUE TO run spec document generation in fallback/simulated mode without requiring real event bus connectivity

3.5 WHEN the frontend is not subscribed to the job's realtime events (e.g., page navigated away) THEN the system SHALL CONTINUE TO complete spec document generation successfully on the backend regardless of frontend subscription state
