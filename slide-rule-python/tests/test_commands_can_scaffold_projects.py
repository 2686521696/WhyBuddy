"""命令在沙盒里生成、改动的源码收回成工程新版本：官方脚手架能用，`npm install 某包` 改的 package.json 留得住。

⚠ 2026-10-09：每条命令开跑前工人按库里那版重写沙盒——命令生成的文件下一条就没了。通用 Agent 接 Vue / Django /
  Go / .NET 的活，官方脚手架（npm create vue、django-admin startproject、cargo new、dotnet new）全部白跑。
  真 E2B（whybuddy-workspace 镜像）上跑过：npm create vite（vue）+ npm install + build、cargo new（自己 git init）、
  dotnet new webapi + build，扫描 0.3 秒，收回 Vue / Rust / .NET 源码，node_modules、dist、obj、bin/Debug 不收。

判据：
- 扫描脚本（产线那一份，本机 python3 + 真 git 跑）：认 .gitignore、钻进自己 git init 的子目录、挡依赖和构建产物、
  二进制和超大文件点名不收、删掉的算删掉、上传原件和交付文件不算源码；
- 真工人跑一条命令：沙盒里新生成的文件成了新版本，会话指针跟上，回执里模型读得到收回了什么；
- 反向：命令跑着的时候别的写入先落了库 → 不覆盖，回执照实说没收回、怎么办；没变就不添一版。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.project_manifest import MAX_FILE_BYTES, MAX_PROJECT_BYTES
from services.project_source_scan import SCAN_SCRIPT, scan_request
from services.rehearsal_control import bound_tool_result
from test_project_command_worker import CommandProvider, submit
from test_project_runtime_worker import eventually, setup, state  # noqa: F401  （夹具）

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="needs git")


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _scan(root: Path, synced: dict[str, str], **kw) -> dict:
    """产线那份脚本、同一个入口（scan_request），本机 python3 跑——跟沙盒里一字不差。"""
    request = scan_request(str(root), {k: _sha(v) for k, v in synced.items()},
                           max_file=MAX_FILE_BYTES, max_total=MAX_PROJECT_BYTES, **kw)
    done = subprocess.run([sys.executable, "-c", SCAN_SCRIPT], input=json.dumps(request), capture_output=True,
                          text=True, timeout=60, check=True)
    return json.loads(done.stdout)


def _write(root: Path, files: dict[str, str | bytes]):
    for name, body in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body if isinstance(body, bytes) else body.encode())


TEMPLATE = {"README.md": "# 工程\n", "package.json": '{"name":"app"}\n', "src/counter.mjs": "export const n = 0;\n"}


# ── 扫描脚本 ────────────────────────────────────────────────────────────────────────────────────

def test_a_scaffold_comes_back_and_the_noise_does_not(tmp_path):
    _write(tmp_path, TEMPLATE)
    _write(tmp_path, {
        "package.json": '{"name":"app","dependencies":{"vue":"^3"}}\n',          # npm install vue 改的
        "web/.gitignore": "node_modules\ndist\n*.local\n",                       # npm create vite 生成的
        "web/src/App.vue": "<template><h1>读书打卡</h1></template>\n",
        "web/node_modules/vue/index.js": "module.exports = {}\n",
        "web/dist/index.html": "<html></html>\n",
        "web/secret.local": "TOKEN=1\n",                                          # 项目自己的 .gitignore 挡掉的
        "node_modules/x/index.js": "x\n",
        "api/obj/project.assets.json": "{}\n", "api/bin/Debug/net8.0/api.deps.json": "{}\n",   # .NET 构建输出
        "api/Program.cs": "var app = WebApplication.Create();\n",
        "logo.png": b"\x89PNG\r\n\x1a\n\x00\x00binary",
        "big.json": "x" * (MAX_FILE_BYTES + 1),
        "output/报告.md": "# 交付\n",                                              # 交付文件：产物库另收
        ".sliderule/skills/a/SKILL.md": "skill\n",
        "报价单.xlsx": b"PK\x03\x04uploaded",                                      # 用户上传的原件
        "__whybuddy_revision.json": '{"revision": "r1"}',
    })
    (tmp_path / "src/counter.mjs").unlink()                                       # 命令删掉的
    report = _scan(tmp_path, TEMPLATE, skip_paths=["报价单.xlsx"])
    assert report["lister"] == "git"
    assert set(report["changed"]) == {"package.json", "web/.gitignore", "web/src/App.vue", "api/Program.cs"}
    assert report["deleted"] == ["src/counter.mjs"]
    assert {(item["path"], item["reason"]) for item in report["skipped"]} == {
        ("logo.png", "binary"), ("big.json", "too_large")}


def test_a_subfolder_that_ran_its_own_git_init_is_entered(tmp_path):
    """create-next-app、cargo new 会自己 git init：外层 git 只列出「svc/」一个目录名，不钻进去就一个文件都收不到。"""
    _write(tmp_path, TEMPLATE)
    _write(tmp_path, {"svc/Cargo.toml": '[package]\nname = "svc"\n', "svc/src/main.rs": "fn main() {}\n",
                      "svc/.gitignore": "/target\n", "svc/target/debug/svc.d": "deps\n"})
    subprocess.run(["git", "init", "-q", str(tmp_path / "svc")], check=True)
    report = _scan(tmp_path, TEMPLATE)
    assert set(report["changed"]) == {"svc/Cargo.toml", "svc/src/main.rs", "svc/.gitignore"}


def test_the_revision_markers_the_worker_writes_are_never_source():
    """§4：工人往沙盒里写修订标记的两个位置，扫描都挡着。"""
    from services.project_runtime import REVISION_FILE
    from services.project_source_scan import EXCLUDED_FILES
    from services.workspace_provider import PROJECT_REVISION_FILE
    assert {REVISION_FILE, PROJECT_REVISION_FILE} <= set(EXCLUDED_FILES)


def test_nothing_changed_means_nothing_to_write(tmp_path):
    _write(tmp_path, TEMPLATE)
    report = _scan(tmp_path, TEMPLATE)
    assert report["changed"] == {} and report["deleted"] == [] and report["skipped"] == []


# ── 真工人：命令跑完，沙盒里的源码成了新版本 ──────────────────────────────────────────────────────

class ScaffoldingProvider(CommandProvider):
    """沙盒是一个真目录：write_files 写进去，命令真的在里面生成文件，collect_source_changes 跑产线扫描脚本。"""

    def __init__(self, root: Path, scaffold: dict[str, str]):
        super().__init__()
        self.root, self.scaffold, self.on_command = root, scaffold, None

    def write_files(self, handle, files):
        super().write_files(handle, files)
        _write(self.root, files)                                                # 跟 E2B 一样：写进去，不清空别的

    def start_process(self, handle, command, **kwargs):
        started = super().start_process(handle, command, **kwargs)
        if not command.startswith("npm ci"):
            _write(self.root, self.scaffold)
            if self.on_command:
                self.on_command()
        return started

    def collect_source_changes(self, handle, synced_hashes, *, skip_paths=()):
        request = scan_request(str(self.root), synced_hashes, max_file=MAX_FILE_BYTES, max_total=MAX_PROJECT_BYTES,
                               skip_paths=skip_paths)
        done = subprocess.run([sys.executable, "-c", SCAN_SCRIPT], input=json.dumps(request), capture_output=True,
                              text=True, timeout=60, check=True)
        return json.loads(done.stdout)


SCAFFOLD = {"package.json": '{"name":"app","dependencies":{"vue":"^3.5"}}', "index.html": "<div id=app></div>",
            "src/App.vue": "<template><h1>读书打卡</h1></template>", "node_modules/vue/index.js": "x"}


@pytest.fixture
def scaffolding(setup, tmp_path):  # noqa: F811
    store, project, _, make_worker, _ = setup
    provider = ScaffoldingProvider(tmp_path / "sandbox", SCAFFOLD)
    worker = make_worker()
    worker.provider_factory = lambda: provider
    return store, project, provider, worker


def _receipt(store, op):
    """模型拿到的命令终态回执（command_receipt_from：快照 + 日志尾 + 那几句话），不是裸快照。"""
    from services.project_tools import ProjectTools, command_receipt_from
    return command_receipt_from(ProjectTools(store, None, "alice"), op.operationId)


def test_what_the_command_generated_becomes_the_next_version(scaffolding):
    store, project, provider, worker = scaffolding
    op = submit(worker, project, command="build", key="scaffold")
    assert eventually(lambda: state(store, op, "stopped")).status == "completed"
    current = store.get_project(project.projectId, owner_id="alice").currentRevision
    assert current != project.currentRevision                                     # 添了一版
    files = store.read_files(project.projectId, current, owner_id="alice")
    assert files["src/App.vue"] == SCAFFOLD["src/App.vue"] and files["package.json"] == SCAFFOLD["package.json"]
    assert "node_modules/vue/index.js" not in files
    receipt = _receipt(store, op)
    assert receipt["sourceWriteBack"]["revision"] == current
    fed = bound_tool_result({"tool": "shell_exec", **receipt}, "shell_exec")       # 模型真正读到的那串
    assert "已经收回成新版本" in fed and "src/App.vue" in fed, fed[:800]
    # 下一条命令开跑时写进沙盒的就是这一版——不再被还原
    op2 = submit(worker, project.model_copy(update={"currentRevision": current}), command="check", key="next")
    assert eventually(lambda: state(store, op2, "stopped")).status == "completed"
    assert provider.contents.get("src/App.vue") == SCAFFOLD["src/App.vue"]


def test_a_scaffold_the_source_store_cannot_hold_is_reported_not_half_written(scaffolding):
    """源码库一份工程最多 512 个文件：脚手架生成 600 个，不写半截，回执照实说没收回、怎么办。"""
    store, project, provider, worker = scaffolding
    provider.scaffold = {f"src/generated/part{i}.ts": f"export const p{i} = {i};\n" for i in range(600)}
    op = submit(worker, project, command="build", key="too-many")
    eventually(lambda: state(store, op, "stopped"))
    assert store.get_project(project.projectId, owner_id="alice").currentRevision == project.currentRevision
    receipt = _receipt(store, op)
    assert receipt["sourceWriteBack"]["error"] == "invalid_project_file_count", receipt["sourceWriteBack"]
    fed = bound_tool_result({"tool": "shell_exec", **receipt}, "shell_exec")
    assert "没能收回" in fed and "file_write" in fed, fed[:800]


def test_a_command_that_changed_nothing_adds_no_version(scaffolding):
    store, project, provider, worker = scaffolding
    provider.scaffold = {}
    op = submit(worker, project, command="check", key="nothing")
    assert eventually(lambda: state(store, op, "stopped")).status == "completed"
    assert store.get_project(project.projectId, owner_id="alice").currentRevision == project.currentRevision
    assert "sourceWriteBack" not in _receipt(store, op)
