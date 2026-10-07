# -*- coding: utf-8 -*-
"""控制面技能目录与加载信封。抄 grok-build Skill 工具。

渐进披露：目录只给 name + description；正文只在 skill 工具回。
本模块是叶子：吃已经开箱的文本，不读 OSS、不读表。
"""

from __future__ import annotations

import re
import textwrap
from urllib.parse import quote
from dataclasses import dataclass
from typing import Sequence

MAX_NAME_LEN = 64
MAX_DESCRIPTION_LEN = 1024

#: ⚠ 2026-09-28 隔离真机第 92～96 轮（每轮装两份技能）：模型只加载跟**产出格式**直接挂钩的
#:   （office-skills、pptx-*、frontend-design），跟**内容做好**挂钩的一次没碰——第 93 轮做的
#:   就是 KPI 看板，装着的 kpi-dashboard-design、data-storytelling 五个回合都没打开；第 96 轮
#:   写策划方案，avoid-ai-writing 没打开。原来这里写「任务对得上下面某一份时再加载」，模型读成
#:   「格式对上才算」。用户的决定：装了没点名也要推，但时机和取舍由 Agent 自己定——所以这里只把
#:   「对口」的范围说清，不点名、不强制；不对口的照旧不许硬套。
_SKILL_TOOL_LEAD = (
    "加载一份磁盘上的技能（SKILL.md）。"
    "目录只给名字和一句话；全文只在你调用这件工具时喂回来。"
    "不是应用市场那份语义档案。"
    "下面这些都是用户自己装的——装了就是希望在对口的地方用上。"
    "对口不只看产出格式：内容怎么组织、怎么写、怎么设计、数据怎么讲、做完怎么验，"
    "只要某一份能让这次结果更好，就在动手前加载它；跟这次任务无关的不要硬套。"
    "技能目录在工程沙盒 .sliderule/skills/<name>/，脚本用 shell_exec 跑。"
)


@dataclass(frozen=True)
class SkillInfo:
    name: str
    description: str
    path: str
    body: str
    enabled: bool = True
    #: 包里给人看的文件（PDF / 图片，相对技能根）。模型读不了正文，只能给用户链接（skill_asset_url）。
    assets: tuple[str, ...] = ()


def normalize_skill_name(name: str) -> str:
    # ⚠ 2026-10-07 全量扫描 24 份种子：systematic-debugging 正文写「Use the `superpowers:verification-before-completion`
    #   skill before claiming success」——Claude Code 的插件命名空间写法。verification-before-completion 明明装着，
    #   「:」被换成「-」成了 superpowers-verification-before-completion，skill_not_found：技能里点名另一份技能那一步
    #   静静断掉。技能名只许 a-z0-9-，冒号前只能是命名空间，按 Claude Code 的认法取冒号后那一段。
    raw = (name or "").strip()
    if ":" in raw:
        raw = raw.rsplit(":", 1)[1]
    out: list[str] = []
    for ch in raw.lower():
        mapped = ch if ("a" <= ch <= "z" or "0" <= ch <= "9") else "-"
        if mapped == "-" and out and out[-1] == "-":
            continue
        out.append(mapped)
    return "".join(out).strip("-")


def is_valid_skill_name(name: str) -> bool:
    if not name or len(name) > MAX_NAME_LEN:
        return False
    if name.startswith("-") or name.endswith("-") or "--" in name:
        return False
    return all("a" <= ch <= "z" or "0" <= ch <= "9" or ch == "-" for ch in name)


def parse_skill_md(text: str, *, path: str, name: str = "") -> SkillInfo | None:
    frontmatter, body = _split_frontmatter(text or "")
    fields = _parse_frontmatter_scalars(frontmatter)
    slug = normalize_skill_name(fields.get("name") or name or _name_from_path(path))
    if not is_valid_skill_name(slug):
        return None
    description = (
        fields.get("description")
        or fields.get("when-to-use")
        or _first_paragraph(body)
    ).strip()[:MAX_DESCRIPTION_LEN]
    if not description:
        return None
    enabled = not (
        (fields.get("disable-model-invocation") or "").lower() == "true"
        or (fields.get("enabled") or "").lower() == "false"
    )
    return SkillInfo(
        name=slug,
        description=description,
        path=path,
        body=body,
        enabled=enabled,
    )


def catalog_xml(skills: Sequence[SkillInfo]) -> str:
    live = [s for s in skills if s.enabled]
    if not live:
        return (
            "<available_skills>\n"
            "(还没有已安装的技能。去技能商店安装完整包。)\n"
            "</available_skills>"
        )
    lines = ["<available_skills>"]
    for skill in live:
        lines.append("  <skill>")
        lines.append(f"    <name>{_xml_escape(skill.name)}</name>")
        lines.append(f"    <description>{_xml_escape(skill.description)}</description>")
        lines.append(f"    <location>{_xml_escape(skill.path)}</location>")
        lines.append("  </skill>")
    lines.append("</available_skills>")
    return "\n".join(lines)


def skill_tool_description(skills: Sequence[SkillInfo]) -> str:
    return f"{_SKILL_TOOL_LEAD}\n\n{catalog_xml(skills)}"


def skill_base_dir(skill: SkillInfo) -> str:
    """这份技能在沙盒里的目录（工作区根下）。path 是 `.sliderule/skills/<name>/SKILL.md`。"""
    path = str(skill.path or "").replace("\\", "/")
    return path.rsplit("/", 1)[0] + "/" if path.lower().endswith("/skill.md") else ""


def build_skill_message(skill: SkillInfo, args: str | None = None) -> str:
    extra = f' args="{_xml_escape(args)}"' if args else ""
    base = skill_base_dir(skill)
    # ⚠ 2026-09-28 隔离真机第 80 轮 sr-20260928014044-76AFAFC2M1（装了 webapp-testing，追问
    #   「用 webapp-testing 技能把新增、勾选完成、删除点一遍」）：正文写 `python scripts/with_server.py
    #   --help`，模型在工作区根原样照跑——脚本在 .sliderule/skills/webapp-testing/scripts/ 下。
    #   正文里的相对路径是相对技能目录的；只给一个 path 属性，模型没把它当成根。
    #   抄 Claude Code 的 skill 回执：正文前先说「Base directory for this skill」。
    lead = (
        f"Base directory for this skill: {base}（工作区根下）。"
        f"正文里的相对路径（scripts/…、resources/…、references/…）都相对这个目录；"
        f"在工作区里跑要写全：python3 {base}scripts/…\n"
        f"正文让你读包里的文件（examples/…、references/…）时，可直接 skill(name=\"{_xml_escape(skill.name)}\", "
        f"file=\"examples/…\") 读——没有工作区也能读。\n\n"
        if base else ""
    )
    # ⚠ 2026-10-06 真机 r43 sr-20261006155721-4Q5VJN23EJ（@ui-ux-pro-max 宠物医院配色）：脚本真跑了、色值来自设计库，
    #   但主按钮建议「#EA580C 底 + 白字」（3.56:1）、主色「#0D9488 + 白字」（3.74:1）——这份技能把「Contrast 4.5:1」
    #   列为 CRITICAL 必查项，手里有 calculate / sandbox_run，交付前就是没对。规划档有承诺块（_plan_skill_commitments），
    #   直接回答的回合没有任何一处提醒「技能自己的必查项要对一遍」。补在正文末尾，所有技能、所有档位同一句。
    # ⚠ 2026-10-07 试过、无效、已撤回——别再试同一招：真机 r57–r59（@humanizer-zh 润色季度总结，同一段话跑三遍）
    #   都把原文「就会提升 20%」改成「可能」、都加了原文没有的「接下来将继续优化」；这份技能的核对写在「工作流程」
    #   第 3 步，不沾下面点名的任何标签。把这句放宽成「工作流程里的对照 / 检查步骤也照做，有不符先改再交」后再跑
    #   三遍（r60–r62）：两遍照旧改确定程度、三遍照旧加话——3 对 3 没有差别。技能正文完整送到了、提醒也在，
    #   模型就是一次写完直接交：这是模型对软性编辑规则的遵循度，不是编排缺了什么，一句提示挪不动它。
    tail = ("\n\n交付前：把这份技能里标为必须 / CRITICAL / 检查清单（checklist）的项逐条对一遍；"
            "要算的（对比度、合计、比例……）用 calculate 或 sandbox_run 算，别凭印象说「已满足」。")
    return (
        f'<skill name="{_xml_escape(skill.name)}" '
        f'description="{_xml_escape(skill.description)}" '
        f'path="{_xml_escape(skill.path)}"{extra}>\n'
        f"{lead}{_assets_note(skill)}{_resolve_dir_placeholders(skill.body, skill.name, base)}{tail}\n"
        f"</skill>"
    )


def skill_asset_url(slug: str, rel: str) -> str:
    """包里一份给人看的文件的地址（routes/skill_store 的 /skills/{slug}/files/…）。收尾里 /api/ 开头的链接才可点。"""
    return f"/api/sliderule/skills/{quote(slug, safe='')}/files/{quote(rel, safe='/')}"


def _assets_note(skill: SkillInfo) -> str:
    """⚠ 2026-10-07 真机 r65（@theme-factory）：第 1 步「把 theme-showcase.pdf 给用户看」，平台上没这份文件、
    模型也不知道能给——凭主题名字编了一套配色字体给用户确认（skill_package_format.package_assets 头注）。
    包里有给人看的文件，就在正文前点名、给链接：要「给用户看」就把链接放进回复；别凭文件名描述里面是什么。"""
    if not skill.assets:
        return ""
    links = "、".join(f"[{rel}]({skill_asset_url(skill.name, rel)})" for rel in skill.assets[:20])
    return (f"包里给人看的文件（PDF / 图片，你读不到内容）：{links}。正文让你把它们给用户看时，就把链接写进回复，"
            "用户点开即可；不要凭文件名描述里面的内容——要说清楚某一项是什么，读包里对应的文本文件。\n\n")


def _resolve_dir_placeholders(body: str, name: str, base: str) -> str:
    """正文里指「这份技能目录」的占位换成沙盒里的真目录。

    ⚠ 2026-10-01 引入 ui-ux-pro-max：正文让模型跑
      `python "${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py"`——那是 Claude Code
      插件宿主展开的变量，沙盒里没有，原样照跑是 `/.claude/skills/…: No such file`。上面那句
      「Base directory」管的是 scripts/… 这种相对路径，管不到占位。宿主替它展开，跟 Claude Code 一样。
    """
    if not base or "${" not in body:
        return body
    for marker in (f"${{CLAUDE_PLUGIN_ROOT}}/.claude/skills/{name}/", "${CLAUDE_SKILL_DIR}/", "${SKILL_DIR}/"):
        body = body.replace(marker, base)
    return body


def invoke_skill(skills: Sequence[SkillInfo], name: str, args: str | None = None) -> dict:
    raw = normalize_skill_name(str(name or ""))
    if not raw:
        return {"ok": False, "error": "skill_name_required"}
    live = [s for s in skills if s.enabled]
    match = next((s for s in live if s.name == raw), None)
    if match is None:
        disabled = next((s for s in skills if s.name == raw and not s.enabled), None)
        if disabled is not None:
            return {"ok": False, "error": "skill_disabled", "skill": raw}
        return {
            "ok": False,
            "error": "skill_not_found",
            "skill": raw,
            "available": [s.name for s in live],
        }
    return {"ok": True, "skill": match.name, "skill_message": build_skill_message(match, args)}


def filter_selected(skills: Sequence[SkillInfo], selected: Sequence[str] | None) -> list[SkillInfo]:
    """用户指定了就只留这些；空/None = 已装全部。"""
    if not selected:
        return list(skills)
    want = {normalize_skill_name(item) for item in selected if str(item or "").strip()}
    if not want:
        return list(skills)
    return [s for s in skills if s.name in want]


_MENTION_RE = re.compile(r"(?<![A-Za-z0-9_])@([A-Za-z0-9][\w.-]{0,63})")


def mentioned_skill_slugs(
    text: str,
    installed: Sequence[str] | None = None,
) -> list[str]:
    """这一轮正文里的 `@slug`。给了 installed 就只留已装的。"""
    found: list[str] = []
    seen: set[str] = set()
    for match in _MENTION_RE.finditer(text or ""):
        slug = normalize_skill_name(match.group(1))
        if not slug or slug in seen:
            continue
        seen.add(slug)
        found.append(slug)
    if not installed:
        return found
    allow = {normalize_skill_name(item) for item in installed if str(item or "").strip()}
    return [slug for slug in found if slug in allow]


def catalog_skill_slug(path: str) -> str | None:
    """`.sliderule/skills/<slug>/SKILL.md` 是目录标签，不是工程源码路径。

    ⚠ 2026-09-22 BABCJGGB44：回执带了这个 path，模型 file_read 得到
      project_file_not_found，接着在沙盒里 `find /`。种子在仓库 zip 里，
      工程树没有这份文件。
    """
    raw = str(path or "").strip().replace("\\", "/").lstrip("/")
    lowered = raw.lower()
    for prefix in ("home/ubuntu/", "home/user/workspace/", "workspace/", "app/"):
        if lowered.startswith(prefix):
            raw = raw[len(prefix):]
            lowered = raw.lower()
    match = re.fullmatch(
        r"(?:\.sliderule/)?skills/([A-Za-z0-9][\w.-]{0,63})/SKILL\.md",
        raw,
        flags=re.IGNORECASE,
    )
    if match is None:
        return None
    return normalize_skill_name(match.group(1))


def catalog_skill_file(path: str) -> tuple[str, str] | None:
    """`.sliderule/skills/<slug>/<rel>`（任意文件）→ (slug, rel)。前缀写法同 catalog_skill_slug。"""
    raw = str(path or "").strip().replace("\\", "/").lstrip("/")
    lowered = raw.lower()
    for prefix in ("home/ubuntu/", "home/user/workspace/", "workspace/", "app/"):
        if lowered.startswith(prefix):
            raw = raw[len(prefix):]
            lowered = raw.lower()
    match = re.fullmatch(r"(?:\.sliderule/)?skills/([A-Za-z0-9][\w.-]{0,63})/(.+)", raw)
    if match is None or ".." in match.group(2).split("/"):
        return None
    return normalize_skill_name(match.group(1)), match.group(2)


def mentioned_skill_playbooks(skills: Sequence[SkillInfo]) -> str:
    """点名技能的名字和一句话。正文不进 system，也不在工程树里。"""
    live = [skill for skill in skills if skill.enabled]
    if not live:
        return ""
    names = "、".join(skill.name for skill in live)
    lines = [
        f"用户这一轮点名了技能：{names}。",
        # ⚠ 2026-09-30 第 145 轮：@frontend-design 那一轮只用了点名那一份，同类网页轮不点名时每轮用 3～4 份。
        #   用户定的：@ 的要用，其他已装的照样由 Agent 按需编排进来。这里只陈述这条事实。
        "点名的这份要用；点名不是只许用它——其他已装技能对这次结果有帮助的，照常按需加载。",
        "下面只给名字、一句话和目录标签。正文不在工程里。"
        "要原文调 skill，回执里就是全文。path 不是工程文件，不要 file_read，也不要在沙盒里 find。",
    ]
    for skill in live:
        lines.append(f"- {skill.name}：{skill.description}；path={skill.path}")
    return "\n".join(lines)


def _split_frontmatter(content: str) -> tuple[str, str]:
    text = (content or "").lstrip()
    if not text.startswith("---"):
        return "", content or ""
    rest = text[3:]
    if rest.startswith("\n"):
        rest = rest[1:]
    idx = rest.find("\n---")
    if idx < 0:
        return "", content or ""
    return rest[:idx], rest[idx + 4:].lstrip()


def _parse_frontmatter_scalars(frontmatter: str) -> dict[str, str]:
    out: dict[str, str] = {}
    lines = (frontmatter or "").splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line[:1] in " \t":
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, _, raw = line.partition(":")
        key = key.strip()
        raw = raw.strip()
        if raw in ("|", ">", "|-", ">-", "|+", ">+"):
            block: list[str] = []
            i += 1
            while i < len(lines) and (not lines[i].strip() or lines[i][:1] in " \t"):
                block.append(lines[i])
                i += 1
            out[key] = textwrap.dedent("\n".join(block)).strip()
            continue
        if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
            raw = raw[1:-1]
        else:
            raw = raw.split(" #", 1)[0].strip()
        out[key] = raw
        i += 1
    return out


def _name_from_path(path: str) -> str:
    norm = (path or "").replace("\\", "/").rstrip("/")
    if norm.lower().endswith("/skill.md"):
        parent = norm.rsplit("/", 1)[0]
        return parent.rsplit("/", 1)[-1] if parent else ""
    return norm.rsplit("/", 1)[-1]


def _first_paragraph(body: str) -> str:
    for block in re.split(r"\n\s*\n", body or ""):
        line = block.strip()
        if line and not line.startswith("#"):
            return line.split("\n", 1)[0].strip()
    return ""


def _xml_escape(value: str) -> str:
    return (
        (value or "")
        .replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


#: 像「流程」的段落标题：阶段 / 步骤 / 自查 / 验收。参考资料类（Scripts、Dependencies、Design Ideas）不算。
_PROCESS_HEADING = re.compile(
    r"\b(stage|step|phase|process|workflow|qa|review|testing|critique|checklist|verification)\b"
    r"|流程|阶段|步骤|自查|自检|验收",
    re.IGNORECASE,
)
_PROCESS_SECTIONS_MAX = 8


def process_sections(body: str) -> list[str]:
    """技能正文里规定了做法 / 先后的二级段落标题（代码块里的不算），按原文顺序，最多 8 条。

    ⚠ 2026-10-04 真机 @doc-coauthoring 团队周会制度 sr-20261004172458-JFH426E38Y：开场说了「最后用
      『新同事会问什么』做一次可读性检查」（它的 Stage 3: Reader Testing），计划的「技能落点」只写了
      Stage 1/2 怎么落、跳过了访谈，Stage 3 一个字没提，执行也没做——write_plan 说明里那句「跳过的写为什么」
      （修复 4）照样被漏掉。同类：@frontend-design 两轮没有它 Process 段的自查。漏的都是正文后半段的
      流程段落，模型写计划时没再回头看。写计划那一刻把这几段的标题摆回眼前（write_plan 回执）。
    """
    out: list[str] = []
    fenced = False
    for line in str(body or "").splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if fenced or not line.startswith("## "):
            continue
        title = line[3:].strip()
        if title and _PROCESS_HEADING.search(title) and title not in out:
            out.append(title)
        if len(out) >= _PROCESS_SECTIONS_MAX:
            break
    return out
