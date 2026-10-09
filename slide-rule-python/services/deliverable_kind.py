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
#: 一条命令收回、回执里点名并给链接的交付文件最多几份——跟沙盒收集脚本（project_workspace_artifacts 的 max_files）同一个数。
#: ⚠ 2026-10-07 真机 r103 sr-20261007203300-V6MJNJDCSG：收集上限从 8 放到 40 之后产物库收齐了 20 份，可回执的
#:   officeFiles / officeDownloads 还在 [:8]（工作器、回执快照、给模型那句话各一处）——模型说「回执被截断」，
#:   为拿后 12 份的链接一条条重跑命令，15 分钟耗光。数量收回来了、链接没交给模型，等于没收。
MAX_DELIVERED_FILES = 40
#: 纯文本交付物。跟办公文件同一条交付路（产物库 → 下载地址 → 右栏查看器），只是字节是 UTF-8 文本。
#: ⚠ 2026-10-04 真机 @doc-coauthoring 团队周会制度 sr-20261004174725-J5XFTG8673：模型写了一份 Markdown，
#:   办公计划只认 .pptx/.docx/.xlsx，它就落回 web-app——建 Vite 工程、开端口、跑浏览器验收（失败），
#:   收尾给的是 `/home/user/workspace/…md`，用户点不开。交付是「把文件交给用户」，不该绑在「做网页」上。
TEXT_DELIVERABLE_EXTENSIONS = frozenset({".md", ".txt", ".csv", ".json", ".mmd", ".yaml", ".yml"})
#: ⚠ 2026-10-07 真机 r100（@sliderule SPEC 包）：spec_tree.json、traceability_matrix.json、checks_ledger.json、
#:   state-flow.mmd 是 SPEC 包的机读交付，收尾说「已写入 output/」，用户一份都拿不到——后缀不在清单里。
#: 图片交付物（图表、导出的幻灯片页、设计稿）。同一条交付路，字节按文件头认，不认后缀。SVG 不收：它是能带脚本的 XML。
#: ⚠ 2026-10-07 真机 r85 sr-20261007155747-HMKAPNJ7WK（@data-visualization-discipline 四店销售趋势图）：模型画了
#:   output/门店上半年销售额趋势.png 和遮字测试图，看过、改过、再看过——收尾给用户的两个链接都是 404：
#:   产物库只收办公文件和文本，图一张没收。技能做出来的东西到不了用户手里。
IMAGE_DELIVERABLE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
#: output/ 下自动收回的（文本 + 图片）。办公文件哪儿都收，不在这里。
AUTO_COLLECTED_EXTENSIONS = TEXT_DELIVERABLE_EXTENSIONS | IMAGE_DELIVERABLE_EXTENSIONS
DELIVERABLE_EXTENSIONS = OFFICE_EXTENSIONS | AUTO_COLLECTED_EXTENSIONS
MAX_TEXT_DELIVERABLE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_DELIVERABLE_BYTES = 8 * 1024 * 1024
#: 文本交付物要从沙盒自动收的目录。别处的 .md 是说明、源码、技能中间件——只有显式链接才算交付。
TEXT_DELIVERABLE_DIR = "output"
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
    # ⚠ 2026-10-04：文本交付物（TEXT_DELIVERABLE_EXTENSIONS 头注）。只陈述收回规则，不写成命令。
    "output/ 下的 .md / .txt / .csv / .json / .mmd / .yaml 和图片（.png / .jpg / .gif / .webp）收回成交付文件；"
    "别处的（README、INSTRUCT.md、LOG.md）是工作文件，不算交付。"
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


#: 网页 / 后端工程的 E2B 镜像名（scripts/build_workspace_e2b_template.py 构建）。空 = 默认 code-interpreter。
WORKSPACE_E2B_TEMPLATE_ENV = "WHYBUDDY_WORKSPACE_E2B_TEMPLATE"


def workspace_e2b_template() -> str | None:
    """网页 / 后端工程要起的 E2B 镜像：带齐 Python、Node、Java、Go、PHP、Ruby、.NET、Rust 的那张。

    ⚠ 2026-10-09：默认镜像只有 Python、Node 和一个 Java 11——通用 Agent 接到 Go / PHP / .NET 的活，电脑上
      连编译器都没有（build_workspace_e2b_template.py 头注）。没配或名字不合法就返回 None，照旧用默认镜像：
      增强类，不许因为少一张镜像就开不了箱（§七）。
    """
    value = os.getenv(WORKSPACE_E2B_TEMPLATE_ENV, "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", value):
        return None
    return value


#: 模型看到的「这台工程电脑上有什么」。跟 scripts/build_workspace_e2b_template.py 装的那张清单成对（§4），
#: 两边的命令名由 tests/test_any_language_project_computer.py 钉在一起；默认镜像那句是 2026-10-09 真沙盒里逐个查的。
WORKSPACE_TOOLCHAINS_FACT = (
    "这台工程电脑装好了：Python 3.13（python3、pip）、Node 20（node、npm、npx，corepack 的 pnpm / yarn）、"
    "Java 21（java、mvn）、Go 1.24（go）、PHP 8.4（php、composer）、Ruby 3.3（ruby、gem）、.NET 8（dotnet）、"
    "Rust 1.85（rustc、cargo）。"
)
#: 预览从网关进来：请求里的 Host 是预览域名。检查 Host 的框架不放行，预览就是 400 / Blocked host。
PREVIEW_HOST_FACT = (
    "右侧预览经网关转发到开发服务器，请求里的 Host 是预览域名、不是 localhost；"
    "会检查 Host 的框架要放行所有主机才打得开预览（Django ALLOWED_HOSTS = ['*']、Rails config.hosts.clear、"
    "webpack / Angular 开发服务器 allowedHosts: 'all'）。服务器要监听 0.0.0.0。"
)
DEFAULT_TOOLCHAINS_FACT = (
    "这台工程电脑只有 Python 3.13（python3、pip）、Node 20（node、npm、npx）和 Java 11（java），"
    "没有 Go、PHP、Ruby、.NET、Rust，也没有 Maven。"
)


def workspace_toolchains_fact() -> str:
    """按这台电脑真用的镜像说实话：配了全家桶镜像说全家桶，没配说默认镜像有什么、缺什么。"""
    return (WORKSPACE_TOOLCHAINS_FACT if workspace_e2b_template() else DEFAULT_TOOLCHAINS_FACT) + PREVIEW_HOST_FACT


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


def deliverable_suffix(path: Any) -> str | None:
    """能当交付物交给用户的文件后缀：办公文件或纯文本。办公专属的判断（量结构、转 PDF）仍用 office_artifact_suffix。"""
    name = str(path or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
    for ext in DELIVERABLE_EXTENSIONS:
        if name.endswith(ext) and len(name) > len(ext):
            return ext
    return None


def is_text_deliverable_bytes(data: Any) -> bool:
    """UTF-8（可带 BOM）、不含 NUL、不超上限。二进制改个 .txt 后缀不算。"""
    if not isinstance(data, (bytes, bytearray)) or not 1 <= len(data) <= MAX_TEXT_DELIVERABLE_BYTES:
        return False
    blob = bytes(data)
    if b"\x00" in blob:
        return False
    try:
        blob.decode("utf-8-sig")
    except UnicodeDecodeError:
        return False
    return True


_IMAGE_MAGIC = {".png": (b"\x89PNG\r\n\x1a\n",), ".jpg": (b"\xff\xd8\xff",), ".jpeg": (b"\xff\xd8\xff",),
                ".gif": (b"GIF87a", b"GIF89a")}


def is_image_deliverable_bytes(path: Any, data: Any) -> bool:
    """文件头跟后缀对得上、不超上限。改个 .png 后缀的文本不算图。"""
    if not isinstance(data, (bytes, bytearray)) or not 1 <= len(data) <= MAX_IMAGE_DELIVERABLE_BYTES:
        return False
    head = bytes(data[:16])
    suffix = deliverable_suffix(path)
    if suffix == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    return any(head.startswith(magic) for magic in _IMAGE_MAGIC.get(suffix or "", ()))


def is_deliverable_bytes(path: Any, data: Any) -> bool:
    """这份字节配得上它的后缀：办公文件是 zip 包，文本是 UTF-8，图片的文件头对得上。"""
    suffix = deliverable_suffix(path)
    if suffix in OFFICE_EXTENSIONS:
        return is_office_zip_bytes(data)
    if suffix in TEXT_DELIVERABLE_EXTENSIONS:
        return is_text_deliverable_bytes(data)
    if suffix in IMAGE_DELIVERABLE_EXTENSIONS:
        return is_image_deliverable_bytes(path, data)
    return False


def is_auto_collected_output(path: Any) -> bool:
    """沙盒里自动收的交付物（文本 + 图片）：只认 output/ 下的（office-skills 的约定：output/ 只放给用户的最终产物）。

    ⚠ 2026-10-07 原名 is_auto_collected_text，只认文本；图片交付物加进来时改名，四处调用（沙盒里的收集脚本、
      worker 收回、收尾链接认领、写入算不算产出）一起改——只改一处就是一半不生效（CLAUDE.md §四）。
    """
    rel = str(path or "").replace("\\", "/").lstrip("/")
    return (rel.split("/", 1)[0] == TEXT_DELIVERABLE_DIR and "/" in rel
            and deliverable_suffix(rel) in AUTO_COLLECTED_EXTENSIONS)


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
                toc = _docx_toc_problem(body)
                facts["tocEmpty"] = int(toc == "empty")
                facts["tocDisordered"] = int(toc == "disordered")
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
                        # ⚠ 第 156 轮（餐厅经营表，空白录入模板）：IF(OR(B5="",B5=0),"",G5/B5) 的结果本来就是
                        #   空字符串，XlsxWriter 存成 <v></v>——和 openpyxl「没存结果」字节一模一样。第一版把这 18 格
                        #   也算成「没算好」，回执对模型说「总分、合计都是空的」，是宿主在说错话。
                        #   公式自己能返回 "" 的，空结果不算没算好（分不清就不报，§七）。
                        if not _XLSX_CACHED.search(cell) and b'""' not in cell and b"&quot;&quot;" not in cell:
                            uncached += 1
                facts["formulas"] = formulas
                facts["formulasUncached"] = uncached
                if formulas:
                    wrong = _xlsx_cached_results_that_disagree(archive, names)
                    facts["formulasWrong"] = len(wrong)
                    if wrong:
                        facts["formulasWrongSamples"] = wrong[:3]
            stray = _literal_newlines(archive, names)
            facts["literalNewlines"] = len(stray)
            if stray:
                facts["literalNewlinesSamples"] = stray[:3]
            if facts["charts"]:
                flat = _chart_series_flattened(archive, names)
                facts["chartSeriesFlat"] = len(flat)
                if flat:
                    facts["chartSeriesFlatSamples"] = flat[:3]
            return facts
    except Exception:
        return None


_C = "{http://schemas.openxmlformats.org/drawingml/2006/chart}"
#: 同一根数值轴上，最大值不到轴上最大值的这个比例，画出来就是贴着 0 的一条。
_FLAT_SERIES_RATIO = 0.02


def _chart_series_flattened(archive: zipfile.ZipFile, names: list[str]) -> list[str]:
    """图表里被同轴的大数压扁的系列：「第 4 页「转化率」最大 19.5，同一根轴上最大 2,760」。

    ⚠ 2026-10-01 隔离真机第 180 轮（门店月度复盘 PPT）：第 4 页「客流与转化」组合图，客流 2350～2760、转化率 17.8～19.5
      放在同一根数值轴上（python-pptx 不直接支持次坐标轴），转化率那条线贴着 0 画成一条平线，图例里「转化率」还出现两次。
      模型自己在图下补了一行「组合图中转化率与客流共用主坐标轴，重点读趋势变化」——知道画坏了，用注解盖过去。
      回执里原生图表 3 个，数对；用户看到的是一条读不出来的线。
    """
    pages: dict[str, int] = {}
    for name in names:
        hit = re.match(r"ppt/slides/_rels/slide(\d+)\.xml\.rels$", name)
        if hit:
            for target in re.findall(rb'Target="\.\./charts/(chart\d+\.xml)"', archive.read(name)):
                pages["ppt/charts/" + target.decode()] = int(hit.group(1))
    found: list[str] = []
    for name in sorted(n for n in names if _CHART_PART.match(n)):
        try:
            root = ET.fromstring(archive.read(name))
        except ET.ParseError:
            continue
        area = root.find(f".//{_C}plotArea")
        if area is None:
            continue
        value_axes = {ax.find(f"{_C}axId").get("val") for ax in area.findall(f"{_C}valAx")
                      if ax.find(f"{_C}axId") is not None}
        groups: dict[str, list[tuple[str, float]]] = {}
        for plot in area:
            if not plot.tag.endswith("Chart") or plot.tag.endswith(("pieChart", "doughnutChart", "pie3DChart")):
                continue
            axis = next((ax.get("val") for ax in plot.findall(f"{_C}axId") if ax.get("val") in value_axes), "")
            for ser in plot.findall(f"{_C}ser"):
                label = "".join(t.text or "" for t in ser.findall(f"{_C}tx//{_C}v")) or "未命名系列"
                numbers = []
                for v in ser.findall(f"{_C}val//{_C}v"):
                    try:
                        numbers.append(abs(float(v.text or "")))
                    except ValueError:
                        continue
                if numbers:
                    groups.setdefault(axis, []).append((label, max(numbers)))
        for series in groups.values():
            top = max(peak for _label, peak in series)
            if top <= 0 or len(series) < 2:
                continue
            where = f"第 {pages[name]} 页" if name in pages else "图表"
            for label, peak in series:
                if peak < top * _FLAT_SERIES_RATIO:
                    entry = f"{where}「{label}」最大 {peak:,.4g}，同一根轴上最大 {top:,.4g}"
                    if entry not in found:
                        found.append(entry)
    return found


#: 文字节点：xlsx 共享串 / 行内串 <t>，docx <w:t>，pptx <a:t>。
_TEXT_NODE = re.compile(rb"<(?:t|w:t|a:t)(?:\s[^>]*)?>([^<]*)</(?:t|w:t|a:t)>")
_TEXT_PARTS = re.compile(r"^(?:xl/sharedStrings\.xml|xl/worksheets/sheet\d+\.xml|word/document\.xml|ppt/slides/slide\d+\.xml)$")
#: 反斜杠 + n，后面不是字母（C:\new folder 那种路径不算）。
_LITERAL_NEWLINE = re.compile(r"\\n(?![A-Za-z])")


def _literal_newlines(archive: zipfile.ZipFile, names: list[str]) -> list[str]:
    """文字里出现字面的「\\n」：想换行，却把转义符原样写进了文件。返回每段的一小截（换行符前那几个字）。

    ⚠ 2026-10-01 隔离真机第 179 轮（市场部预算执行 Excel，追问「再加一页给领导看的结论」）：「领导结论」页的管理建议是
      「1. 重点复盘……等原因。\\n2. 对超预算月份……\\n3. ……」——预览里就是反斜杠加 n 夹在句子中间。模型收尾说
      「领导结论页已确认存在」，它回读核的是页在不在，没看字。三种格式都会：python-docx 的 add_run、
      python-pptx 的 text_frame.text 一样会被写成字面。
    """
    found: list[str] = []
    for name in names:
        if not _TEXT_PARTS.match(name):
            continue
        for raw in _TEXT_NODE.findall(archive.read(name)):
            text = raw.decode("utf-8", "replace")
            hit = _LITERAL_NEWLINE.search(text)
            if hit:
                found.append(text[max(0, hit.start() - 12):hit.start()].strip() + "\\n")
    return found


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
  | (?P<str>"(?:[^"]|"")*")
  | (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
  | (?P<func>[A-Z][A-Z0-9.]*)\(
  | (?P<op>[-+*/^(),])
)""", re.X)
_SUPPORTED_FUNCS = {"SUM", "AVERAGE", "MIN", "MAX", "COUNT", "ROUND",
                    "COUNTA", "COUNTIF", "COUNTIFS", "SUMIF", "SUMIFS"}
#: 条件里的比较符（COUNTIF 的 ">=100"、"<>市场部"）。长的在前。
_CRITERIA_OPS = ("<>", ">=", "<=", ">", "<", "=")


class _Other:
    """布尔 / 错误值：既不是数也不是文字。"""


_OTHER = _Other()


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


def _xlsx_evaluator(archive: zipfile.ZipFile, names: list[str]):
    """读进全部单元格，给出「按公式算这一格」的函数：(cells, cell_value)。量不了的公式 cell_value 抛 _Unsupported。

    从 _xlsx_cached_results_that_disagree 里拆出来（2026-10-07）：存值核对和预览补值（_xlsx_computed_formula_values）
    用同一把尺子，别再抄一份算法（§四）。超过 5 万格返回 (None, None)。
    """
    parts = _xlsx_sheet_parts(archive)
    # ⚠ 2026-10-06 真机 r49 sr-20261007053537-V9SZN2TTQ8（@office-skills 报销记录 Excel）：部门汇总「市场部 记录数」
    #   写的是 =COUNTIF('01-报销明细'!$E$2:$E$7,A2)，存的 2、按公式是 3（合计存 5、实为 6）——右栏预览照存的数画 2，
    #   用户在 Excel 里一重算变 3，同一份文件两处两个数。这一道当时只认 SUM 那一撮，文字一律收成 "text"，按条件数文字的
    #   COUNTIF / SUMIF 量不了，就不报（fail-open），模型的「公式缓存检查」也没看出来。现在留住文字本身，认条件统计。
    shared: list[str] = []
    if "xl/sharedStrings.xml" in names:
        for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).iter(_SS_NS + "si"):
            shared.append("".join(t.text or "" for t in si.iter(_SS_NS + "t")))
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
            if kind == "inlineStr":
                value = "".join(t.text or "" for t in c.iter(_SS_NS + "t"))
            elif v is not None and v.text is not None:
                if kind == "s":
                    try:
                        value = shared[int(v.text)]
                    except (ValueError, IndexError):
                        value = _OTHER
                elif kind == "str":
                    value = v.text
                elif kind in ("b", "e"):
                    value = _OTHER
                else:
                    try:
                        value = float(v.text)
                    except ValueError:
                        value = _OTHER
            formula = None
            if f is not None:
                formula = f.text if (f.text and f.attrib.get("t") not in ("array", "dataTable")) else ""
            cells[(sheet, ref)] = (formula, value)
            if len(cells) > 50000:
                return None, None
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
            if peek("str"):
                return take().group("str")[1:-1].replace('""', '"')
            if peek("ref"):
                m = take()
                values = area(m)
                # 单格原样交回（文字也行，条件统计要用）；参与四则运算时由 scalar() 把关。
                return values if m.group("c2") else values[0]
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

        def matches(item: Any, criterion: Any) -> bool:
            """Excel 条件：数 = 相等；文字可带比较符；不认通配符（量不准就不报）。"""
            if isinstance(criterion, float):
                return isinstance(item, float) and item == criterion
            if not isinstance(criterion, str):
                raise _Unsupported
            op, rest = "=", criterion
            for candidate in _CRITERIA_OPS:
                if criterion.startswith(candidate):
                    op, rest = candidate, criterion[len(candidate):]
                    break
            if "*" in rest or "?" in rest or "~" in rest:
                raise _Unsupported
            try:
                number: float | None = float(rest)
            except ValueError:
                number = None
            if number is not None:
                if not isinstance(item, float):
                    return op == "<>"
                return {"=": item == number, "<>": item != number, ">": item > number, ">=": item >= number,
                        "<": item < number, "<=": item <= number}[op]
            if op not in ("=", "<>"):
                raise _Unsupported
            if rest == "":
                blank = item is None or item == ""
                return blank if op == "=" else not blank
            same = isinstance(item, str) and item.casefold() == rest.casefold()
            return same if op == "=" else not same

        def conditional(name: str, args: list[Any]) -> float:
            if name == "COUNTA":
                return float(sum(1 for arg in args for item in (arg if isinstance(arg, list) else [arg])
                                 if item is not None and item != ""))
            if name in ("SUMIF", "COUNTIF"):
                if len(args) not in (2, 3) or not isinstance(args[0], list) or isinstance(args[1], list):
                    raise _Unsupported
                if name == "COUNTIF" and len(args) != 2:
                    raise _Unsupported
                pairs, sums = [(args[0], args[1])], (args[2] if len(args) == 3 else args[0])
            else:
                first = 1 if name == "SUMIFS" else 0
                rest = args[first:]
                if len(rest) < 2 or len(rest) % 2 or any(isinstance(rest[i + 1], list) or not isinstance(rest[i], list)
                                                         for i in range(0, len(rest), 2)):
                    raise _Unsupported
                pairs = [(rest[i], rest[i + 1]) for i in range(0, len(rest), 2)]
                sums = args[0] if name == "SUMIFS" else pairs[0][0]
            if not isinstance(sums, list) or any(len(rng) != len(sums) for rng, _ in pairs):
                raise _Unsupported
            hits = [i for i in range(len(sums)) if all(matches(rng[i], crit) for rng, crit in pairs)]
            if name.startswith("COUNT"):
                return float(len(hits))
            return float(sum(sums[i] for i in hits if isinstance(sums[i], float)))

        def call(name: str, args: list[Any]) -> float:
            if name in ("COUNTA", "COUNTIF", "COUNTIFS", "SUMIF", "SUMIFS"):
                return conditional(name, args)
            numbers: list[float] = []
            for arg in args:
                for item in (arg if isinstance(arg, list) else [arg]):
                    if isinstance(item, float):
                        numbers.append(item)
                    elif not (item is None or isinstance(item, str)) or not isinstance(arg, list):
                        raise _Unsupported          # 区域里的文字 / 空格跳过（同 Excel）；单独传文字、布尔、错误值不认
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

    return cells, cell_value


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
    cells, cell_value = _xlsx_evaluator(archive, names)
    if cells is None:
        return []

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


#: 一格拆成（属性, 里面）。⚠ 别叫 _XLSX_CELL——那个名字上面已经有了（整格，office_facts 数公式用），第一版同名把它
#: 盖了，公式全数成 0。
_XLSX_CELL_PARTS = re.compile(rb"<c\b([^>]*)>(.*?)</c>", re.S)
_XLSX_EMPTY_V = re.compile(rb"<v\s*/>|<v>\s*</v>")


def xlsx_preview_bytes(data: bytes) -> bytes:
    """给右栏预览 / 卡片缩略图的那一份：没存结果的公式格，按公式算出来的数写进 <v>。下载的原件不走这里。

    ⚠ 2026-10-07 真机 r55 / r56 sr-20261007062152-HKXEC83K48：openpyxl 改过的报销表，汇总页 12 个公式的 <v> 全空。
      右栏预览（PresentedOfficeFile）和缩略图（OfficeThumbnail）是浏览器里 @silurus/ooxml 直接画文件字节、只认存的
      结果——第一版把补算接在 office_preview_payload 上，那条是库里存的 JSON 预览，**不是用户看的这两处**（§一）。
      预览要的是字节，就在给预览的字节上补；Excel 打开本来就会重算，补的数跟它算的同一套口径（_xlsx_evaluator）。
    增强项：算不了的格子照旧空着；任何一步出错原样返回（§七 fail-open）。
    """
    try:
        with zipfile.ZipFile(io.BytesIO(bytes(data))) as archive:
            names = archive.namelist()
            computed = _xlsx_computed_formula_values(archive, names)
            if not computed:
                return data
            parts = _xlsx_sheet_parts(archive)
            patched: dict[str, bytes] = {}
            for sheet, part in parts.items():
                wanted = {ref: value for (name, ref), value in computed.items() if name == sheet}
                if not wanted or part not in names:
                    continue
                xml = archive.read(part)

                def fill(match: re.Match, wanted=wanted) -> bytes:
                    attrs, body = match.group(1), match.group(2)
                    ref = re.search(rb'\br="([A-Z]{1,3}\d+)"', attrs)
                    key = ref.group(1).decode() if ref else ""
                    if key not in wanted or b"<f" not in body:
                        return match.group(0)
                    value = _preview_number(wanted[key]).encode()
                    attrs = re.sub(rb'\st="[^"]*"', b"", attrs)          # 补的是数，别留着 t="str"
                    if _XLSX_EMPTY_V.search(body):
                        body = _XLSX_EMPTY_V.sub(b"<v>" + value + b"</v>", body, count=1)
                    elif b"<v>" not in body:
                        body = re.sub(rb"(</f>|<f\b[^>]*/>)", lambda m: m.group(1) + b"<v>" + value + b"</v>", body, count=1)
                    else:
                        return match.group(0)
                    return b"<c" + attrs + b">" + body + b"</c>"
                patched[part] = _XLSX_CELL_PARTS.sub(fill, xml)
            if not patched:
                return data
            out = io.BytesIO()
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
                for info in archive.infolist():
                    target.writestr(info, patched.get(info.filename, archive.read(info.filename)))
            return out.getvalue()
    except Exception:
        return data


def _xlsx_computed_formula_values(archive: zipfile.ZipFile, names: list[str]) -> dict[tuple[str, str], float]:
    """没存结果的公式格，按公式算出来的数：{(表名, 格): 值}。量不了的不给（预览照旧空着，fail-open）。

    ⚠ 2026-10-07 真机 r55 / r56 sr-20261007062152-HKXEC83K48（报销 Excel 追问）：模型 openpyxl load→改→save，汇总页
      12 个公式的结果全丢。用户在 Excel 里打开会重算、数是对的；空的只是我们自己的右栏预览和结果卡缩略图——它们照着存的
      <v> 画。回执每轮都说「交付前补上」，可用户一句「其他不要动」，模型就不碰（指令冲突，它选了用户）。预览是宿主画的，
      宿主手里有公式和计算器，能算的就自己算出来画，不靠模型每次记得换 XlsxWriter。文件字节一个不动。
    """
    cells, cell_value = _xlsx_evaluator(archive, names)
    if cells is None:
        return {}
    out: dict[tuple[str, str], float] = {}
    for (sheet, ref), (formula, cached) in cells.items():
        if not formula or cached is not None:
            continue
        try:
            value = cell_value(sheet, ref)
        except (_Unsupported, RecursionError, OverflowError, ValueError):
            continue
        if isinstance(value, float):
            out[(sheet, ref)] = value
    return out


_DOCX_TOC_FIELD = re.compile(rb'(?:<w:instrText[^>]*>\s*TOC\b|w:instr="\s*TOC\b)')
#: 有内容的 fldChar（它本该是空元素）：里面的东西渲染器不画，不能算成目录条目。
_DOCX_FLDCHAR_BODY = re.compile(rb"<w:fldChar\b[^>]*[^/]>.*?</w:fldChar>", re.S)
_DOCX_HEADING_STYLE = re.compile(r"(?i)^(?:heading\s?[1-3]|标题\s?[1-3])$")
_DOCX_TOC_TITLES = {"目录", "目 录", "contents", "tableofcontents"}


def _docx_toc_problem(body: bytes) -> str | None:
    """用户在「目录」底下真正看到的：空（"empty"）、顺序和正文对不上或全挤一段（"disordered"），没毛病 None。

    ⚠ 2026-09-30 隔离真机第 162 轮（咖啡店店员培训手册）：「目录」标题下面是一个 TOC 域，
      域结果只有一句「右键单击此处并选择“更新域”」，还写进了 fldChar 里面——右栏预览、结果卡缩略图
      「目录」下面一片空白。隔离库 61 份 Word 里 17 份有目录域，17 份全是空的：python-docx 只会插域，
      不会生成条目。
    ⚠ 第 163 轮（扫地机器人说明书）：照回执补了 40 多条 TOC1/TOC2 段落，整段塞进了
      <w:fldChar w:fldCharType="separate">…</w:fldChar> 里——渲染器不看 fldChar 里面，照样空。
      第一版只数「有没有 TOC 样式段落」，报成了「不空」。
    ⚠ 第 164 轮（智能门锁说明书）：条目写在了域 end 之后、同一段里、对同一个位置反复插——
      预览里先是 40 行空白，页底一行挤着「5.8 … 5.1 第5章 … 第1章」倒着来。第二版只看有没有 TOC 样式，
      说它「空」，用户看到的却是倒序一行。第三版不再猜条目的写法，只量用户看到的：
      目录区 = 目录域（或「目录」段落）到正文第一个章节标题之间，渲染器会画的字；
      正文章节标题（Heading 1–3）在这片字里找得到几个、按什么顺序。
    正文没有章节标题样式就不下结论（fail-open，§七）。
    """
    clean = _DOCX_FLDCHAR_BODY.sub(b"", body)
    paras = []
    for para in _DOCX_PARA.findall(clean):
        style = _DOCX_PSTYLE.search(para)
        name = style.group(1).decode("utf-8", "replace") if style else ""
        text = b"".join(_DOCX_TEXT.findall(para)).decode("utf-8", "replace")
        paras.append((name, re.sub(r"\s+", "", text), bool(_DOCX_TOC_FIELD.search(para))))
    start = next((i for i, (_name, _text, field) in enumerate(paras) if field), None)
    if start is None:
        start = next((i + 1 for i, (_name, text, _field) in enumerate(paras) if text.lower() in _DOCX_TOC_TITLES), None)
    if start is None:
        return None
    heads = [(i, text) for i, (name, text, _field) in enumerate(paras)
             if i >= start and text and _DOCX_HEADING_STYLE.match(name)]
    if not heads:
        return None
    region = [text for _name, text, _field in paras[start:heads[0][0]]]
    found = []
    for _i, head in heads:
        for index, text in enumerate(region):
            at = text.find(head)
            if at >= 0:
                found.append((index, at))
                break
    if not found:
        return "empty"
    if len(found) >= 3 and (found != sorted(found) or len({index for index, _at in found}) == 1):
        return "disordered"
    return None


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
        # ⚠ 2026-10-07 r55 / r56：右栏预览和缩略图改成画「宿主补过存值」的那份（xlsx_preview_bytes），本平台里不再是空白，
        #   这句不能再说「用户第一眼看到空白」——宿主不许说假话。但文件本身仍没存结果：用户下载后在手机文件预览、
        #   邮件附件预览、WPS 只读模式里看到的还是空格子。照实说在哪儿空，补法不变。
        note += (f"，公式 {facts.get('formulas', uncached)} 个里 {uncached} 个没有算好的结果"
                 "（文件里这些格子没存结果：用户下载后在手机文件预览、邮件附件预览、WPS 只读里看到的是空白——"
                 "总分、合计、排名都是空的；本平台右栏是宿主按公式补算出来画的，不代表文件里有。"
                 "交付前补上：openpyxl 存不了结果；改用 XlsxWriter，"
                 "worksheet.write_formula(单元格, 公式, 格式, 值) 把 Python 算好的值一起写进去，公式照样保留）")
    wrong = int(facts.get("formulasWrong") or 0)
    if wrong:
        # 第 155 轮，见 _xlsx_cached_results_that_disagree 头注。
        samples = "；".join(str(item) for item in (facts.get("formulasWrongSamples") or [])[:3])
        shown = f"（{samples}）" if samples else ""
        note += (f"，公式 {facts.get('formulas', wrong)} 个里 {wrong} 个存的结果和按公式算出来的对不上{shown}"
                 "——右侧预览和卡片缩略图显示的是存的那个数，用户看到的就是错的。交付前核对：写进去的值要等于公式"
                 "真算出来的结果，也看一眼公式引用的范围本身对不对")
    invisible = int(facts.get("textInvisible") or 0)
    if invisible:
        # 第 153 轮，见 _pptx_text_on_same_color 头注。
        samples = "、".join(str(item) for item in (facts.get("textInvisibleSamples") or [])[:3])
        shown = f"（比如 {samples}）" if samples else ""
        note += (f"，有 {invisible} 处文字和它下面的底色几乎同色{shown}"
                 "——用户在右侧预览和结果卡缩略图里看到的是一块没字的色块。交付前把这些字改成和底色反差明显的颜色")
    if facts.get("tocEmpty") or facts.get("tocDisordered"):
        # 第 162–164 轮，见 _docx_toc_problem 头注。
        seen = ("「目录」下面是空的" if facts.get("tocEmpty")
                else "「目录」下面的条目和正文章节的顺序对不上（倒序，或者全挤在一段里）")
        note += (f"，用户在右侧预览和结果卡缩略图里看到{seen}。最稳的写法：不用 TOC 域，在「目录」标题下"
                 "按正文章节的顺序一条一段地写（一级顶格、二级缩进一点，页码可以不写）——python-docx 就是"
                 "按顺序 add_paragraph，别对同一个位置反复 insert_paragraph_before（会整份倒过来）。"
                 "一定要 Word 自动目录，就把这些段落写在域的 separate 和 end 之间、和 "
                 "<w:fldChar w:fldCharType=\"separate\"/> 平级（它是空元素，塞进里面渲染器一个字都不画）")
    doubled = int(facts.get("listDoubleMarked") or 0)
    if doubled:
        # 第 151 轮，见 _docx_double_marked 头注。
        note += (f"，有 {doubled} 段列表带着自动项目符号 / 编号、正文又手写了「1.」「•」这类记号"
                 "（用户在右侧预览和 Word 里看到的是「• 1.」两个记号。交付前去掉正文里手写的那个，"
                 "或者把这几段改成不带自动符号的普通段落）")
    flat = int(facts.get("chartSeriesFlat") or 0)
    if flat:
        # 第 180 轮，见 _chart_series_flattened 头注。
        samples = "；".join(str(item) for item in (facts.get("chartSeriesFlatSamples") or [])[:3])
        shown = f"（{samples}）" if samples else ""
        note += (f"，有 {flat} 个图表系列跟量级大得多的系列挤在同一根数值轴上{shown}——用户看到的是一条贴着 0 的平线，"
                 "读不出变化。交付前改掉：拆成两张图最稳（python-pptx 不直接支持次坐标轴），或者把它换算到同一量级；"
                 "不要在图下面加一行注解解释它为什么看不清")
    stray = int(facts.get("literalNewlines") or 0)
    if stray:
        # 第 179 轮，见 _literal_newlines 头注。
        samples = "；".join(str(item) for item in (facts.get("literalNewlinesSamples") or [])[:3])
        shown = f"（比如「{samples}」）" if samples else ""
        note += (f"，有 {stray} 段文字里是字面的反斜杠加 n{shown}——想换行却把转义符原样写进去了，"
                 "用户在右侧预览里看到的就是「\\n」夹在句子中间。交付前改掉：Python 里写真正的换行（\"\\n\" 而不是 "
                 "\"\\\\n\" 或 r\"\\n\"），Excel 单元格再开 wrap_text；Word 一条一段 add_paragraph；PPT 一条一个段落")
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
                try:
                    computed = _xlsx_computed_formula_values(archive, names)   # 增强项：算不了就空着（§七）
                except Exception:
                    computed = {}
                try:
                    by_part = {part: title for title, part in _xlsx_sheet_parts(archive).items()}
                except Exception:
                    by_part = {}
                sheets = []
                for index, name in enumerate(files):
                    xml = archive.read(name).decode("utf-8", "replace")
                    title = by_part.get(name) or (titles[index] if index < len(titles) else f"Sheet{index + 1}")
                    filled = {ref: value for (sheet, ref), value in computed.items() if sheet == title}
                    sheets.append({"name": title, "rows": _sheet_rows(xml, strings, filled)})
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


_CELL_REF = re.compile(r"^([A-Z]{1,3})(\d+)$")
PREVIEW_COLUMNS = 12
PREVIEW_ROWS = 40


def _preview_number(value: float) -> str:
    """补出来的数照「存的结果」那样写：整数不带 .0，其余去掉浮点尾巴。"""
    rounded = round(value, 10)
    return str(int(rounded)) if rounded == int(rounded) and abs(rounded) < 1e15 else repr(rounded)


def _sheet_rows(xml: str, strings: list[str], computed: dict[str, float] | None = None) -> list[list[str]]:
    """右栏预览的一张表：每行按**列坐标**放格子；公式没存结果的，用宿主算出来的数补（computed，可空）。

    ⚠ 2026-10-07 真机 r56 sr-20261007062152-HKXEC83K48：日志表新加的一行只有 A6（空）和 E6（文字），原来不看 r 属性、
      按出现顺序挨着排，E 列那句话画到了 B 列——一行里只要中间缺格，后面全往左挪。
    """
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    computed = computed or {}
    rows = []
    for row in root.iter():
        if _xml_local(row.tag) != "row":
            continue
        cells: list[str] = []
        for cell in list(row):
            if _xml_local(cell.tag) != "c":
                continue
            ref = cell.attrib.get("r", "")
            match = _CELL_REF.match(ref)
            column = _col_number(match.group(1)) - 1 if match else len(cells)
            if column >= PREVIEW_COLUMNS:
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
            if not raw and ref in computed:
                raw = _preview_number(computed[ref])
            while len(cells) < column:
                cells.append("")
            if len(cells) == column:
                cells.append(raw)
            else:
                cells[column] = raw
        if any(item.strip() for item in cells):
            rows.append(cells)
        if len(rows) >= PREVIEW_ROWS:
            break
    return rows
