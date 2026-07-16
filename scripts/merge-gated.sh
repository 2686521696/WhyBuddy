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
# E24 提速（2026-07-16 用户确认，验证强度不减）：
# - 纯文档轻门：待合内容只碰 *.md / docs/** 时，机械路径判定改跑
#   verify:sliderule-v5:light（两批 vitest）——文档不进编译不进运行时。
# - 同树收据：全门绿后把代码树指纹写进 .git/sliderule-gate-receipt；
#   发版时若 pre_main 树指纹与收据一致且未过期（2h），免重复跑——
#   裁决依据是哈希相等，仍是机械事实，同一棵树不重复审两次。
#   轻门不写收据（轻门本身只要几十秒）。
#
# 实现注记：
# - 全部逻辑包在 main() 里：执行中途 checkout 会把本脚本文件换成目标分支
#   上的旧版本，bash 逐行读文件会读串——函数体先整体解析再执行，免疫此坑。
# - 对齐远端用 FETCH_HEAD：本仓 remote 是窄 refspec，`git fetch origin X`
#   只更新 FETCH_HEAD，不建 origin/X 引用（首跑事故实录）。
set -euo pipefail

RECEIPT_FILE=".git/sliderule-gate-receipt"
RECEIPT_TTL_SECONDS=7200

main() {
  local BRANCH="${1:?usage: merge-gated.sh <branch> <message> [target]}"
  local MESSAGE="${2:?usage: merge-gated.sh <branch> <message> [target]}"
  local TARGET="${3:-pre_main}"

  if [ "${TARGET}" = "main" ] && [ "${BRANCH}" != "pre_main" ]; then
    echo "[merge-gated] REFUSED: main 只接受从 pre_main 发版合并（收到: ${BRANCH}）。"
    echo "[merge-gated] 日常请合到 pre_main；发版： merge-gated.sh pre_main \"<msg>\" main"
    exit 2
  fi

  if [ -n "$(git status --porcelain)" ]; then
    echo "[merge-gated] REFUSED: 工作区不干净——先提交或 stash（门只审已提交内容）。"
    exit 2
  fi

  git fetch origin "${TARGET}"

  # 待合内容 = TARGET 与 BRANCH 的三点差异（自 merge-base 起 BRANCH 引入的文件）
  local changed
  changed="$(git diff --name-only "FETCH_HEAD...${BRANCH}")"
  local docs_only=1
  if [ -z "${changed}" ]; then
    docs_only=1  # 无新内容（如发版一次纯同步）→ 轻门即可
  else
    while IFS= read -r f; do
      case "$f" in
        *.md|docs/*) ;;
        *) docs_only=0; break ;;
      esac
    done <<< "${changed}"
  fi

  local tree_now epoch_now
  tree_now="$(git rev-parse "${BRANCH}^{tree}")"
  epoch_now="$(date +%s)"

  if [ "${docs_only}" -eq 1 ]; then
    echo "[merge-gated] docs-only change set → light gate (vitest only)"
    pnpm run verify:sliderule-v5:light
    echo "[merge-gated] light gate GREEN (exit=0)."
  elif [ -f "${RECEIPT_FILE}" ]; then
    local r_tree r_epoch
    r_tree="$(sed -n 1p "${RECEIPT_FILE}")"
    r_epoch="$(sed -n 2p "${RECEIPT_FILE}")"
    if [ "${r_tree}" = "${tree_now}" ] && [ $((epoch_now - r_epoch)) -lt "${RECEIPT_TTL_SECONDS}" ]; then
      echo "[merge-gated] same-tree receipt hit (tree=${tree_now:0:12}, age=$((epoch_now - r_epoch))s) → skip re-run"
    else
      run_full_gate "${tree_now}"
    fi
  else
    run_full_gate "${tree_now}"
  fi

  echo "[merge-gated] merging ${BRANCH} -> ${TARGET}"
  git checkout "${TARGET}"
  # 与远端对齐（仅快进；有分叉宁可失败人工看，不静默覆盖）
  git merge --ff-only FETCH_HEAD
  git merge --no-ff "${BRANCH}" -m "${MESSAGE}"
  git push -u origin "${TARGET}"

  # 合并结果树 == 被验证树时，收据跟着结果走（发版免重跑的依据）
  local merged_tree
  merged_tree="$(git rev-parse "HEAD^{tree}")"
  if [ "${docs_only}" -eq 0 ] && [ "${merged_tree}" = "${tree_now}" ]; then
    printf '%s\n%s\n' "${merged_tree}" "$(date +%s)" > "${RECEIPT_FILE}"
  fi

  git checkout "${BRANCH}"
  echo "[merge-gated] done: ${BRANCH} -> ${TARGET}"
}

run_full_gate() {
  local tree="$1"
  echo "[merge-gated] running verify:sliderule-v5 (live gate, no log parsing)..."
  pnpm run verify:sliderule-v5
  echo "[merge-gated] gate GREEN (exit=0)."
  printf '%s\n%s\n' "${tree}" "$(date +%s)" > "${RECEIPT_FILE}"
}

main "$@"
