#!/usr/bin/env bash
# verify-sliderule-v5 —— 发布门本体（E24 提速：静态检查与冒烟并行）。
#
# 结构：
#   A 线（后台）：前端 vitest → Python 合法域/Gate → 服务端 vitest → tsc
#   B 线（前台）：浏览器冒烟
#     B1: smoke:generated-app — 离线确定性验收，生成应用 Chromium（side/top/phone Shell、
#         真实落地页、无 home 菜单、角色降级）。不调用 LLM，快速且隔离。
#     B2: smoke:sliderule   — 真实 LLM 推演 5 步，Python 端到端（墙钟大头）。
# 两线互不依赖，任一非零即门红。验证强度与原串行版完全一致，
# 只是墙钟从 A+B 变成 max(A,B)。
set -uo pipefail

STATIC_LOG=$(mktemp)
(
  set -e
  pnpm exec vitest run client/src/lib/sliderule-runtime.test.ts client/src/lib/sliderule-runtime.fullpath-core.test.ts client/src/lib/sliderule-runtime.fullpath-status.test.tsx client/src/lib/sliderule-runtime.fullpath-budget.test.ts client/src/lib/sliderule-runtime.fullpath-projection.test.ts client/src/lib/sliderule-runtime.fullpath-invariants.test.ts client/src/lib/sliderule-runtime.fullpath-roles.test.ts client/src/lib/sliderule-runtime.fullpath-visual.test.ts client/src/lib/sliderule-runtime.fullpath-delivery.test.ts client/src/lib/sliderule-runtime.fullpath-readiness.test.ts client/src/lib/sliderule-runtime.fullpath-confirm.test.ts client/src/lib/sliderule-runtime.fullpath-structure.test.ts client/src/lib/__tests__/sliderule-rv-s20.test.ts client/src/lib/__tests__/knife-a-pick-heuristic.test.ts client/src/pages/sliderule/__tests__/app-runtime-schema.test.ts client/src/pages/sliderule/__tests__/rbac-preview.test.ts client/src/pages/sliderule/__tests__/experience-block-catalog.test.tsx client/src/pages/sliderule/__tests__/knife-b-projection.test.ts client/src/pages/sliderule/__tests__/knife-c-terminal.test.ts client/src/pages/sliderule/__tests__/github-pages-sliderule-demo.test.ts client/src/lib/__tests__/migrate-storage.test.ts client/src/lib/sliderule-runtime.quality-fallback.test.ts --reporter=dot
  # Python Gate + 内置域模型 strict Gate + 版本回退兼容测试（本轮新增）
  PYTHONPATH=slide-rule-python python -m pytest \
    slide-rule-python/tests/test_schema_legal_source.py \
    slide-rule-python/tests/test_v5_llm_generate_gate.py \
    slide-rule-python/tests/test_builtin_domain_models.py \
    slide-rule-python/tests/test_model_versions.py \
    -q
  pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.sessions-store.test.ts server/routes/__tests__/sliderule.deliberation-exec.test.ts server/sliderule/__tests__/visual-exec-map.test.ts server/sliderule/__tests__/delivery-exec-map.test.ts server/sliderule/__tests__/structure-exec-map.test.ts server/sliderule/__tests__/evidence-exec-map.test.ts shared/blueprint/__tests__/sliderule-delivery-chain.test.ts shared/blueprint/__tests__/sliderule-readiness-chain.test.ts shared/blueprint/__tests__/sliderule-interactive-gates.test.ts shared/blueprint/__tests__/sliderule-structure-chain.test.ts shared/blueprint/__tests__/sliderule-role-mode.test.ts shared/blueprint/__tests__/sliderule-visual-chain.test.ts shared/blueprint/__tests__/sliderule-session-replay.test.ts shared/blueprint/__tests__/sliderule-coverage-gate.test.ts server/routes/__tests__/sliderule.rename-compat.test.ts shared/env/__tests__/read-env-compat.test.ts --reporter=dot
  pnpm exec tsc --noEmit --pretty false
) > "$STATIC_LOG" 2>&1 &
STATIC_PID=$!

# 浏览器线：
# B1 生成应用 smoke（离线确定性：side/top/phone、真实落地页、无 home 菜单）先跑
# B2 真实推演 smoke（真 LLM + Python end-to-end，墙钟大头）后跑
# 分开运行确保失败信息明确：renderer 问题不被 LLM/网络故障掩盖。
pnpm run smoke:generated-app
GENERATED_SMOKE_EXIT=$?

# Phase C：多样性验收门——内置模型 nav 和 landing 页必须不同，
# 证明 Gate 允许多种形态而不是强制同一结构。
node -e "
const d=JSON.parse(require('fs').readFileSync('slide-rule-python/services/data/builtin_domain_models.json','utf8'));
const l=d.leave_approval,t=d.service_ticket;
const lNav=l?.appbundle?.appIdentity?.nav??l?.appbundle?.experienceShell?.navigation;
const tNav=t?.appbundle?.appIdentity?.nav??t?.appbundle?.experienceShell?.navigation;
const lLand=l?.appbundle?.landingPageRef,tLand=t?.appbundle?.landingPageRef;
let fail=false;
if(!lLand){console.error('DIVERSITY FAIL: leave_approval missing landingPageRef');fail=true;}
if(!tLand){console.error('DIVERSITY FAIL: service_ticket missing landingPageRef');fail=true;}
if(lNav===tNav){console.error('DIVERSITY FAIL: both apps share same nav:',lNav);fail=true;}
if(lLand===tLand){console.error('DIVERSITY FAIL: both apps share same landing:',lLand);fail=true;}
if(fail)process.exit(1);
console.log('[diversity] leave nav='+lNav+' landing='+lLand+' | ticket nav='+tNav+' landing='+tLand+' — PASS');
" || { echo "Phase C diversity check FAILED"; GENERATED_SMOKE_EXIT=1; }

pnpm run smoke:sliderule
SMOKE_EXIT=$?

wait "$STATIC_PID"
STATIC_EXIT=$?
echo "────── 静态检查输出（与冒烟并行跑）──────"
cat "$STATIC_LOG"
rm -f "$STATIC_LOG"

echo "[verify] generated-smoke=$GENERATED_SMOKE_EXIT smoke=$SMOKE_EXIT static=$STATIC_EXIT"
[ "$GENERATED_SMOKE_EXIT" -eq 0 ] && [ "$SMOKE_EXIT" -eq 0 ] && [ "$STATIC_EXIT" -eq 0 ]
