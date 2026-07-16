#!/usr/bin/env bash
# merge-gated —— 合并 main 的唯一入口（2026-07-16 引入）。
#
# 事故记录：此前用 `tail 日志 && git merge && git push` 手链合并，tail 恒
# 成功导致门红（exit=1）时照样推上 main，且提交信息写着"门已绿"。
# 北极星要求门是机械裁决——本脚本把"过门才许合并"变成机械事实：
# 门在此进程内现场跑，退出码非零直接终止，杜绝读日志字符串的人为环节。
#
# 用法：bash scripts/merge-gated.sh <branch> "<merge message>"
set -euo pipefail
BRANCH="${1:?usage: merge-gated.sh <branch> <message>}"
MESSAGE="${2:?usage: merge-gated.sh <branch> <message>}"

echo "[merge-gated] running verify:sliderule-v5 (live gate, no log parsing)..."
pnpm run verify:sliderule-v5
echo "[merge-gated] gate GREEN (exit=0). merging ${BRANCH} -> main"
git checkout main
git merge --no-ff "${BRANCH}" -m "${MESSAGE}"
git push -u origin main
git checkout "${BRANCH}"
echo "[merge-gated] done."
