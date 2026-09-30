# -*- coding: utf-8 -*-
"""批准计划上的交付物类别。叶子：只吃计划字典，不读会话、不读工程库。

⚠ 2026-09-20 真机 sr-20260920051924-QA0YXX59Q0：用户要做 PPT，自由 Agent
  调了 project_create(react-vite-tasks)。host 提示词把 tasks 写成正经应用，
  完工闸只认任务清单 delivery.eligible，右栏 iframe 就出现「登录任务清单」。

  类别由模型写进 write_plan，host 只执行，不猜用户那句话像不像 PPT。
  缺省 web-app：存量网页会话行为不变。
"""

from __future__ import annotations

import io
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

WEB_APP = "web-app"
OFFICE_FILE = "office-file"
DELIVERABLE_KINDS = frozenset({WEB_APP, OFFICE_FILE})
TASKS_TEMPLATE_ID = "react-vite-tasks"
WRONG_ARTIFACT = "project_template_wrong_artifact"
OFFICE_EXTENSIONS = frozenset({".pptx", ".docx", ".xlsx"})
OFFICE_ZIP_MAGIC = b"PK\x03\x04"
OFFICE_SKIP_DIRS = frozenset({"node_modules", ".venv", "__pycache__", ".git", "dist"})
OFFICE_FILE_NOT_TEXT = "project_office_file_not_text"
OFFICE_VERIFY_NOT_APPLICABLE = "office_file_verify_not_applicable"
OFFICE_START_NOT_APPLICABLE = "office_file_start_not_applicable"
#: 办公计划的源码树必须能过 build_manifest（空 dict 会 invalid_project_file_count）。
#: 只陈述事实，不写「先 pip / 必须先调」。
WORKSPACE_README = (
    "这是空工作区。源码树里没有 Vite。"
    "写文本用 file_write，跑命令用 bash。"
    # ⚠ 2026-09-27 删掉「bash 只接受一行」：多行已在 PTY 层包成一行（pty_line）。
    #   留着它，模型照旧绕开 heredoc 或干脆不核对——第 31 轮就是后者。
    "命令输出在 project_logs / shell_view（带 operationId），不进源码树。"
    "办公文件（.pptx / .docx / .xlsx）不进源码树。"
)
#: 办公计划建成的电脑。不进 CreateArguments.templateId——模型仍可传
#: react-vite*，host 按批准计划覆盖。
WORKSPACE_TEMPLATE_VERSION = "whybuddy-workspace-1"
#: 办公工作区的 E2B 镜像名。空 = 默认 code-interpreter，不在开箱时现装 LibreOffice。
OFFICE_E2B_TEMPLATE_ENV = "WHYBUDDY_OFFICE_E2B_TEMPLATE"


def normalize_deliverable_kind(raw: Any) -> str:
    text = str(raw or "").strip()
    return text if text in DELIVERABLE_KINDS else WEB_APP


def plan_deliverable_kind(plan: Any) -> str:
    if not isinstance(plan, Mapping):
        return WEB_APP
    return normalize_deliverable_kind(plan.get("deliverableKind"))


def is_office_file_plan(plan: Any) -> bool:
    return plan_deliverable_kind(plan) == OFFICE_FILE


def office_workspace_files() -> dict[str, str]:
    """办公计划的电脑：能写文件、能跑命令，不灌 Vite。"""
    return {"README.md": WORKSPACE_README}


def office_e2b_template() -> str | None:
    """办公工作区要起的 E2B 镜像。没配或名字不合法就返回 None。

    ⚠ 2026-09-22 预览和下载不是同一张画：转换去主机上找 soffice，
      文件却生在 E2B 里，默认 code-interpreter 没有 LibreOffice。
      不在每次 bash 里 apt-get——默认沙盒内存不够，现装会把命令拖死。
      网页工程不许走这张镜像。
    """
    value = os.getenv(OFFICE_E2B_TEMPLATE_ENV, "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", value):
        return None
    return value


def operation_left_on_lease(store, lease, owner_id: str):
    refs = getattr(lease, "processRefs", None) or {}
    prior_id = refs.get("operationId") if isinstance(refs, dict) else None
    if not isinstance(prior_id, str) or not prior_id:
        return None
    try:
        return store.get_operation(prior_id, owner_id=owner_id)
    except Exception:
        return None


def idle_office_exec_allows_source_write(lease, operation) -> bool:
    """已结束的办公命令留下沙盒，不等于运行时还占着源码。

    ⚠ 2026-09-22 BABCJGGB44：bash 完成后 file_write / project_patch 仍是
      project_runtime_reconciliation_required。租约上的 sandboxId 是留给
      下一条命令的，不是还在跑的 Vite。
    """
    if lease is None or not getattr(lease, "sandboxId", None) or operation is None:
        return False
    return (
        getattr(operation, "kind", None) == "runtime.exec"
        and getattr(operation, "status", None) in {"completed", "failed", "cancelled"}
        and getattr(operation, "pendingEvent", None) is None
    )


def orch_trace(event: str, **fields: Any) -> None:
    """真机编排轨迹。**默认关**，设 `ORCH_TRACE=<路径>` 才写。

    ⚠ 2026-09-22 sr-20260922041808-Z8NPKNM14C：启动行印了 readmeBytes=309、
      officeSeed=11022，同一进程 project_create 仍是旧 README。
      会话捕获的 stdout 只留开头 20KB，闸门 print 落在被截掉的那一段——
      所以失败要写文件，不能只 print。

    ⚠ 2026-09-23 review：上一版**无条件**往 `<repo>/tmp/live-office-ppt/orch.log`
      追加，而 http-turn / dispatch / recall / service-turn 每一发都写一行，
      没有轮转、没有上限。查真机那几天的临时手段不该跟着镜像上线。
      现在只认 ORCH_TRACE：不设就直接返回，一个字节都不落。
    """
    path_text = os.environ.get("ORCH_TRACE")
    if not path_text:
        return
    try:
        path = Path(path_text)
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "t": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "event": event,
            **fields,
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, default=str)[:2000] + "\n")
    except Exception:
        return


def skip_vite_dependency_install(*, operation_kind: Any, template_version: Any,
                                 files: Any) -> bool:
    """办公工作区跑 bash，不许先 npm ci。

    ⚠ 2026-09-21 真机 sr-20260921102816-KWETH78PZ0：办公计划建成
      whybuddy-workspace-1（只有 README），shell_exec / bash 开箱仍要
      package-lock.json + npm ci → project_lockfile_or_reserved_path_invalid。
      project_start 已经拒了，真机做 PPT 走的是 bash。Vite 工程缺锁文件
      仍 fail-closed。

    ⚠ 2026-09-21 sr-20260921170121-13ME64TF8Z：`echo hello` 仍是同一错。
      树是 README + generate_kickoff_pptx.py，没有 package.json。上一版
      只认 template_version==whybuddy-workspace-1，revision 上那格空或
      仍是 vite 时闸不响。Vite 工程必有 package.json，缺锁文件仍 fail-closed。

    ⚠ 2026-09-24 sr-20260924153920-MB5NJX8X2D：办公区被锁文件闸打死之后，
      模型补了 package.json 和 lock。上一版一看见这两个文件就返回 False，
      于是每条命令拆沙盒、跑 npm ci。模板已经是 whybuddy-workspace-1 时，
      包文件是模型自己放进来的脚本依赖，不是 Vite 开箱。
    """
    if str(operation_kind or "") != "runtime.exec":
        return False
    if str(template_version or "") == WORKSPACE_TEMPLATE_VERSION:
        return True
    names = {str(name) for name in files} if isinstance(files, Mapping) else set()
    if "package-lock.json" in names or "package.json" in names:
        return False
    if not isinstance(files, Mapping):
        return False
    return True


def reject_tasks_template(kind: Any, template_id: Any) -> str | None:
    """办公文件禁止任务清单模板。返回错误码；放行则 None。"""
    if str(template_id or "").strip() != TASKS_TEMPLATE_ID:
        return None
    if normalize_deliverable_kind(kind) != OFFICE_FILE:
        return None
    return WRONG_ARTIFACT


def office_file_uses_task_delivery(kind: Any) -> bool:
    """办公文件的完工不得问任务应用 eligible。"""
    return normalize_deliverable_kind(kind) == OFFICE_FILE


def office_artifact_suffix(path: Any) -> str | None:
    name = str(path or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
    for ext in OFFICE_EXTENSIONS:
        if name.endswith(ext):
            return ext
    return None


def is_office_artifact_path(path: Any) -> bool:
    return office_artifact_suffix(path) is not None


_CHART_PART = re.compile(r"^(?:ppt|word|xl)/charts/chart\d+\.xml$")
_MEDIA_PART = re.compile(r"^(?:ppt|word|xl)/media/[^/]+$")
_SLIDE_PART = re.compile(r"^ppt/slides/slide\d+\.xml$")
_SHEET_PART = re.compile(r"^xl/worksheets/sheet\d+\.xml$")
_PIVOT_PART = re.compile(r"^xl/pivotTables/pivotTable\d+\.xml$")
#: 一个单元格的内容（<c …>…</c>；自闭合的空格子不算）。
_XLSX_CELL = re.compile(rb"<c\b[^>]*[^/]>(.*?)</c>", re.S)
#: 公式格里算好的结果：非空的 <v>。
_XLSX_CACHED = re.compile(rb"<v>[^<]+</v>")
_DOCX_PARA = re.compile(rb"<w:p[ >].*?</w:p>", re.S)
_DOCX_PPR = re.compile(rb"<w:pPr>.*?</w:pPr>", re.S)
_DOCX_PSTYLE = re.compile(rb'<w:pStyle w:val="([^"]+)"')
_DOCX_STYLE = re.compile(rb'<w:style\b[^>]*w:styleId="([^"]+)".*?</w:style>', re.S)
_DOCX_TEXT = re.compile(rb"<w:t(?: [^>]*)?>([^<]*)</w:t>")
#: 正文开头手写的编号 / 符号。「1.5 万」不算（点后面跟数字）。
_MANUAL_MARKER = re.compile(r"\s*(?:\d{1,2}[.、．)）](?!\d)|[（(]\d{1,2}[)）]|[•·●▪■◆\-–—*]\s?)")


def office_facts(data: Any, path: Any) -> dict[str, Any] | None:
    """从文件字节里量出来的结构事实：几页 / 几张表、原生图表、图片、表格。

    ⚠ 2026-09-26 隔离真机 sr-20260926043506-7B49NNSE1M：模型交付时说
      「三个关键指标及可编辑图表」「内容与图表均为可编辑元素」。文件里
      ppt/charts/ 一个都没有——指标图是矩形拼的，在 PowerPoint 里改不了数据。
      它唯一做过的核验是 len(p.slides)，图表那半句没有任何工具结果撑着。
      宿主手里本来就有这份字节，量出来放进回执，模型描述文件时有据可依。

    量不出来（不是 zip、坏包）返回 None——这是增强项，fail-open（本仓 §七）。
    """
    ext = Path(str(path or "")).suffix.lower()
    if ext not in OFFICE_EXTENSIONS or not is_office_zip_bytes(data):
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(bytes(data))) as archive:
            names = archive.namelist()
            facts: dict[str, Any] = {
                "charts": sum(1 for n in names if _CHART_PART.match(n)),
                "pictures": sum(1 for n in names if _MEDIA_PART.match(n)),
            }
            if ext == ".pptx":
                slides = [n for n in names if _SLIDE_PART.match(n)]
                facts["slides"] = len(slides)
                facts["tables"] = sum(archive.read(n).count(b"<a:tbl>") for n in slides)
                hidden = _pptx_text_on_same_color(archive, names)
                facts["textInvisible"] = len(hidden)
                if hidden:
                    facts["textInvisibleSamples"] = list(dict.fromkeys(hidden))[:3]   # 三个「查看型号」只举一次
            elif ext == ".docx":
                body = archive.read("word/document.xml") if "word/document.xml" in names else b""
                facts["tables"] = body.count(b"<w:tbl>")
                styles = archive.read("word/styles.xml") if "word/styles.xml" in names else b""
                facts["listDoubleMarked"] = _docx_double_marked(body, styles)
            else:
                sheets = [n for n in names if _SHEET_PART.match(n)]
                facts["sheets"] = len(sheets)
                facts["pivotTables"] = sum(1 for n in names if _PIVOT_PART.match(n))
                formulas = uncached = 0
                for name in sheets:
                    for cell in _XLSX_CELL.findall(archive.read(name)):
                        if b"<f" not in cell:
                            continue
                        formulas += 1
                        if not _XLSX_CACHED.search(cell):
                            uncached += 1
                facts["formulas"] = formulas
                facts["formulasUncached"] = uncached
                if formulas:
                    wrong = _xlsx_cached_results_that_disagree(archive, names)
                    facts["formulasWrong"] = len(wrong)
                    if wrong:
                        facts["formulasWrongSamples"] = wrong[:3]
            return facts
    except Exception:
        return None


_P_NS = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
_A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
#: 低于这个对比度，字在预览里等于没有。标定：隔离库 74 份模型交付的 pptx，命中 11 份，
#: 逐页渲染看过全是真看不清（最高的两处 1.37 / 1.38：蓝底淡蓝页码、黄底白星）；照片上的字不算（见下）。
_INVISIBLE_CONTRAST = 1.5


def _luminance(hex_color: str) -> float:
    def channel(value: int) -> float:
        v = value / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def _contrast(a: str, b: str) -> float:
    high, low = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def _pptx_box(node: Any) -> tuple[int, int, int, int] | None:
    off = next(node.iter(_A_NS + "off"), None)
    ext = next(node.iter(_A_NS + "ext"), None)
    if off is None or ext is None:
        return None
    x, y = _xml_int(off.attrib.get("x")), _xml_int(off.attrib.get("y"))
    w, h = _xml_int(ext.attrib.get("cx")), _xml_int(ext.attrib.get("cy"))
    if None in (x, y, w, h):
        return None
    return x, y, x + w, y + h


def _pptx_fill(node: Any) -> tuple[bool, str | None]:
    """(有没有填充, 纯色 srgb)。渐变 / 图片 / 主题色填充 = 有填充但颜色量不出来。"""
    sppr = node.find(_P_NS + "spPr")
    if sppr is None:
        return False, None
    solid = sppr.find(_A_NS + "solidFill")
    if solid is not None:
        rgb = solid.find(_A_NS + "srgbClr")
        return True, (rgb.attrib.get("val", "").upper() or None) if rgb is not None else None
    return any(sppr.find(_A_NS + t) is not None for t in ("gradFill", "blipFill", "pattFill")), None


def _pptx_text_on_same_color(archive: zipfile.ZipFile, names: list[str]) -> list[str]:
    """字色和它正下方那层底色几乎一样的文字：「第 N 页「字」」。

    ⚠ 2026-09-30 隔离真机第 153 轮（智能手表发布会 PPT，没点名技能，自己编排了 6 个）：
      封面的「CONCEPT 2025」、第 2 页三个「查看型号」、第 3 页「FOR ATHLETES」、第 8 页「RESERVE NOW」
      全是亮绿 / 青色胶囊上叠一个同色字的文本框——右栏预览里就是一排没字的色条。模型自己的校验写着
      「无越界或浅文本框告警」：它查了位置，没查颜色。

    底色 = 自己的纯色填充；没有就沿 z 序往下找第一个盖住文字中心点的形状；再没有才用页面背景。
    往下找碰到图片 / 图表 / 组合 / 渐变这类颜色量不出来的，不下结论（fail-open）——
    第一版没算照片，大阪行程那份「照片上的白字」被当成「近白背景上的白字」，误报 14 处。
    组合里的字不看（坐标要套组合的变换）。
    """
    found: list[str] = []
    for name in _slide_order(names):
        try:
            root = ET.fromstring(archive.read(name))
        except (KeyError, ET.ParseError):
            continue
        tree = root.find(f"{_P_NS}cSld/{_P_NS}spTree")
        if tree is None:
            continue
        bg = root.find(f"{_P_NS}cSld/{_P_NS}bg/{_P_NS}bgPr/{_A_NS}solidFill/{_A_NS}srgbClr")
        background = bg.attrib.get("val", "").upper() if bg is not None else None
        below: list[tuple[tuple[int, int, int, int], str | None]] = []
        number = re.search(r"(\d+)\.xml$", name)
        for node in list(tree):
            kind = _xml_local(node.tag)
            box = _pptx_box(node)
            if kind in ("pic", "graphicFrame", "grpSp"):
                if box:
                    below.append((box, None))
                continue
            if kind != "sp" or not box:
                continue
            filled, own = _pptx_fill(node)
            text = "".join(t.text or "" for t in node.iter(_A_NS + "t")).strip()
            colors = {c.attrib.get("val", "").upper() for r in node.iter(_A_NS + "rPr")
                      for c in r.findall(f"{_A_NS}solidFill/{_A_NS}srgbClr")}
            colors.discard("")
            if text and colors and not (filled and own is None):
                under = own
                if under is None:
                    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                    hit = next((fill for area, fill in reversed(below)
                                if area[0] <= cx <= area[2] and area[1] <= cy <= area[3]), "")
                    under = background if hit == "" else hit
                if under and re.fullmatch(r"[0-9A-F]{6}", under) and all(re.fullmatch(r"[0-9A-F]{6}", c) for c in colors):
                    if min(_contrast(c, under) for c in colors) < _INVISIBLE_CONTRAST:
                        found.append(f"第 {number.group(1) if number else '?'} 页「{text[:16]}」")
            if filled:
                below.append((box, own))
    return found


_SS_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_FORMULA_TOKEN = re.compile(r"""\s*(?:
    (?P<ref>(?:(?P<sheet>'(?:[^']|'')+'|[^\W\d][\w.]*)!)?\$?(?P<c1>[A-Z]{1,3})\$?(?P<r1>\d+)(?::\$?(?P<c2>[A-Z]{1,3})\$?(?P<r2>\d+))?(?![\w(]))
  | (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
  | (?P<func>[A-Z][A-Z0-9.]*)\(
  | (?P<op>[-+*/^(),])
)""", re.X)
_SUPPORTED_FUNCS = {"SUM", "AVERAGE", "MIN", "MAX", "COUNT", "ROUND"}


class _Unsupported(Exception):
    """这条公式量不了（函数不认识、引用了文字、循环……）——不下结论。"""


def _col_number(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def _col_letters(n: int) -> str:
    out = ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def _xlsx_sheet_parts(archive: zipfile.ZipFile) -> dict[str, str]:
    """工作表名 → 部件路径，走 workbook.xml.rels，不按文件名猜。"""
    root = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = {r.attrib.get("Id"): r.attrib.get("Target", "") for r in rels}
    parts = {}
    for sheet in root.iter(_SS_NS + "sheet"):
        path = target.get(sheet.attrib.get(_REL_NS + "id"), "")
        path = path.lstrip("/") if path.startswith("/") else "xl/" + path
        parts[sheet.attrib.get("name", "")] = path
    return parts


def _xlsx_cached_results_that_disagree(archive: zipfile.ZipFile, names: list[str]) -> list[str]:
    """存进文件的公式结果，和按公式重算出来的对不上的：「表!格 存的是 X，按公式算是 Y」。

    ⚠ 2026-09-30 隔离真机第 155 轮（工作室年度预算 Excel）：第 148 轮之后回执教模型「用 XlsxWriter
      write_formula 把算好的值一起写」，结果从「空白」变成了「错数」——季度汇总 Q4 写的是
      SUM('月度明细'!D16:D19)（四个季度都按 4 个月切，Q4 落到年度合计行），存的值是 0（XlsxWriter
      不给值时的默认）；年度合计 580,400 只加了前三季。右栏预览和缩略图照着存的数画，用户看到的是错的，
      模型的校验只数了「公式在不在」。宿主手里有字节，能核的就核。

    只认最常见的一小撮：单元格、区域、+ - * / ^、SUM / AVERAGE / MIN / MAX / COUNT / ROUND。
    别的函数、文字参与运算、共享公式、循环一律跳过——量不了不报（fail-open，本仓 §七）。
    """
    parts = _xlsx_sheet_parts(archive)
    strings_root = None
    cells: dict[tuple[str, str], tuple[str | None, Any]] = {}
    for sheet, part in list(parts.items())[:20]:
        if part not in names:
            continue
        root = ET.fromstring(archive.read(part))
        for c in root.iter(_SS_NS + "c"):
            ref = c.attrib.get("r")
            if not ref:
                continue
            f = c.find(_SS_NS + "f")
            v = c.find(_SS_NS + "v")
            kind = c.attrib.get("t", "n")
            value: Any = None
            if v is not None and v.text is not None:
                if kind in ("s", "str", "inlineStr"):
                    value = "text"
                elif kind in ("b", "e"):
                    value = "other"
                else:
                    try:
                        value = float(v.text)
                    except ValueError:
                        value = "other"
            formula = None
            if f is not None:
                formula = f.text if (f.text and f.attrib.get("t") not in ("array", "dataTable")) else ""
            cells[(sheet, ref)] = (formula, value)
            if len(cells) > 50000:
                return []
    del strings_root
    memo: dict[tuple[str, str], Any] = {}
    active: set[tuple[str, str]] = set()

    def cell_value(sheet: str, ref: str) -> Any:
        key = (sheet, ref)
        formula, value = cells.get(key, (None, None))
        if formula is None:
            return value
        if formula == "":
            raise _Unsupported
        if key in memo:
            return memo[key]
        if key in active:
            raise _Unsupported
        active.add(key)
        try:
            memo[key] = evaluate(formula, sheet)
        finally:
            active.discard(key)
        return memo[key]

    def evaluate(formula: str, sheet: str) -> float:
        tokens = []
        pos = 0
        text = formula.strip()
        while pos < len(text):
            m = _FORMULA_TOKEN.match(text, pos)
            if not m or m.end() == pos:
                raise _Unsupported
            tokens.append(m)
            pos = m.end()
        index = 0

        def peek(kind: str, value: str | None = None) -> bool:
            if index >= len(tokens):
                return False
            got = tokens[index].group(kind)
            return got is not None and (value is None or got == value)

        def take() -> Any:
            nonlocal index
            index += 1
            return tokens[index - 1]

        def area(m: Any) -> list[Any]:
            target = m.group("sheet") or sheet
            if target.startswith("'"):
                target = target[1:-1].replace("''", "'")
            if target not in parts:
                raise _Unsupported
            c1, r1 = _col_number(m.group("c1")), int(m.group("r1"))
            c2 = _col_number(m.group("c2")) if m.group("c2") else c1
            r2 = int(m.group("r2")) if m.group("r2") else r1
            if (abs(c2 - c1) + 1) * (abs(r2 - r1) + 1) > 20000:
                raise _Unsupported
            return [cell_value(target, f"{_col_letters(c)}{r}")
                    for r in range(min(r1, r2), max(r1, r2) + 1)
                    for c in range(min(c1, c2), max(c1, c2) + 1)]

        def scalar(value: Any) -> float:
            if value is None:
                return 0.0
            if isinstance(value, float):
                return value
            raise _Unsupported

        def primary() -> Any:
            if peek("num"):
                return float(take().group("num"))
            if peek("ref"):
                m = take()
                values = area(m)
                return values if m.group("c2") else scalar(values[0])
            if peek("func"):
                name = take().group("func")
                if name not in _SUPPORTED_FUNCS:
                    raise _Unsupported
                args: list[Any] = []
                if not peek("op", ")"):
                    args.append(expression(allow_area=True))
                    while peek("op", ","):
                        take()
                        args.append(expression(allow_area=True))
                if not peek("op", ")"):
                    raise _Unsupported
                take()
                return call(name, args)
            if peek("op", "("):
                take()
                inner = expression()
                if not peek("op", ")"):
                    raise _Unsupported
                take()
                return inner
            raise _Unsupported

        def unary() -> Any:
            if peek("op", "-"):
                take()
                return -scalar(unary())
            if peek("op", "+"):
                take()
                return scalar(unary())
            return primary()

        def power() -> Any:
            left = unary()
            while peek("op", "^"):
                take()
                left = scalar(left) ** scalar(unary())
            return left

        def term() -> Any:
            left = power()
            while peek("op", "*") or peek("op", "/"):
                op = take().group("op")
                right = scalar(power())
                if op == "/" and right == 0:
                    raise _Unsupported
                left = scalar(left) * right if op == "*" else scalar(left) / right
            return left

        def expression(allow_area: bool = False) -> Any:
            left = term()
            if isinstance(left, list) and not allow_area:
                raise _Unsupported
            while peek("op", "+") or peek("op", "-"):
                op = take().group("op")
                right = scalar(term())
                left = scalar(left) + right if op == "+" else scalar(left) - right
            return left

        def call(name: str, args: list[Any]) -> float:
            numbers: list[float] = []
            for arg in args:
                for item in (arg if isinstance(arg, list) else [arg]):
                    if isinstance(item, float):
                        numbers.append(item)
                    elif item not in (None, "text") or not isinstance(arg, list):
                        raise _Unsupported
            if name == "SUM":
                return sum(numbers)
            if name == "COUNT":
                return float(len(numbers))
            if name == "ROUND":
                if len(args) != 2 or isinstance(args[0], list):
                    raise _Unsupported
                return float(round(scalar(args[0]), int(scalar(args[1]))))
            if not numbers:
                raise _Unsupported
            if name == "AVERAGE":
                return sum(numbers) / len(numbers)
            return min(numbers) if name == "MIN" else max(numbers)

        result = expression()
        if index != len(tokens) or isinstance(result, list):
            raise _Unsupported
        return scalar(result)

    def shown(x: float) -> str:
        return f"{x:,.0f}" if abs(x - round(x)) < 1e-9 else f"{x:,.2f}"

    found = []
    for (sheet, ref), (formula, cached) in cells.items():
        if not formula or not isinstance(cached, float):
            continue
        try:
            actual = cell_value(sheet, ref)
        except (_Unsupported, RecursionError, OverflowError, ValueError):
            continue
        if abs(actual - cached) > max(0.005, 1e-6 * abs(actual)):
            found.append(f"{sheet}!{ref} 存的是 {shown(cached)}，按公式 {formula} 算是 {shown(actual)}")
    return found


def _docx_double_marked(body: bytes, styles: bytes) -> int:
    """带自动项目符号 / 编号的段落里，正文又手写了「1.」「•」的段数。

    ⚠ 2026-09-30 隔离真机第 151 轮（门店运营报告 Word，追问「结论改成三条要点」）：模型用
      python-docx 的 List Bullet 样式，正文又写成「1. 旗舰店稳规模…」——右栏预览和 Word 里
      每条都显示成「• 1.」两个记号。样式自带的圆点在 styles.xml 里（w:numPr），段落本身看不出来，
      所以样式要一起查。普通段落手写「1. 门店经营表现不均衡」是正常写法，不算。
    """
    listed = {m.group(1) for m in _DOCX_STYLE.finditer(styles) if b"<w:numPr" in m.group(0)}
    count = 0
    for para in _DOCX_PARA.findall(body):
        found = _DOCX_PPR.search(para)
        ppr = found.group(0) if found else b""
        style = _DOCX_PSTYLE.search(ppr)
        if b"<w:numPr" in ppr:
            numbered = b'<w:numId w:val="0"/>' not in ppr      # numId 0 = 显式去掉编号
        else:
            numbered = bool(style and style.group(1) in listed)
        if not numbered:
            continue
        text = b"".join(_DOCX_TEXT.findall(para)).decode("utf-8", "replace")
        if _MANUAL_MARKER.match(text):
            count += 1
    return count


def office_facts_sentence(path: str, facts: Mapping[str, Any]) -> str:
    """回执里那一句。只写量出来的数，不评价。

    ⚠ 2026-09-27 隔离真机第 34 轮（信息安全培训 PPT，追问加「弱密码 vs 强密码」
      对比表格）：模型用矩形 + 文本框拼了一行「表格」，回执写着「表格 0 个」，
      收尾照样说「加入对比表格」。图表那一项早就写成「原生图表」（第 18 轮用形状
      画柱状图也是这个病），表格没写——「表格 0 个」读起来像「我拼的那个没被数到」。
      现在两项都说「原生」，数到 0 时补一句形状拼的不算、为什么不算。
    """
    parts: list[str] = []
    if "slides" in facts:
        parts.append(f"{facts['slides']} 页")
    if "sheets" in facts:
        parts.append(f"工作表 {facts['sheets']} 张")
    parts.append(f"原生图表 {facts.get('charts', 0)} 个")
    parts.append(f"图片 {facts.get('pictures', 0)} 张")
    if "tables" in facts:
        parts.append(f"原生表格 {facts['tables']} 个")
    missing = "/".join(name for name, key in (("图表", "charts"), ("表格", "tables"))
                       if (key in facts or key == "charts") and not facts.get(key))
    # 用户在 Office 里点开拼出来的东西，改不了数据和行列——它就不是图表/表格。
    note = f"（形状、文本框拼的不算，别对用户叫它{missing}）" if missing else ""
    if "pivotTables" in facts:
        # ⚠ 2026-09-27 隔离真机第 66 轮（应收账款 Excel，追问「再加一个按月份汇总的
        #   透视表工作表」）：openpyxl 写不出数据透视表，模型用 SUMIFS 做了一张「按月汇总」，
        #   收尾一句没提它不是透视表——用户点开找不到字段列表、拖不了行列。回执里的实况
        #   只有工作表 / 图表 / 图片，透视表那半句没有任何数撑着。跟上面同一类：量出来的数
        #   + 一条真实性边界。
        pivots = facts["pivotTables"]
        note += f"，数据透视表 {pivots} 个" + (
            "（公式写的汇总表不是透视表：用户要的是透视表，就照实说给的是公式汇总）"
            if not pivots else "")
    uncached = int(facts.get("formulasUncached") or 0)
    if uncached:
        # ⚠ 2026-09-30 隔离真机第 148 轮（家庭月度开支 Excel）：openpyxl 写的 12 个 SUM 全是 <v></v>——
        #   Excel 打开会重算，右栏预览（@silurus/ooxml 只读缓存值）和结果卡缩略图里「总计」一整行是空的，
        #   模型说「合计均使用公式」没错，用户在界面上看到的却是空白。沙盒和生产镜像都没有 LibreOffice 可重算。
        # ⚠ 第 149 轮（班级成绩 Excel + 「加一列排名」）：第一版这句写着「用户在 Excel 里打开会重算」，
        #   两轮回执都挂上了（20/20、30/30 没结果），模型两轮都读完就收尾、照旧用 openpyxl——那半句
        #   等于告诉它「不用管」。现在只说用户第一眼看到什么、交付前怎么补，不给台阶。
        note += (f"，公式 {facts.get('formulas', uncached)} 个里 {uncached} 个没有算好的结果"
                 "（用户在右侧预览和结果卡缩略图里第一眼看到的这些格子是空白——总分、合计、排名都是空的。"
                 "交付前补上：openpyxl 存不了结果；改用 XlsxWriter，"
                 "worksheet.write_formula(单元格, 公式, 格式, 值) 把 Python 算好的值一起写进去，公式照样保留）")
    wrong = int(facts.get("formulasWrong") or 0)
    if wrong:
        # 第 155 轮，见 _xlsx_cached_results_that_disagree 头注。
        samples = "；".join(str(item) for item in (facts.get("formulasWrongSamples") or [])[:3])
        note += (f"，公式 {facts.get('formulas', wrong)} 个里 {wrong} 个存的结果和按公式算出来的对不上（{samples}）"
                 "——右侧预览和卡片缩略图显示的是存的那个数，用户看到的就是错的。交付前核对：写进去的值要等于公式"
                 "真算出来的结果，也看一眼公式引用的范围本身对不对")
    invisible = int(facts.get("textInvisible") or 0)
    if invisible:
        # 第 153 轮，见 _pptx_text_on_same_color 头注。
        samples = "、".join(str(item) for item in (facts.get("textInvisibleSamples") or [])[:3])
        note += (f"，有 {invisible} 处文字和它下面的底色几乎同色（比如 {samples}）"
                 "——用户在右侧预览和结果卡缩略图里看到的是一块没字的色块。交付前把这些字改成和底色反差明显的颜色")
    doubled = int(facts.get("listDoubleMarked") or 0)
    if doubled:
        # 第 151 轮，见 _docx_double_marked 头注。
        note += (f"，有 {doubled} 段列表带着自动项目符号 / 编号、正文又手写了「1.」「•」这类记号"
                 "（用户在右侧预览和 Word 里看到的是「• 1.」两个记号。交付前去掉正文里手写的那个，"
                 "或者把这几段改成不带自动符号的普通段落）")
    return f"{path}：" + "，".join(parts) + note


def is_office_zip_bytes(data: Any) -> bool:
    return isinstance(data, (bytes, bytearray)) and bytes(data[:4]) == OFFICE_ZIP_MAGIC


def _xml_local(tag: Any) -> str:
    return str(tag or "").rsplit("}", 1)[-1]


def _xml_srgb(node: Any) -> str | None:
    for child in getattr(node, "iter", lambda: [])():
        if _xml_local(child.tag) != "srgbClr":
            continue
        val = str(child.attrib.get("val") or "")
        if re.fullmatch(r"[0-9A-Fa-f]{6}", val):
            return "#" + val.upper()
    return None


def _xml_int(value: Any) -> int | None:
    try:
        number = int(str(value))
    except (TypeError, ValueError):
        return None
    if number < 0 or number > 914400 * 100:
        return None
    return number


def _slide_order(names: list[str]) -> list[str]:
    """按幻灯片序号，不许按文件名排序。

    ⚠ 字典序会把 slide10 排到 slide2 前面。10 页以上的预览页序就错了。
    """
    found = []
    for name in names:
        match = re.fullmatch(r"ppt/slides/slide(\d+)\.xml", name)
        if match:
            found.append((int(match.group(1)), name))
    found.sort(key=lambda item: item[0])
    return [name for _number, name in found[:40]]


def _slide_size(archive: zipfile.ZipFile) -> tuple[int, int]:
    wide, high = 12192000, 6858000
    try:
        root = ET.fromstring(archive.read("ppt/presentation.xml"))
    except (KeyError, ET.ParseError):
        return wide, high
    for node in root.iter():
        if _xml_local(node.tag) != "sldSz":
            continue
        cx = _xml_int(node.attrib.get("cx"))
        cy = _xml_int(node.attrib.get("cy"))
        if cx and cy:
            return cx, cy
    return wide, high


def _text_style(node: Any) -> tuple[int | None, str | None, bool]:
    size = _xml_int(node.attrib.get("sz"))
    font_size = max(1, min(size // 100, 200)) if size else None
    return font_size, _xml_srgb(node), str(node.attrib.get("b") or "") in {"1", "true"}


def _paragraph_lines(paragraph: Any) -> list[dict[str, Any]]:
    """一段里的字号和字色。run 上的 rPr 盖过段默认 defRPr。

    ⚠ 2026-09-22 启动会封面的白字只写在 defRPr，run 里没有 rPr。
      只认 rPr 时字色丢失，深蓝底上被画成近黑，标题直接看不见。
      同一文本框里标题 44pt 白、副题 19pt 浅蓝，收成一个字号就会把副题裁掉。
    """
    default_size = default_color = None
    default_bold = False
    for node in paragraph.iter():
        if _xml_local(node.tag) == "defRPr":
            default_size, default_color, default_bold = _text_style(node)
            break
    lines: list[dict[str, Any]] = []
    for node in list(paragraph):
        if _xml_local(node.tag) != "r":
            continue
        size, color, bold = default_size, default_color, default_bold
        parts: list[str] = []
        for child in node.iter():
            local = _xml_local(child.tag)
            if local == "rPr":
                run_size, run_color, run_bold = _text_style(child)
                if run_size:
                    size = run_size
                if run_color:
                    color = run_color
                if run_bold:
                    bold = True
            elif local == "t" and child.text and child.text.strip():
                parts.append(child.text.strip())
        if not parts:
            continue
        item: dict[str, Any] = {"text": "".join(parts)}
        if size:
            item["fontSize"] = size
        if color:
            item["color"] = color
        if bold:
            item["bold"] = True
        lines.append(item)
    if lines:
        return lines
    parts = [
        node.text.strip()
        for node in paragraph.iter()
        if _xml_local(node.tag) == "t" and node.text and node.text.strip()
    ]
    if not parts:
        return []
    item = {"text": "".join(parts)}
    if default_size:
        item["fontSize"] = default_size
    if default_color:
        item["color"] = default_color
    if default_bold:
        item["bold"] = True
    return [item]


def _shape_preview(shape: Any) -> dict[str, Any] | None:
    off = ext = None
    text_root = None
    fill_root = None
    for node in shape.iter():
        local = _xml_local(node.tag)
        if local == "off" and off is None:
            off = node
        elif local == "ext" and ext is None:
            ext = node
        elif local == "txBody" and text_root is None:
            text_root = node
        elif local == "spPr" and fill_root is None:
            fill_root = node
    lines: list[dict[str, Any]] = []
    anchor = None
    if text_root is not None:
        for node in text_root.iter():
            if _xml_local(node.tag) == "bodyPr":
                anchor = str(node.attrib.get("anchor") or "") or None
                break
        for node in text_root.iter():
            if _xml_local(node.tag) == "p":
                lines.extend(_paragraph_lines(node))
    text = "\n".join(str(line.get("text") or "") for line in lines)
    fill = _xml_srgb(fill_root) if fill_root is not None else None
    x = _xml_int(off.attrib.get("x")) if off is not None else None
    y = _xml_int(off.attrib.get("y")) if off is not None else None
    w = _xml_int(ext.attrib.get("cx")) if ext is not None else None
    h = _xml_int(ext.attrib.get("cy")) if ext is not None else None
    if not text and not fill:
        return None
    if x is None or y is None or not w or not h:
        return {"text": text} if text else None
    item: dict[str, Any] = {"x": x, "y": y, "w": w, "h": h, "text": text}
    if lines:
        item["lines"] = lines[:24]
        first = lines[0]
        if first.get("fontSize"):
            item["fontSize"] = first["fontSize"]
        if first.get("color"):
            item["color"] = first["color"]
    if anchor == "ctr":
        item["anchor"] = "ctr"
    if fill:
        item["fill"] = fill
    return item


def _slide_preview(xml: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        texts = [t for t in re.findall(r"<a:t[^>]*>([^<]*)</a:t>", xml) if t.strip()]
        return {"text": "\n".join(texts)}
    background = None
    for node in root.iter():
        if _xml_local(node.tag) == "bg":
            background = _xml_srgb(node)
            break
    shapes = []
    texts = []
    for node in root.iter():
        if _xml_local(node.tag) != "sp":
            continue
        item = _shape_preview(node)
        if not item:
            continue
        if item.get("text"):
            texts.append(str(item["text"]))
        if "x" in item:
            shapes.append(item)
        if len(shapes) >= 30:
            break
    slide: dict[str, Any] = {"text": "\n".join(texts)}
    if background:
        slide["background"] = background
    if shapes:
        slide["shapes"] = shapes
    return slide


def office_preview_payload(data: bytes, path: Any) -> dict[str, Any] | None:
    """没 soffice 时的可读预览。幻灯片带位置，失败返回 None，不编绿灯。

    ⚠ 2026-09-22 预览面把每页正文堆成文档卡片。Manus / TraeWork 是一页
      舞台加缩略图。只抽 <a:t> 时舞台没有坐标可摆。
    """
    suffix = office_artifact_suffix(path)
    if suffix is None or not is_office_zip_bytes(data):
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(bytes(data))) as archive:
            names = archive.namelist()
            if suffix == ".pptx":
                width, height = _slide_size(archive)
                slides = []
                for name in _slide_order(names):
                    xml = archive.read(name).decode("utf-8", "replace")
                    slides.append(_slide_preview(xml))
                if not slides:
                    return None
                return {
                    "kind": "slides",
                    "slideWidth": width,
                    "slideHeight": height,
                    "slides": slides,
                }
            if suffix == ".docx" and "word/document.xml" in names:
                xml = archive.read("word/document.xml").decode("utf-8", "replace")
                paragraphs = _docx_paragraphs(xml)
                if not paragraphs:
                    return None
                return {
                    "kind": "document",
                    "text": "\n".join(paragraphs)[:12000],
                    "paragraphs": paragraphs,
                }
            if suffix == ".xlsx":
                files = _sheet_files(names)
                if not files:
                    return None
                strings = _shared_strings(archive)
                titles = _sheet_names(archive)
                sheets = []
                for index, name in enumerate(files):
                    xml = archive.read(name).decode("utf-8", "replace")
                    title = titles[index] if index < len(titles) else f"Sheet{index + 1}"
                    sheets.append({"name": title, "rows": _sheet_rows(xml, strings)})
                return {"kind": "workbook", "sheetCount": len(sheets), "sheets": sheets}
    except (zipfile.BadZipFile, KeyError, ValueError, OSError):
        return None
    return None


def _docx_paragraphs(xml: str) -> list[str]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return [t for t in re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml) if t.strip()][:80]
    paragraphs = []
    for node in root.iter():
        if _xml_local(node.tag) != "p":
            continue
        parts = [
            child.text
            for child in node.iter()
            if _xml_local(child.tag) == "t" and child.text
        ]
        if parts:
            paragraphs.append("".join(parts))
        if len(paragraphs) >= 80:
            break
    return paragraphs


def _sheet_files(names: list[str]) -> list[str]:
    found = []
    for name in names:
        match = re.fullmatch(r"xl/worksheets/sheet(\d+)\.xml", name)
        if match:
            found.append((int(match.group(1)), name))
    found.sort(key=lambda item: item[0])
    return [name for _number, name in found[:8]]


def _sheet_names(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/workbook.xml"))
    except (KeyError, ET.ParseError):
        return []
    names = []
    for node in root.iter():
        if _xml_local(node.tag) != "sheet":
            continue
        title = str(node.attrib.get("name") or "").strip()
        if title:
            names.append(title[:80])
    return names[:8]


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except (KeyError, ET.ParseError):
        return []
    strings = []
    for node in root:
        if _xml_local(node.tag) != "si":
            continue
        parts = [
            child.text
            for child in node.iter()
            if _xml_local(child.tag) == "t" and child.text
        ]
        strings.append("".join(parts))
        if len(strings) >= 500:
            break
    return strings


def _sheet_rows(xml: str, strings: list[str]) -> list[list[str]]:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    rows = []
    for row in root.iter():
        if _xml_local(row.tag) != "row":
            continue
        cells = []
        for cell in list(row):
            if _xml_local(cell.tag) != "c":
                continue
            raw = ""
            for node in cell.iter():
                local = _xml_local(node.tag)
                if local in {"v", "t"} and node.text:
                    raw = node.text
                    break
            if cell.attrib.get("t") == "s":
                try:
                    raw = strings[int(raw)]
                except (ValueError, IndexError):
                    raw = ""
            cells.append(raw)
            if len(cells) >= 12:
                break
        if any(item.strip() for item in cells):
            rows.append(cells)
        if len(rows) >= 40:
            break
    return rows
