"""Managed business acceptance profiles and approved requirement extraction.

This scope is explicit and versioned. Selecting a template alone does not certify
unlisted requirements (for example billing or integrations). A release must name
this profile and carry its independent runtime evidence for the same source.
The fixed task suite remains the executable baseline.  User supplied acceptance
requirements are carried alongside it as an explicit contract so that a later
browser runner can implement them; until such assertions exist they must not
make delivery eligible.
"""

import hashlib

TASK_ACCEPTANCE_PROFILE = "whybuddy-tasks-acceptance@1"
TASK_TEMPLATE_VERSION = "whybuddy-react-vite-tasks-1"
TASK_SUITE_VERSION = "react-vite-tasks@1"
# ⚠ 2026-09-25 隔离真机 sr-20260925025649-74E9KCWHAB（记账网页）：通用模板的
#   工程只能被派去跑 react-vite-counter@1——它点的是模板自带的计数器 demo，
#   模型把 App 换成记账页之后必然不过；交付闸又只认任务模板，
#   project_acceptance_profile_not_bound 对任何非任务应用都永远成立。
#   普通网页从此有自己的证据：当前版本构建通过、预览打得开、页面真的渲染出
#   内容（按用户看得见的 innerText）、刷新后还在、没有页面错误和失败请求，
#   全部由独立浏览器沙盒确认。计数器套件留给历史记录，不再派新活。
APP_TEMPLATE_VERSION = "whybuddy-react-vite-1"
APP_SUITE_VERSION = "react-vite-app@1"
WEB_ACCEPTANCE_PROFILE = "whybuddy-web-acceptance@1"


def suite_for_template(template_version):
    """这个模板的工程该派哪套独立浏览器验收。

    其余模板名（线上没有，只有测试夹具的替身）照旧派计数器套件。
    """
    return {TASK_TEMPLATE_VERSION: TASK_SUITE_VERSION,
        APP_TEMPLATE_VERSION: APP_SUITE_VERSION}.get(template_version, "react-vite-counter@1")


def template_verification_capabilities(template_version):
    suite = {TASK_TEMPLATE_VERSION: TASK_SUITE_VERSION,
        APP_TEMPLATE_VERSION: APP_SUITE_VERSION}.get(template_version)
    return ["verification:" + suite] if suite else []


def bound_delivery_profile(template_version, spec_revision):
    """(profileId, suiteVersion)：这份源码绑定的交付档；没绑上返回 None。"""
    if template_version == TASK_TEMPLATE_VERSION and spec_revision == TASK_ACCEPTANCE_PROFILE:
        return TASK_ACCEPTANCE_PROFILE, TASK_SUITE_VERSION
    if template_version == APP_TEMPLATE_VERSION and spec_revision is None:
        return WEB_ACCEPTANCE_PROFILE, APP_SUITE_VERSION
    return None


TASK_REQUIREMENTS = (
    "Independent application administrator and reader login",
    "Create, edit and filter tasks through a real API",
    "Persist application data across page refresh",
    "Reject writes by readers and unauthenticated users",
    "Build locked source and render without resource or page errors",
)


def suite_matches_profile(suite_version, spec_revision):
    """验收记录的套件和它那份源码绑定的交付档对得上。"""
    return ((suite_version == TASK_SUITE_VERSION and spec_revision == TASK_ACCEPTANCE_PROFILE)
        or (suite_version == APP_SUITE_VERSION and spec_revision is None))


WEB_REQUIREMENTS = (
    "Build the current locked source",
    "Open the private preview of that exact revision",
    "Render visible content in an independent browser",
    "Still render visible content after a page refresh",
    "No page errors and no failed requests",
)


def normalize_acceptance_requirements(values):
    """Return bounded, de-duplicated user requirements suitable for a contract.

    Requirements are intentionally read only from server-owned goal fields.  A
    client cannot smuggle arbitrary text through ``project_verify`` because the
    control session is the source of truth.
    """
    if not isinstance(values, (list, tuple)):
        return []
    result = []
    seen = set(TASK_REQUIREMENTS) | set(WEB_REQUIREMENTS)
    for value in values:
        text = str(value or "").strip()
        if not text or len(text) > 1200 or text in seen:
            continue
        seen.add(text)
        result.append(text)
        if len(result) >= 16:
            break
    return result


def approved_acceptance_requirements(state):
    """Extract explicit requirements approved with the current plan.

    The caller must validate plan approval before invoking this helper.
    ``acceptanceRequirements`` is the preferred durable field.  ``requirements``
    and ``acceptanceCriteria`` are accepted for compatibility with older goal
    writers.  Plan prose is deliberately not parsed: free-form prose is not an
    executable assertion and must never silently become delivery evidence.
    """
    goal = getattr(state, "goal", None)
    goal = goal if isinstance(goal, dict) else {}
    for key in ("acceptanceRequirements", "requirements", "acceptanceCriteria"):
        values = normalize_acceptance_requirements(goal.get(key))
        if values:
            return values
    return []


def acceptance_profile(additional_requirements=None, suite_version=TASK_SUITE_VERSION):
    extras = normalize_acceptance_requirements(additional_requirements)
    web = suite_version == APP_SUITE_VERSION
    base_id = WEB_ACCEPTANCE_PROFILE if web else TASK_ACCEPTANCE_PROFILE
    profile_id = base_id
    if extras:
        digest = hashlib.sha256("\n".join(extras).encode("utf-8")).hexdigest()[:16]
        profile_id = f"{base_id}+{digest}"
    return {"profileId": profile_id, "suiteVersion": APP_SUITE_VERSION if web else TASK_SUITE_VERSION,
        "requirements": list(WEB_REQUIREMENTS if web else TASK_REQUIREMENTS) + extras,
        "outsideScope": ["Additional user requirements", "Production deployment", "Production account operations"],
        "dataRecovery": "Last durable checkpoint; normal stop checkpoints after stopping the application"}
