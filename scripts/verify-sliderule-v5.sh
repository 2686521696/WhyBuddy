#!/usr/bin/env bash
# verify-sliderule-v5 —— 发布门本体（E24 提速：静态检查与冒烟并行）。
#
# 结构：
#   A 线（后台）：前端 vitest → 服务端 vitest → tsc 全量类型检查
#   B 线（前台）：浏览器冒烟（真 LLM 推演 5 步，墙钟大头）
# 两线互不依赖，任一非零即门红。验证强度与原串行版完全一致，
# 只是墙钟从 A+B 变成 max(A,B)。
set -uo pipefail

STATIC_LOG=$(mktemp)
(
  set -e
  pnpm exec vitest run client/src/lib/sliderule-runtime.test.ts client/src/lib/sliderule-runtime.fullpath-core.test.ts client/src/lib/sliderule-runtime.fullpath-status.test.tsx client/src/lib/sliderule-runtime.fullpath-budget.test.ts client/src/lib/sliderule-runtime.fullpath-projection.test.ts client/src/lib/sliderule-runtime.fullpath-invariants.test.ts client/src/lib/sliderule-runtime.fullpath-roles.test.ts client/src/lib/sliderule-runtime.fullpath-visual.test.ts client/src/lib/sliderule-runtime.fullpath-delivery.test.ts client/src/lib/sliderule-runtime.fullpath-readiness.test.ts client/src/lib/sliderule-runtime.fullpath-confirm.test.ts client/src/lib/sliderule-runtime.fullpath-structure.test.ts client/src/lib/__tests__/sliderule-rv-s20.test.ts client/src/lib/__tests__/knife-a-pick-heuristic.test.ts client/src/pages/sliderule/__tests__/knife-b-projection.test.ts client/src/pages/sliderule/__tests__/knife-c-terminal.test.ts client/src/pages/sliderule/__tests__/github-pages-sliderule-demo.test.ts client/src/lib/__tests__/migrate-storage.test.ts client/src/lib/sliderule-runtime.quality-fallback.test.ts --reporter=dot
  pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.sessions-store.test.ts server/routes/__tests__/sliderule.deliberation-exec.test.ts server/sliderule/__tests__/visual-exec-map.test.ts server/sliderule/__tests__/delivery-exec-map.test.ts server/sliderule/__tests__/structure-exec-map.test.ts server/sliderule/__tests__/evidence-exec-map.test.ts shared/blueprint/__tests__/sliderule-delivery-chain.test.ts shared/blueprint/__tests__/sliderule-readiness-chain.test.ts shared/blueprint/__tests__/sliderule-interactive-gates.test.ts shared/blueprint/__tests__/sliderule-structure-chain.test.ts shared/blueprint/__tests__/sliderule-role-mode.test.ts shared/blueprint/__tests__/sliderule-visual-chain.test.ts shared/blueprint/__tests__/sliderule-session-replay.test.ts shared/blueprint/__tests__/sliderule-coverage-gate.test.ts server/routes/__tests__/sliderule.rename-compat.test.ts shared/env/__tests__/read-env-compat.test.ts --reporter=dot
  pnpm exec tsc --noEmit --pretty false
) > "$STATIC_LOG" 2>&1 &
STATIC_PID=$!

pnpm run smoke:sliderule
SMOKE_EXIT=$?

wait "$STATIC_PID"
STATIC_EXIT=$?
echo "────── 静态检查输出（与冒烟并行跑）──────"
cat "$STATIC_LOG"
rm -f "$STATIC_LOG"

echo "[verify] smoke=$SMOKE_EXIT static=$STATIC_EXIT"
[ "$SMOKE_EXIT" -eq 0 ] && [ "$STATIC_EXIT" -eq 0 ]
