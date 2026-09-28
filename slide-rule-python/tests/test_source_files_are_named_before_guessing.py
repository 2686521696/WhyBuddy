"""系统提示里给出当前版本的源码清单，模型开口前就知道有哪些文件。

⚠ 2026-09-28 隔离真机第 94 轮 sr-20260928081512-PXESY6QGRA（单词卡片网页，追问「加一个暗色模式切换按钮」）：追问一开口同一批
  并行读 `src/App.tsx`、`src/App.css`、`src/index.css`——Vite 默认名，这个模板是 `src/main.tsx` +
  `src/style.css`。三发全是 project_file_not_found；回执里「src 下现有：…」救不了同一批里的另外
  两发。全库 48 次 file_not_found 里 36 次是这三个名字，分布在二十来轮。

判据走真 `_system_prompt` + 真 ProjectTools + SQL 存储，清单跟库里当前版本逐项对。
把 _system_prompt 里挂清单的那句删掉，前两条变红。
"""

from __future__ import annotations

from models.v5_state import V5SessionState
from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import rehearsal_control as rc
from test_project_tools import create, execute, setup  # noqa: F401  （夹具）


def _prompt(setup, **changes):
    payload = {**setup.sessions.load(setup.state.sessionId).payload, **changes}
    state = V5SessionState.server_load(payload)
    token = rc._PROJECT_TOOLS.set(setup.tools)
    try:
        return rc._system_prompt(state)
    finally:
        rc._PROJECT_TOOLS.reset(token)


def _head_paths(setup):
    project = setup.store.get_project_for_session(setup.state.sessionId, owner_id="alice")
    return [e.path for e in setup.store.get_revision(project.projectId, owner_id="alice").manifest.files]


def _listed(prompt):
    marker = "当前源码文件（只有这些，别按别的模板猜文件名）："
    assert marker in prompt, prompt[-1500:]
    return prompt.split(marker, 1)[1].split("。", 1)[0].split(", ")


def test_the_prompt_names_every_source_file_of_the_current_revision(setup):
    create(setup)
    listed = _listed(_prompt(setup))
    expected = [p for p in _head_paths(setup) if p not in {"package-lock.json"}
                and not p.startswith(("public/_whybuddy/", ".sliderule/", "bridge/"))]
    assert listed == expected and listed


def test_the_listing_follows_the_live_revision(setup):
    """§三：不是建工程时抄一份死清单——写进一个新文件，下一次提示里就有。"""
    create(setup)
    assert "src/style.css" not in _listed(_prompt(setup))
    assert execute(setup, "file_write", {"file": "src/style.css", "content": "body{}\n"})["ok"]
    assert "src/style.css" in _listed(_prompt(setup))


def test_host_injected_and_lock_files_are_not_listed(setup):
    create(setup)
    execute(setup, "file_write", {"file": "public/_whybuddy/editor.js", "content": "x\n"})
    execute(setup, "file_write", {"file": "package-lock.json", "content": "{}\n"})
    listed = _listed(_prompt(setup))
    assert "package-lock.json" not in listed
    assert not any(p.startswith("public/_whybuddy/") for p in listed)


def test_no_project_means_no_listing(setup):
    """反向：还没建工程（规划阶段）不编清单。"""
    prompt = _prompt(setup, projectId=None, projectRevision=None)
    assert "当前源码文件" not in prompt
