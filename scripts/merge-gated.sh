#!/usr/bin/env bash
# merge-gated —— 合并 main / pre_main 的唯一入口（2026-07-16 引入）。
#
# 事故记录：此前用 `tail 日志 && git merge && git push` 手链合并，tail 恒
# 成功导致门红（exit=1）时照样推上 main，且提交信息写着"门已绿"。
# 北极星要求门是机械裁决——本脚本把"过门才许合并"变成机械事实：
# 门在此进程内现场跑，退出码非零直接终止，杜绝读日志字符串的人为环节。
#
# 分支模型（2026-07-16 用户拍板）：
#   main     = 生产分支。只接受从 pre_main 过门合并（发版动作）。
#   pre_main = 日常集成分支。工作分支过门合并到这里。
#
# 用法：
#   bash scripts/merge-gated.sh <branch> "<merge message>" [target]
#     target 缺省 = pre_main（日常）
#     发版：bash scripts/merge-gated.sh pre_main "<msg>" main
#
# 实现注记：
# - 全部逻辑包在 main() 里：执行中途 checkout 会把本脚本文件换成目标分支
#   上的旧版本，bash 逐行读文件会读串——函数体先整体解析再执行，免疫此坑。
# - 对齐远端用 FETCH_HEAD：本仓 remote 是窄 refspec，`git fetch origin X`
#   只更新 FETCH_HEAD，不建 origin/X 引用（首跑事故实录）。
set -euo pipefail

main() {
  local BRANCH="${1:?usage: merge-gated.sh <branch> <message> [target]}"
  local MESSAGE="${2:?usage: merge-gated.sh <branch> <message> [target]}"
  local TARGET="${3:-pre_main}"

  if [ "${TARGET}" = "main" ] && [ "${BRANCH}" != "pre_main" ]; then
    echo "[merge-gated] REFUSED: main 只接受从 pre_main 发版合并（收到: ${BRANCH}）。"
    echo "[merge-gated] 日常请合到 pre_main；发版： merge-gated.sh pre_main \"<msg>\" main"
    exit 2
  fi

  echo "[merge-gated] running verify:sliderule-v5 (live gate, no log parsing)..."
  pnpm run verify:sliderule-v5
  echo "[merge-gated] gate GREEN (exit=0). merging ${BRANCH} -> ${TARGET}"
  git fetch origin "${TARGET}"
  git checkout "${TARGET}"
  # 与远端对齐（仅快进；有分叉宁可失败人工看，不静默覆盖）
  git merge --ff-only FETCH_HEAD
  git merge --no-ff "${BRANCH}" -m "${MESSAGE}"
  git push -u origin "${TARGET}"
  git checkout "${BRANCH}"
  echo "[merge-gated] done: ${BRANCH} -> ${TARGET}"
}

main "$@"
