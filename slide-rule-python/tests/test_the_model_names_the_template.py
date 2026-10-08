"""两方都能决定模板时，不许先到的悄悄赢：模型点名的模板算数；换不了就照实说。

⚠ 2026-10-08 真机 sr-20261008144247-5MEAE5TMRS（读书打卡）：浏览器自动创建先到，建成 react-vite-tasks；
  模型那句 project_create {"templateId": "react-vite"} 只拿回已有工程，回执只有一串版本号。
  那一刻工程只有根修订（14:45:45 建，模型第一次写在 14:47:40）、一个运行操作都没有（第一个在 14:48:58）——
  「一字没动、电脑没开」在真机上真的成立，不是测试自己拼出来的条件。

判据走真路由 + 真 ProjectTools + 真 SQL 存储；浏览器那一发用旧前端包的原样 body（4571de1 之前的前端
发的就是 templateId: react-vite-tasks，部署前打开的标签页刷新前照样发），模型那一发照真机参数。
"""

from __future__ import annotations

from services import persistence
from services.project_acceptance import suite_for_template
from services.project_creation import TASK_TEMPLATE_VERSION, TEMPLATE_VERSION
from services.project_tools import ProjectTools
from services.rehearsal_control import bound_tool_result
from test_browser_create_is_not_a_task_app import _create, world  # noqa: F401  （夹具）

OLD_BUNDLE = "react-vite-tasks"                       # 旧前端包自动创建发的 templateId
MODEL_ARGS = {"templateId": "react-vite"}             # 真机模型那一发的原样参数


def _model_creates(store):
    state = persistence.load_session_record("sr-reading")["session"]
    return ProjectTools(store, None, "alice").execute("project_create", dict(MODEL_ARGS), state)


def _current(store, project_id):
    return store.get_revision(project_id, owner_id="alice")


def test_the_browser_got_there_first_and_the_model_still_gets_its_template(world):
    client, store, ref = world
    project = _create(client, {"approvalRef": ref, "templateId": OLD_BUNDLE})
    assert _current(store, project["projectId"]).templateVersion == TASK_TEMPLATE_VERSION     # 真机那一刻的局面
    receipt = _model_creates(store)
    assert receipt["ok"] and receipt["projectId"] == project["projectId"]                     # 同一份工程，不是另建
    assert receipt["templateVersion"] == TEMPLATE_VERSION
    assert "database.mjs" not in receipt["files"] and "src/counter.mjs" in receipt["files"]
    current = _current(store, project["projectId"])
    assert suite_for_template(current.templateVersion) == "react-vite-app@1"                  # 验收真的换了套件
    assert current.specRevision is None
    assert "templateNote" not in receipt                                                       # 换成了就不用解释
    session = persistence.load_session_record("sr-reading")["session"]
    assert session.projectRevision == current.revision                                         # 会话指针跟上了新版


def test_the_browser_never_swaps_back_what_the_model_chose(world):
    """反向：浏览器那条路只负责「有一份工程」。模型先建了 react-vite，旧标签页再发 tasks，不许被换回去。"""
    client, store, ref = world
    receipt = _model_creates(store)
    assert receipt["templateVersion"] == TEMPLATE_VERSION
    _create(client, {"approvalRef": ref, "templateId": OLD_BUNDLE})
    assert _current(store, receipt["projectId"]).templateVersion == TEMPLATE_VERSION


def _edit(store, project_id, ref):
    current = _current(store, project_id)
    files = store.read_files(project_id, current.revision, owner_id="alice")
    files["src/main.tsx"] += "\n// 读书打卡：第一版\n"
    store.commit_revision(project_id, owner_id="alice", expected_revision=current.revision, files=files,
        template_version=current.templateVersion, plan_ref=ref, spec_revision=current.specRevision)


def test_an_edited_project_is_not_wiped_and_the_receipt_says_why(world):
    client, store, ref = world
    project = _create(client, {"approvalRef": ref, "templateId": OLD_BUNDLE})
    _edit(store, project["projectId"], ref)
    receipt = _model_creates(store)
    assert receipt["templateVersion"] == TASK_TEMPLATE_VERSION                                 # 写过的东西不抹
    assert "// 读书打卡：第一版" in store.read_files(project["projectId"], owner_id="alice")["src/main.tsx"]
    fed = bound_tool_result({"tool": "project_create", **receipt}, "project_create")           # 模型真正读到的那串
    assert "react-vite-tasks" in fed and "已经改过" in fed and "任务清单验收" in fed and "告诉用户" in fed, fed[:600]


def test_a_running_computer_is_not_swapped_under_it(world):
    client, store, ref = world
    project = _create(client, {"approvalRef": ref, "templateId": OLD_BUNDLE})
    lease = store.acquire_lease(project["projectId"], owner_id="alice", lease_owner="runtime-1", ttl_seconds=60)
    store.renew_lease(project["projectId"], owner_id="alice", lease_owner="runtime-1", generation=lease.generation,
                      sandbox_id="sbx-1")
    store.release_lease(project["projectId"], owner_id="alice", lease_owner="runtime-1", generation=lease.generation)
    receipt = _model_creates(store)
    assert receipt["templateVersion"] == TASK_TEMPLATE_VERSION
    assert "templateNote" in receipt


def test_matching_templates_say_nothing(world):
    client, store, ref = world
    project = _create(client, {"approvalRef": ref})
    receipt = _model_creates(store)
    assert receipt["templateVersion"] == TEMPLATE_VERSION and "templateNote" not in receipt
    # 对得上就一版都不添：新修订会让已有的验收作废（验收绑定在修订上），重复 project_create 不许有这个副作用。
    assert receipt["revision"] == project["currentRevision"]


def test_a_busy_computer_does_not_break_project_create(world):
    """纠偏是增强，fail-open：电脑正被别的操作占着（租约没到期），project_create 照样成功，回执照实说。"""
    client, store, ref = world
    project = _create(client, {"approvalRef": ref, "templateId": OLD_BUNDLE})
    store.acquire_lease(project["projectId"], owner_id="alice", lease_owner="runtime-busy", ttl_seconds=60)
    receipt = _model_creates(store)
    assert receipt["ok"] and receipt["templateVersion"] == TASK_TEMPLATE_VERSION, receipt
    assert "templateNote" in receipt
