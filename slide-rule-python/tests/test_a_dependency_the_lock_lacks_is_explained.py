"""依赖装不上、因为 package.json 跟锁文件对不上：回执说清原因和后果，不再只给「输出共多少字」。

⚠ 2026-09-30 隔离真机第 135 轮 sr-20260930014337-TAFH3SE2SD（体重记录网页，追问「用 Chart.js 加一个最近 7 天的折线图」）：
  package.json 加了 chart.js，每条命令先跑的 npm ci 按锁文件拒装（原因在日志开头，800 字的尾巴里没有）。模型手改
  锁文件五次，最后悄悄删掉 chart.js 自己画，收尾却写「使用 Chart.js 绘制折线图」。下面 ROUND135_NPM 是那一次安装的原样输出。

判据走真 worker（test_project_command_worker 夹具）跑一条 check，回执走真 command_receipt_from。
把 command_receipt_from 里挂 _lockfile_out_of_sync_sentence 的那两行删掉，第一条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.project_tools import ProjectTools, command_receipt_from
from services.workspace_provider import ProcessLogChunk
from test_project_command_worker import command_setup  # noqa: F401  （夹具）
from test_project_runtime_worker import eventually, setup, state  # noqa: F401  （夹具）

ROUND135_NPM = (
    "user@e2b:~/workspace$ npm ci --ignore-scripts\n"
    "npm error code EUSAGE\nnpm error\n"
    "npm error `npm ci` can only install packages when your package.json and package-lock.json or "
    "npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.\n"
    "npm error\nnpm error Missing: chart.js@4.5.1 from lock file\n"
    "npm error Missing: @kurkle/color@0.3.4 from lock file\nnpm error\nnpm error Clean install a project\n"
    + "npm error aliases: clean-install, ic, install-clean, isntall-clean\n" * 12
    + "npm notice New major version of npm available! 10.8.2 -> 12.1.0\n"
)


def _receipt(command_setup, output):
    store, project, provider, worker, _ = command_setup
    provider.install_code = 1

    def logs(handle, pid, *, offset=0):
        content = (output if pid == "42" else "").encode()
        return ProcessLogChunk(content[offset:].decode(), len(content))
    provider.read_process_logs = logs
    operation = worker.submit_command(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="r135-check", command="check")
    failed = eventually(lambda: state(store, operation, "failed"))
    assert failed.runtime.errorCode == "project_dependency_install_failed"
    return command_receipt_from(ProjectTools(store, None, "alice"), operation.operationId)


def test_the_round135_lockfile_mismatch_is_said_in_words(command_setup):
    hint = _receipt(command_setup, ROUND135_NPM)["hint"]
    assert "chart.js" in hint and "@kurkle/color" in hint and "package-lock.json" in hint
    assert "别说用了它" in hint and "改回去" in hint


def test_other_install_failures_are_not_blamed_on_the_lock(command_setup):
    """反向：别的装包失败（网络、仓库 404）不许说成锁文件对不上。"""
    other = "npm ci --ignore-scripts\nnpm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/nope\n"
    hint = str(_receipt(command_setup, other).get("hint") or "")
    assert "package-lock.json 里" not in hint and "别说用了它" not in hint
