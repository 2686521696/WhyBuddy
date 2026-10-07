"""Closed, typed project-tool inputs shared by model dispatch and HTTP adapters."""

from __future__ import annotations

import posixpath
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class CreateArguments(ToolArguments):
    approvalRef: str | None = Field(default=None, min_length=1, max_length=240,   # 同 WriteArguments 头注
        description="Omit it: the server binds the currently approved plan. If sent, it must match exactly.")
    # ⚠ 2026-09-25 隔离真机 sr-20260925053053-T4TJXXCW0Z：记账网页选了
    #   react-vite-tasks。那个模板把交付锁死在任务清单验收上（登录、增改筛任务），
    #   记账页写得再好也永远交不了。上一轮同一话题选的是 react-vite——选择不稳定，
    #   原描述只说「tasks 只给任务管理应用」「react-vite 是 a minimal computer」，
    #   后者读起来像个空壳，没说它才是默认，也没说选错的后果。
    templateId: Literal["react-vite", "react-vite-tasks"] = Field(default="react-vite", description=(
        "react-vite (default): use for every web page or web app, including ones that keep their data in "
        "the browser (localStorage) such as trackers, ledgers, planners, dashboards and games. "
        "react-vite-tasks: only for exactly a task-management app with login and writer/reader roles; "
        "its delivery is locked to a fixed task-list acceptance suite, so any other app built on it can never be delivered."))


class RevisionArguments(ToolArguments):
    revision: str | None = Field(default=None, min_length=1, max_length=240)


class ListArguments(RevisionArguments):
    cursor: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=20)


#: `project_read` 一次最多回多少字符。
#:
#: 抄的标准答案：grok-build
#: `xai-grok-tools/src/implementations/grok_build/read_file/mod.rs` +
#: `xai-grok-tools/src/types/context.rs`：
#:
#:     /// Max lines to read (read_file). Default: 1000.
#:     pub max_lines_read: Option<usize>,
#:     ...
#:     Some(input.limit.unwrap_or(usize::MAX).min(max_lines))
#:
#: 两条形状都抄了：**不传 limit 就是"整份读完"**（再由上限夹住），以及
#: 上限本身要大到一次能吞下一个正常源文件。grok 的默认是 1000 行 / 25k token，
#: 我们按字符计，取 8000。
#:
#: ⚠ 2026-09-14 真机（text168/grok-4.6，`artifacts/control-real-model/1fcfd3d4`）
#:   就是被这个数字烧死的。原值 2000 字符，而模板里正常源文件是：
#:
#:       database.mjs 7458  server.mjs 7356  src/main.tsx 7188
#:       tests/application.test.mjs 6529  src/style.css 2775  README.md 1040
#:
#:   读完一遍要 19 次调用 / 4 轮。真机跑到第 5 轮（共 16 轮）时 offset 老老实实
#:   走到 0→2000→4000，**一次都没打转**，64000 的 token 预算先烧完了：
#:
#:       stopReason=token_budget limit=64000 used=64488   页面落库：0 份
#:
#:   原地打转护栏一次都没响——它是对的，模型确实在往前走，只是窗口太小，
#:   同样的字节被"重发历史"摊进 4 轮里。8000 之后同样这批文件 6 次调用 / 1 轮。
#:
#: ⚠ 这个数字**不是单独生效的**（CLAUDE.md §4）。它下游还有两道夹子，
#:   只改这一个不会报错、只会一点效果都没有：
#:       services/project_tools.py        `PROJECT_READ_MAX_RESULT_CHARS`（信封）
#:       services/rehearsal_control.py    `control_tool_result_max_chars()`（回喂）
#:   `tests/test_project_read_window_fits_real_sources.py` 把三道一起钉住。
PROJECT_READ_MAX_CHARS = 8000


#: `project_read` 专用的信封上限（其余工具仍走 MAX_RESULT_CHARS）。
#:
#: 抄 grok `TruncationConfig::per_tool_max_output_bytes`——按工具名覆盖，
#: 默认档不动：
#:
#:     /// Per-tool overrides keyed by canonical tool name.
#:     pub per_tool_max_output_bytes: HashMap<String, usize>,
#:     ...
#:     Precedence: per-tool override > default override > built-in fallback.
#:
#: ⚠ 为什么必须单列一个（CLAUDE.md §4）：`_bounded_text` 夹的是**整包 JSON**，
#:   3800 的信封会把 8000 字的正文当场砍回 ~3500。把 PROJECT_READ_MAX_CHARS
#:   调大而不动这里，不报错、不告警，读窗一个字都不会变宽。
#:
#: 取值 = 8000 正文 × JSON 转义余量（源码里的换行/引号会变两个字符）+ 信封
#: 那几个字段（revision / path / sha256 / offset / nextOffset / totalChars）。
PROJECT_READ_MAX_RESULT_CHARS = 10_000

#: 无窗 file_read / project_read 只回路径 + 文件头。要原文必须显式带
#: offset / limit / start_line / end_line。抄 Manus filesystem-as-context：
#: 磁盘是权威，messages 里不灌全文。
FILE_READ_EXCERPT_LINES = 40
FILE_READ_EXCERPT_CHARS = 800


def explicit_read_window(args: object) -> bool:
    """模型有没有点名读窗。默认字段不算——pydantic 会填 offset=0 / limit=8000。"""
    provided = getattr(args, "model_fields_set", set())
    return bool(provided & {"start_line", "end_line", "offset", "limit"})


class ReadArguments(RevisionArguments):
    path: str = Field(min_length=1, max_length=240)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=PROJECT_READ_MAX_CHARS, ge=1, le=PROJECT_READ_MAX_CHARS)

    @field_validator("limit", mode="before")
    @classmethod
    def _clamp_limit(cls, value):
        """窗口开得比上限大，就按上限读：回执照旧给 truncated / nextOffset，接着读就行。

        ⚠ 2026-09-27 第 26 轮起补了参数错误的说法，仍一再撞：2026-09-29 隔离真机第 111 轮
          sr-20260929083948-EGWA0HBPM3（大学生课程表网页，追问「每门课可以设置颜色」）同一批并行两发
          `project_read limit=12000`，两发全拒。读得比要的少不会读错，拒掉只多一个来回。
        """
        if isinstance(value, int) and not isinstance(value, bool) and value > PROJECT_READ_MAX_CHARS:
            return PROJECT_READ_MAX_CHARS
        return value


class SearchArguments(RevisionArguments):
    query: str = Field(min_length=1, max_length=200)
    cursor: int = Field(default=0, ge=0)
    limit: int = Field(default=8, ge=1, le=8)
    caseSensitive: bool = False


class WriteArguments(ToolArguments):
    # ⚠ 2026-09-30 隔离真机第 132 轮 sr-20260930001652-TXP71T9C42（团队任务应用，追问「截止日期、过期标红」）：同一批两发
    #   project_verify 都把 110 位的 approvalRef 抄错（plan-4a391c… 应为 plan-4a772c…），回执给了原样那串，
    #   模型没再试，这一轮没验就收尾。全库 9 次 project_plan_approval_required，6 次是抄错。系统提示里
    #   写着「不要自己传 approvalRef」，这里却必填——同一件事两句话打架。核写工具早就不让模型填
    #   （project_tools.execute 头注「会话里已批准的计划就是闸」）。不传：服务端绑定当前已批准的那一版
    #   （没批准照旧拒）；传了：照旧逐字核对，对不上照旧拒。闸一点没松。
    approvalRef: str | None = Field(default=None, min_length=1, max_length=240,
        description="Omit it: the server binds the currently approved plan. If sent, it must match exactly.")
    expectedRevision: str = Field(min_length=1, max_length=240)


class FileChange(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    content: str | None = Field(max_length=512 * 1024)
    expectedSha256: str | None = Field(pattern=r"^[0-9a-f]{64}$")


class PatchArguments(WriteArguments):
    changes: list[FileChange] = Field(min_length=1, max_length=64)


class StartArguments(WriteArguments):
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")
    port: int = Field(default=5173, ge=1024, le=65535)


class ExecArguments(WriteArguments):
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")
    command: Literal["check", "build", "test"]


class VerifyArguments(WriteArguments):
    runtimeOperationId: str = Field(min_length=1, max_length=240)
    idempotencyKey: str = Field(min_length=1, max_length=240, pattern=r"\S")


#: 等待类工具（project_status.waitSeconds / shell_wait.seconds）的上界。
#:
#: ⚠ 2026-09-16 真机（sr-20260916212612-6N7V2BZ6XS）量出来的。原值是 5，
#:   而真机上一条命令的实际耗时是：
#:
#:       npm run build 18.9s   npm run check 18.9s   npm test 19.0s
#:       project_status 结果回来普遍 18~24s
#:
#:   于是等一条 build 至少要 4 次 shell_wait，而**每一次的真实代价不是 5 秒，
#:   是 5 秒 + 一次模型往返**。同一趟真机里，`tool_result` 到下一个
#:   `tool_start` 的间隔稳定在 12~20 秒（服务端记账是 ms 级，那一段就是模型）。
#:
#:       等 18 秒的活  →  4 轮 × (5 + 15) ≈ 80 秒
#:
#:   整趟 1127 秒里，34 轮有 9 轮是纯轮询（project_status ×5、shell_wait ×4），
#:   全是这么烧掉的。
#:
#: ⚠ 调大它之所以是纯赚，靠的是那两个循环**提前返回**：操作进终态、或
#:   runtime 变 ready 就立刻 break（services/project_tools.py）。不该等的
#:   时候一秒都不会多等；只有真在等的时候才少跑几轮。
#:   **哪天把提前返回改成死等满，这个数字就不再安全了** ——
#:   `tests/test_waiting_costs_a_round_trip.py` 正面反面都钉着。
PROJECT_WAIT_MAX_SECONDS = 30.0

#: shell_exec / bash 前台默认堵住这次工具调用、等到命令进终态。
#:
#: 抄 grok-build `xai-grok-tools/.../bash/mod.rs`：
#:     const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
#:     const MAX_FOREGROUND_BLOCK: Duration = Duration::from_secs(300);
#: 前台是 `backend.run()` 真等；`is_background: true` 才立刻给 task_id。
#: 我们没有进程级 FG，就在这次工具调用里把 `_poll_operation` 等到终态。
#:
#: ⚠ 2026-09-18 真机（问「用户名密码是啥」那轮）：`shell_exec npm run build`
#:   一交就 `ok: true` + `status: queued`，模型把接单当成跑完，开口了；
#:   左栏还亮着进行中。grok 前台路径上模型根本看不到 queued。
SHELL_EXEC_FOREGROUND_BLOCK_SECONDS = 120.0
SHELL_EXEC_MAX_FOREGROUND_SECONDS = 300.0


class StatusArguments(ToolArguments):
    operationId: str | None = Field(default=None, min_length=1, max_length=240)
    waitSeconds: float = Field(default=2, ge=0, le=PROJECT_WAIT_MAX_SECONDS)
    operationCursor: str = Field(default="", max_length=240)


class OperationArguments(ToolArguments):
    operationId: str = Field(min_length=1, max_length=240)


class HistoryArguments(ToolArguments):
    cursor: str | None = Field(default=None, min_length=1, max_length=240)
    limit: int = Field(default=5, ge=1, le=5)


class RestoreArguments(WriteArguments):
    targetRevision: str = Field(min_length=1, max_length=240)
    idempotencyKey: str = Field(min_length=1, max_length=200, pattern=r"\S")


class KernelWriteArguments(ToolArguments):
    #: 日常整文件写。批准引用和当前版本由服务端从会话绑，模型不许自己填。
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=12 * 1024 * 1024)
    append: bool = False
    contentEncoding: str | None = Field(default=None, max_length=16)


class KernelStrReplaceArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    oldStr: str = Field(min_length=1, max_length=512 * 1024)
    newStr: str = Field(max_length=512 * 1024)
    replaceAll: bool = False


class FileReadArguments(ToolArguments):
    file: str = Field(min_length=1, max_length=240)
    start_line: int | None = Field(default=None, ge=0)
    end_line: int | None = Field(default=None, ge=0)
    sudo: bool = False


class FileWriteArguments(ToolArguments):
    file: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=12 * 1024 * 1024)
    append: bool = False
    leading_newline: bool = False
    trailing_newline: bool = False
    sudo: bool = False
    contentEncoding: str | None = Field(default=None, max_length=16)


class StrReplaceEdit(ToolArguments):
    old_str: str = Field(min_length=1, max_length=512 * 1024)
    new_str: str = Field(max_length=512 * 1024)
    replace_all: bool = False


class FileStrReplaceArguments(ToolArguments):
    """单处：old_str / new_str；同一个文件好几处不同的改：edits（依次套用，全成才落盘）。

    ⚠ 2026-09-30 隔离真机第 161 轮（员工手册 Word，追问「第 3 章后加一章远程办公规定」）：
      插一章之后后面四章要顺延编号、目录和交叉引用跟着改——模型连发 19 次 file_str_replace，
      每次只改一行（净改动 +2/−2 → +30/−23 一格一格往上爬），整个追问 11 分 50 秒。
      replace_all 只管「同一段字处处换」，不管「好几段不同的字」；grok / Claude 的 MultiEdit 有这把刀。
    """
    file: str = Field(min_length=1, max_length=240)
    old_str: str | None = Field(default=None, min_length=1, max_length=512 * 1024)
    new_str: str | None = Field(default=None, max_length=512 * 1024)
    replace_all: bool = False
    edits: list[StrReplaceEdit] | None = Field(default=None, min_length=1, max_length=50)
    sudo: bool = False

    @model_validator(mode="after")
    def _one_form(self):
        if (self.old_str is not None) == (self.edits is not None):
            raise ValueError("pass old_str/new_str for one change, or edits for several — not both, not neither")
        if self.old_str is not None and self.new_str is None:
            raise ValueError("new_str is required with old_str")
        return self


class FileFindContentArguments(ToolArguments):
    file: str = Field(min_length=1, max_length=240)
    regex: str = Field(min_length=1, max_length=200)
    sudo: bool = False


class FileFindNameArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    glob: str = Field(min_length=1, max_length=200)
    sudo: bool = False


#: 沙盒里的中文字体。shell_exec / bash 两处描述都从这里渲染（§四）。
#: ⚠ 2026-09-27 隔离真机第 74 轮 sr-20260927211536-5XX8MCNCKE（给小学生的垃圾分类 PPT，追问「每一页都配一张相关
#:   的图片」）：模型用 PIL 画了 5 张插图，字体载的是 DejaVuSans——不含中文，于是图里全写
#:   英文（REC / FOOD / PAPER + BOTTLE / WHICH BIN?），给中国小学生看。默认镜像其实装了
#:   Noto CJK（E2B 探针：`fc-list :lang=zh` 列出 Noto Serif/Sans CJK SC 等，共 38 个字体；
#:   WHYBUDDY_OFFICE_E2B_TEMPLATE 未设，办公工作区用的就是这个镜像）。它不知道，只好躲开中文。
#: ⚠ 第 75 轮 sr-20260927212952-0P836MAD1P（防溺水 PPT，同一句追问）：第一版只说「有 Noto CJK，fc-list 查，载其中一个」。
#:   模型照做了一半——PPT 文字字体改成 Noto Sans CJK SC、fc-match 也查到了文件，图里也改写
#:   中文了；可 PIL 那两行还是 truetype(DejaVuSans-Bold.ttf)，四张图的中文全是方块，比
#:   第 74 轮的英文还糟。说「载一个」不够，要给到能照抄的那一行：文件路径 + 调用。
#:   路径是 E2B 探针 `fc-list :lang=zh file` 的原样输出；同一探针在沙盒里用这一行画「中防溺水」
#:   出字形，DejaVuSans-Bold 画出来跟私用区码位（必是方块）逐字节相同。
SANDBOX_CJK_FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
SANDBOX_FONTS_NOTE = (
    "Chinese text drawn into an image (PIL etc.) needs a Chinese font: use "
    f"ImageFont.truetype('{SANDBOX_CJK_FONT}', size) (Noto Sans CJK; fc-list :lang=zh lists the others). "
    "DejaVu has no Chinese glyphs — Chinese drawn with it comes out as empty boxes. "
    # ⚠ 2026-09-28：第 32、36、39、72、80 轮都先敲了 rg，每次 command not found 再换 grep——
    #   回执事后会点名（_missing_program），可每回都白花一发。事先说清。
    "ripgrep (rg) is not installed; search with grep -rn. "
    # ⚠ 2026-09-28 第 81 轮：网页工程里 pip install playwright + 下载 Chromium 成功，下一条命令全没了。
    "In a web (Vite) project every command gets a fresh sandbox (source tree + npm ci) that is reclaimed "
    "when it ends — packages, browsers or files you install outside the source tree are gone for the next "
    "command, so install and use them in the same command. An office workspace keeps its sandbox. "
    # ⚠ 2026-09-28 第 81～83 轮（webapp-testing 点击测试）：pip install playwright + 下载 Chromium 都成功，
    #   Chromium 起不来——libnspr4.so 缺失。E2B 探针：uid 1000，libnspr4 / libnss3 都不在，apt-get 要 root，
    #   而平台拒 sudo（project_sudo_forbidden）。三轮各烧 15 分钟重新发现这件事。
    "A browser cannot run inside the sandbox: Playwright's Chromium needs system libraries (libnspr4, "
    "libnss3) that are not installed, and installing them needs root, which is refused. To check pages "
    "in a real browser, use project_verify (the managed independent browser) instead."
)


#: shell_exec / bash 一条命令的上限。
#: ⚠ 2026-09-27 隔离真机第 66 轮（应收账款 Excel）：多行放开之后模型把整个生成脚本写成
#:   一条 heredoc，超了这个数，被 project_tool_arguments_invalid 打回——45 秒生成白花。
#:   描述里当时还写着「newlines are rejected」（第 31 轮只改了校验、没改两处描述，§四），
#:   上限一个字没提。描述从这个常量渲染，改数不改话对不上。
#: ⚠ 第 68 轮（门店销售 Excel 追问透视表）描述写上了上限，模型的核对脚本照样超——
#:   它写的就是这么长。2000 没有标定过（第一版内核带进来的）。真正的约束在 PTY：
#:   tty 规范模式一行最多 4095 字节；但 _console_boot 等提示符出来才敲，此时 readline
#:   把终端切成原始模式，不受这个限。实测（本地 bash -i + 真 PTY，同一行 _CONSOLE_SETUP，
#:   pty_line + typing_chunks 原样敲）：1388 / 6209 / 10109 字的 heredoc（UTF-8 1.9 / 8.5 /
#:   13.7 KB）三条都跑完、exit 0。E2B 真沙盒（E2BWorkspaceProvider.start_console 原样）
#:   6716 / 8556 字两条同形状 heredoc 都跑完、exit 0，打字加运行各 4.6 s。
#:   取 8000，跟 file_read 一次的窗口同量级。
SHELL_COMMAND_MAX_CHARS = 8000
#: 一条命令**收**多长。超过 SHELL_COMMAND_MAX_CHARS 的不往 PTY 里敲：宿主先把原文存成沙盒里的临时脚本
#: （工作区外，E2BWorkspaceProvider._staged_command），PTY 只敲 `bash 那个文件`，跑法一样。
#: ⚠ 2026-10-02 隔离真机第 183 轮 sr-20261002042304-7451W4YMC3（事故复盘 Word）：模型把整份生成脚本写成一条
#:   heredoc（3981 个输出 token，那一发 374 秒），超 8000 被 project_tool_arguments_invalid 打回，然后原样
#:   改成 file_write 再写一遍——一轮白生成。第 131/151/155/174/175 轮同一个形状（描述里早就写着上限，模型照样写这么长）。
#:   8000 量的是「敲进 PTY」这一层（见上），不是沙盒能跑多长；存文件再跑就没有这一层。64000 跟 file_write
#:   单文件同量级，再长的照旧拒（参数错误回执带字段和上限）。
SHELL_SCRIPT_MAX_CHARS = 64_000


class ShellExecArguments(ToolArguments):
    command: str = Field(min_length=1, max_length=SHELL_SCRIPT_MAX_CHARS)
    id: str | None = Field(default=None, min_length=1, max_length=240)
    exec_dir: str | None = Field(default=None, max_length=240)
    sudo: bool = False
    #: 抄 grok bash `is_background`：true 立刻交回 running，不是命令成功。
    is_background: bool = False
    #: 前台最多等几秒。不传就用 SHELL_EXEC_FOREGROUND_BLOCK_SECONDS。
    timeout: float | None = Field(default=None, ge=0, le=SHELL_EXEC_MAX_FOREGROUND_SECONDS)


class ShellSessionArguments(ToolArguments):
    id: str | None = Field(default=None, min_length=1, max_length=240)
    seconds: float | None = Field(default=None, ge=0, le=PROJECT_WAIT_MAX_SECONDS)
    sudo: bool = False


class ShellWriteArguments(ToolArguments):
    id: str = Field(min_length=1, max_length=240)
    input: str = Field(max_length=8 * 1024)
    press_enter: bool = True
    sudo: bool = False


class BrowserNavigateArguments(ToolArguments):
    url: str = Field(min_length=1, max_length=2000)
    sudo: bool = False


class BrowserEmptyArguments(ToolArguments):
    sudo: bool = False


class BrowserClickArguments(ToolArguments):
    index: int | None = Field(default=None, ge=0)
    coordinate_x: float | None = None
    coordinate_y: float | None = None
    sudo: bool = False


class BrowserInputArguments(ToolArguments):
    index: int | None = Field(default=None, ge=0)
    text: str = Field(max_length=8 * 1024)
    press_enter: bool = False
    sudo: bool = False


class BrowserMouseArguments(ToolArguments):
    coordinate_x: float
    coordinate_y: float
    sudo: bool = False


class BrowserKeyArguments(ToolArguments):
    key: str = Field(min_length=1, max_length=80)
    sudo: bool = False


class BrowserSelectArguments(ToolArguments):
    index: int | None = Field(default=None, ge=0)
    option: str = Field(min_length=1, max_length=240)
    sudo: bool = False


class BrowserScrollArguments(ToolArguments):
    to_top: bool = False
    to_bottom: bool = False
    sudo: bool = False


class BrowserConsoleArguments(ToolArguments):
    javascript: str = Field(min_length=1, max_length=8 * 1024)
    sudo: bool = False


class DeployPortArguments(ToolArguments):
    port: int = Field(default=5173, ge=1024, le=65535)
    sudo: bool = False


class DeployApplyArguments(ToolArguments):
    type: str = Field(default="preview", min_length=1, max_length=80)
    sudo: bool = False


class MakePageArguments(ToolArguments):
    file: str | None = Field(default=None, min_length=1, max_length=240)
    title: str | None = Field(default=None, max_length=240)
    sudo: bool = False


class GithubReadArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    offset: int | None = Field(default=None, ge=0)
    limit: int | None = Field(default=None, ge=1)
    sudo: bool = False

    @model_validator(mode="before")
    @classmethod
    def _twin_spelling(cls, data):
        """read_file 也收孪生工具 file_read 的写法（file / start_line / end_line）。

        ⚠ 2026-09-28 隔离真机第 94 轮 sr-20260928081512-PXESY6QGRA（单词卡片网页，追问「配色换蓝、圆角 12px」）：
          `read_file {"file": "src/style.css", "start_line": 0, "end_line": 40}` →
          project_tool_arguments_invalid。两件读工具同一个存储、描述里写着「Same store as file_read」，
          参数名却一套 path/offset/limit、一套 file/start_line/end_line；全库这是最常见的参数错（5 次）。
          意思没有歧义（start_line 就是 offset，end_line 是不含的终点），不值一个来回。
          两套名字同时出现照旧拒——那是真矛盾，不猜。
        """
        if not isinstance(data, dict) or not ({"file", "start_line", "end_line"} & data.keys()):
            return data
        if ("file" in data and "path" in data) or ({"start_line", "end_line"} & data.keys() and {"offset", "limit"} & data.keys()):
            return data
        out = dict(data)
        if "file" in out:
            out["path"] = out.pop("file")
        start, end = out.pop("start_line", None), out.pop("end_line", None)
        if start is not None:
            out["offset"] = start
        if end is not None:
            out["limit"] = end - (start or 0) if isinstance(end, int) and isinstance(start or 0, int) else end
        return out


class GithubWriteArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=12 * 1024 * 1024)
    sudo: bool = False
    contentEncoding: str | None = Field(default=None, max_length=16)


class GithubReplaceArguments(ToolArguments):
    path: str = Field(min_length=1, max_length=240)
    old_string: str = Field(min_length=1, max_length=512 * 1024)
    new_string: str = Field(max_length=512 * 1024)
    replace_all: bool = False
    sudo: bool = False


class GithubBashArguments(ToolArguments):
    command: str = Field(min_length=1, max_length=SHELL_SCRIPT_MAX_CHARS)
    sudo: bool = False
    is_background: bool = False
    timeout: float | None = Field(default=None, ge=0, le=SHELL_EXEC_MAX_FOREGROUND_SECONDS)


class GithubGrepArguments(ToolArguments):
    pattern: str = Field(min_length=1, max_length=200)
    path: str | None = Field(default=None, max_length=240)
    glob: str | None = Field(default=None, max_length=200)
    sudo: bool = False


class GithubListDirArguments(ToolArguments):
    path: str = Field(default=".", min_length=1, max_length=240)
    sudo: bool = False


class GithubGlobArguments(ToolArguments):
    pattern: str = Field(min_length=1, max_length=200)
    path: str | None = Field(default=None, max_length=240)
    sudo: bool = False


#: 抄 grok-build bash：沙箱里跑模型给的那一行，宿主闸只挡 sudo / 控制字符。
#: `project_exec` 仍然只吃 check/build/test；shell_exec / bash 走这条。
_SHELL_SUDO = re.compile(r"(^|[\s;&|`$])(sudo|doas)([\s=]|$)")


def sandbox_shell_script(command: str) -> str:
    """Return one PTY-safe sandbox line, or fail closed.

    ⚠ 2026-09-17：第一版把自由 curl 直接拒掉。用户要的是 grok 那台
    沙箱机，不是再发明一份 npm script 白名单。E2B 是边界；sudo 仍拒。
    start_console 敲不了换行，多行命令在那一层包成一行（pty_line），这里不挡。
    """
    if not isinstance(command, str):
        raise ValueError("project_shell_command_not_allowed")
    text = command.strip()
    # ⚠ 2026-09-28 隔离真机第 78、82 轮：上限从 2000 提到 SHELL_COMMAND_MAX_CHARS 时只改了参数
    #   Field，这里还写死 2000——2000～8000 字的命令过了校验、在这里被 not_allowed 打回，回执
    #   没有一个字说是太长（第 82 轮：装 Playwright && 起服务 && 跑点击脚本，被拒后放弃）。
    #   当时的两条判据一条只校验 Field、一条直接往 PTY 里敲，都没走这个函数（本仓 §一之二）。
    if not text or len(text) > SHELL_SCRIPT_MAX_CHARS:
        raise ValueError("project_shell_command_not_allowed")
    if "\x00" in text:
        raise ValueError("project_shell_command_not_allowed")
    # 多行（heredoc）放行。⚠ 2026-09-25 E1Y12175TS 起这里拒多行、回执教模型改写；
    #   2026-09-27 第 31 轮真机模型被拒后干脆不核对了，收尾照样说「已检查」。
    #   换行只是 PTY 打字的限制，由 e2b_workspace_provider.pty_line 在那一层处理。
    if _SHELL_SUDO.search(text.lower()) or text.lower().startswith("sudo"):
        raise ValueError("project_sudo_forbidden")
    return text


def classify_shell_command(command: str) -> tuple[str, str | None]:
    """Map a model command to (`check`/`build`/`test`, None) or (`shell`, script)."""
    text = sandbox_shell_script(command)
    lowered = " ".join(text.split()).lower()
    for name in ("check", "build", "test"):
        if lowered == name or lowered.endswith(" " + name) or f"run {name}" in lowered:
            return name, None
    return "shell", text


def leaked_shell_command(command: str) -> str:
    """Managed check/build/test only. project_exec still uses this closed set."""
    name, script = classify_shell_command(command)
    if script is not None:
        raise ValueError("project_shell_command_not_allowed")
    return name


SANDBOX_WORKSPACE = "/home/user/workspace"
# 模型可能用的几种「工作区根」写法。长的在前，前缀匹配才不会被短的截走。
_WORKSPACE_ROOTS = ("/home/user/workspace", "~/workspace", "/home/ubuntu", "home/ubuntu",
    "/workspace", "workspace")


def shell_exec_subdir(exec_dir: str | None) -> str | None:
    """exec_dir → 工作区内的相对子目录（"" 是根）；出了工作区返回 None。

    ⚠ 2026-09-25 隔离真机 sr-20260925053053-T4TJXXCW0Z：shell_exec 的描述写着
      「runs … in /home/user/workspace」，模型照着传 exec_dir=/home/user/workspace，
      被 project_shell_exec_dir_not_supported 拒掉——白名单只有 /home/ubuntu、
      workspace 几种别名，偏偏没有沙盒真实的那个根。
    抄 grok-build `resolve_path_within_root`：相对路径拼到根上，绝对路径照收，
    `..` 规整后只要还在根里就放行，越出去才拒。
    """
    raw = str(exec_dir or "").strip().replace("\\", "/")
    if raw in {"", "."}:
        return ""
    for root in _WORKSPACE_ROOTS:
        if raw == root or raw.startswith(root + "/"):
            raw = raw[len(root):].lstrip("/")
            break
    else:
        if raw.startswith(("/", "~")):
            return None
    rel = posixpath.normpath(raw) if raw else "."
    if rel == ".":
        return ""
    if rel == ".." or rel.startswith("../") or rel.startswith("/"):
        return None
    return rel


def leaked_browser_url_allowed(url: str) -> bool:
    raw = str(url or "").strip()
    if not raw or raw[0] in "./" or "://" not in raw:
        return True
    lower = raw.lower()
    if lower.startswith(("http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1")):
        return True
    return ".e2b." in lower or "preview." in lower


LEAKED_KERNEL_TOOLS = frozenset({
    "message_notify_user", "message_ask_user",
    "file_read", "file_write", "file_str_replace", "file_find_in_content", "file_find_by_name",
    "shell_exec", "shell_view", "shell_wait", "shell_write_to_process", "shell_kill_process",
    "browser_view", "browser_navigate", "browser_restart",
    "browser_click", "browser_input", "browser_move_mouse", "browser_press_key",
    "browser_select_option", "browser_scroll_up", "browser_scroll_down",
    "browser_console_exec", "browser_console_view",
    "info_search_web",
    "deploy_expose_port", "deploy_apply_deployment",
    "make_manus_page",
    "idle",
})
assert len(LEAKED_KERNEL_TOOLS) == 29

GITHUB_KERNEL_TOOLS = frozenset({
    "read_file", "write_file", "search_replace", "bash", "grep", "list_dir", "glob",
})
assert len(GITHUB_KERNEL_TOOLS) == 7

#: 2026-09-17：点击 / stdin / 沙箱 bash 接到现有 E2B+Playwright 核。
#: 公开 CDN 仍然没有——deploy_apply 只许亮私有预览，不许 deployed=true。
LEAKED_UNAVAILABLE: dict[str, str] = {}

BROWSER_INTERACT_TOOLS = frozenset({
    "browser_click", "browser_input", "browser_move_mouse", "browser_press_key",
    "browser_select_option", "browser_scroll_up", "browser_scroll_down",
    "browser_console_exec",
})


def compile_browser_action(name: str, parsed) -> dict:
    """Closed Playwright/OpenHands action. Model JS is only `evaluate`.

    抄 OpenHands BrowserToolExecutor + Playwright public API 的形状：
    typed op in，observation out。不把模型源码当 runner。
    """
    if getattr(parsed, "sudo", False):
        raise ValueError("project_sudo_forbidden")
    if name == "browser_click":
        action: dict = {"op": "click"}
        if parsed.index is not None:
            action["index"] = parsed.index
        if parsed.coordinate_x is not None and parsed.coordinate_y is not None:
            action["x"] = parsed.coordinate_x
            action["y"] = parsed.coordinate_y
        if "index" not in action and "x" not in action:
            raise ValueError("project_browser_action_invalid")
        return action
    if name == "browser_input":
        action = {"op": "type", "text": parsed.text, "pressEnter": parsed.press_enter}
        if parsed.index is not None:
            action["index"] = parsed.index
        return action
    if name == "browser_move_mouse":
        return {"op": "move", "x": parsed.coordinate_x, "y": parsed.coordinate_y}
    if name == "browser_press_key":
        return {"op": "key", "key": parsed.key}
    if name == "browser_select_option":
        action = {"op": "select", "option": parsed.option}
        if parsed.index is not None:
            action["index"] = parsed.index
        return action
    if name == "browser_scroll_up":
        return {"op": "scroll", "direction": "up", "toEnd": parsed.to_top}
    if name == "browser_scroll_down":
        return {"op": "scroll", "direction": "down", "toEnd": parsed.to_bottom}
    if name == "browser_console_exec":
        return {"op": "evaluate", "javascript": parsed.javascript}
    raise ValueError("project_browser_action_invalid")


class LogsArguments(OperationArguments):
    afterSeq: int = Field(default=0, ge=0)
    offset: int = Field(default=0, ge=0)


PROJECT_ARGUMENTS = {
    "project_create": CreateArguments,
    "project_list": ListArguments,
    "project_read": ReadArguments,
    "project_search": SearchArguments,
    "project_revisions": HistoryArguments,
    "project_restore": RestoreArguments,
    "project_export": RevisionArguments,
    "project_patch": PatchArguments,
    "project_write": KernelWriteArguments,
    "project_str_replace": KernelStrReplaceArguments,
    "file_read": FileReadArguments,
    "file_write": FileWriteArguments,
    "file_str_replace": FileStrReplaceArguments,
    "file_find_in_content": FileFindContentArguments,
    "file_find_by_name": FileFindNameArguments,
    "shell_exec": ShellExecArguments,
    "shell_view": ShellSessionArguments,
    "shell_wait": ShellSessionArguments,
    "shell_write_to_process": ShellWriteArguments,
    "shell_kill_process": ShellSessionArguments,
    "browser_view": BrowserEmptyArguments,
    "browser_navigate": BrowserNavigateArguments,
    "browser_restart": BrowserEmptyArguments,
    "browser_click": BrowserClickArguments,
    "browser_input": BrowserInputArguments,
    "browser_move_mouse": BrowserMouseArguments,
    "browser_press_key": BrowserKeyArguments,
    "browser_select_option": BrowserSelectArguments,
    "browser_scroll_up": BrowserScrollArguments,
    "browser_scroll_down": BrowserScrollArguments,
    "browser_console_exec": BrowserConsoleArguments,
    "browser_console_view": BrowserEmptyArguments,
    "deploy_expose_port": DeployPortArguments,
    "deploy_apply_deployment": DeployApplyArguments,
    "make_manus_page": MakePageArguments,
    "read_file": GithubReadArguments,
    "write_file": GithubWriteArguments,
    "search_replace": GithubReplaceArguments,
    "bash": GithubBashArguments,
    "grep": GithubGrepArguments,
    "list_dir": GithubListDirArguments,
    "glob": GithubGlobArguments,
    "project_start": StartArguments,
    "project_exec": ExecArguments,
    "project_verify": VerifyArguments,
    "project_verification": OperationArguments,
    "project_status": StatusArguments,
    "project_logs": LogsArguments,
    "project_cancel": OperationArguments,
}
PROJECT_TOOL_NAMES = frozenset(PROJECT_ARGUMENTS)
PROJECT_WRITE_TOOLS = frozenset({
    "project_create", "project_patch", "project_write", "project_str_replace",
    "file_write", "file_str_replace", "write_file", "search_replace",
    "shell_exec", "bash", "deploy_expose_port", "deploy_apply_deployment",
    "browser_navigate", "browser_restart",
    "project_start", "project_exec", "project_verify", "project_restore",
})
PROJECT_KERNEL_WRITE_TOOLS = frozenset({
    "project_write", "project_str_replace", "file_write", "file_str_replace",
    "write_file", "search_replace",
    "shell_exec", "bash", "deploy_expose_port", "deploy_apply_deployment",
    "browser_navigate", "browser_restart",
})
PROJECT_ALIAS_TOOLS = frozenset({
    "project_write", "project_str_replace",
})

_DESCRIPTIONS = {
    "project_create": "Create or recover this session's computer (an E2B sandbox workspace) for the current approved plan. For a web-app plan it is a React/TypeScript/Vite project. For an office-file plan (a file for the user: .pptx/.docx/.xlsx, .md/.txt/.csv/.json/.mmd/.yaml/.yml text, or .png/.jpg/.jpeg/.gif/.webp images such as a rendered chart) it is an empty workspace: run commands there (bash/shell_exec, e.g. python-pptx / python-docx / openpyxl) or file_write text. Every .pptx/.docx/.xlsx you write is collected as the deliverable, and so is every .md/.txt/.csv/.json/.mmd/.yaml/.yml text or .png/.jpg/.jpeg/.gif/.webp image under output/ (only there: README/INSTRUCT/LOG files and images elsewhere are working files) — this is the office-file tool. Only those formats reach the user: a PDF or any other file you write stays in the sandbox and cannot be delivered, so say so up front instead of producing one. templateId=react-vite is the default for every web page or web app, including apps that keep their data in the browser (localStorage). templateId=react-vite-tasks is a fixed task-list app (login, SQLite server, writer/reader roles) whose delivery is locked to a task-list acceptance suite (create/edit/filter tasks with roles): pick it only when the approved plan is exactly that task-management app — any other app built on it can never be delivered. Office files (.pptx/.docx/.xlsx) are not a task app — do not pick react-vite-tasks for those. Existing projects retain their source. Returns saved revision, not delivery.",
    "project_list": "List source files with SHA256 and revision. Collected deliverables (.pptx/.docx/.xlsx, and .md/.txt/.csv handed over in an office-file plan) are officeFiles on this result, not in files. That list is the deliverable; do not copy it into the source tree. Continue with nextCursor while truncated.",
    "project_read": "Read a saved source file. Default (no offset/limit) returns path, sha256, size and a short excerpt — not the full text. Ask for a window with offset/limit (max {max_read_chars} characters) when you need the body; search with project_search. Use returned SHA256 for patch preconditions. Only when truncated is true, continue with nextOffset and the same revision.",
    "project_search": "Search saved source for literal text, with bounded line excerpts. Use nextCursor and the same revision to continue; this is not regex or shell execution.",
    "project_revisions": "List committed source history for this project, newest first. Continue with nextCursor. History never includes losing or uncommitted source writes.",
    "project_restore": "Restore a committed historical source tree as a new revision under the current approved plan. Does not rewind history, copy old verification, or restore business data. Live source-only changes queue runtime.patch; dependency/startup changes require stopping and confirmed cleanup first. Poll operationId before declaring completion.",
    "project_export": "Return the authorized download path for an immutable source ZIP and hash manifest. Application data, environment secrets and preview credentials are separate. Downloading source is not deployment or verified delivery.",
    "project_patch": "Apply exact file replacements/deletions to this session project using expectedRevision and per-file expectedSha256 (null only for new files). A ready runtime queues source/assets to its existing worker and returns operationId: poll project_status until completed with synchronized=true before using the returned new revision. Dependencies/startup configuration require a stopped, reconciled runtime. Submission is not completion; old verification is not proof for new source. Prefer file_write or file_str_replace for an ordinary single-file edit.",
    "project_write": "Alias of file_write with path/content. Prefer file_write.",
    "project_str_replace": "Alias of file_str_replace with path/oldStr/newStr (replaceAll for every occurrence). Prefer file_str_replace.",
    "file_read": "Read one saved source file. file is a project-relative path (absolute sandbox prefixes are stripped). Default (no start_line/end_line) returns path, sha256, size and a short excerpt — not the full text. Pass start_line/end_line (0-based, exclusive end) for a window. sudo=true is rejected. Do not send approvalRef or hashes.",
    "file_write": "Overwrite or append one saved source file. Pass file, content, and optional append/leading_newline/trailing_newline. sudo=true is rejected. Do not send approvalRef, revision, or SHA256 — the server binds the current approved plan. Prefer file_str_replace for a unique in-file edit. Multi-file CAS or deletion still uses project_patch. Office files (.pptx/.docx/.xlsx) are not text source: write them with contentEncoding=base64 (ZIP bytes) or generate them in bash so the host can collect them. A UTF-8 string at an office path is rejected. A text deliverable (.md/.txt/.csv) is plain UTF-8: file_write it under output/ in an office-file plan.",
    "file_str_replace": "Replace one unique old_str with new_str in a saved source file. old_str must occur exactly once; if it occurs several times the call fails and says on which lines — add surrounding text so it matches once, or pass replace_all=true to change every occurrence (e.g. one colour used in many rules). Several different changes in the same file (renumbering chapters, renaming a function and its callers): send edits=[{old_str, new_str, replace_all?}, ...] instead of old_str/new_str — applied in order to the same file, each later edit sees the earlier ones, all-or-nothing, one revision. sudo=true is rejected. Do not send approvalRef, revision, or hashes.",
    "file_find_in_content": "Search one saved source file with a regular expression. Returns bounded line excerpts. sudo=true is rejected. This is not shell execution.",
    "file_find_by_name": "Find saved source paths under path whose name or relative path matches glob. path may be a directory prefix or '.' for the whole tree.",
    "shell_exec": "Run one command in this project's E2B sandbox. Foreground (default) blocks this tool until the command exits or about {fg_block_secs}s, then returns commandFinished and exitCode; ok only means the command was accepted. is_background=true returns immediately with status running and commandFinished=false — that is not completion; do not claim the command finished. check/build/test (or npm/pnpm run those) stay on the managed installer. Any other command runs as grok-build bash in /home/user/workspace; multi-line commands and heredocs are fine. A command up to {command_max} characters is typed into the terminal as is; a longer one (up to {script_max}) is saved to a temporary script outside the project and run with bash — same result. For a script you will rerun or edit, file_write it into the project first. An office workspace (no package.json) keeps that same sandbox for the next command, so packages you installed stay. Project source files (what file_write/file_str_replace save) are re-written from the saved source before every command, so editing them inside the sandbox (python/sed) does not stick — change sources with file_str_replace/file_write. {sandbox_fonts} .pptx/.docx/.xlsx written in the workspace (and, in an office-file plan, .md/.txt/.csv under output/) come back on this receipt as officeFiles — that is the deliverable; do not base64 them into logs or file_write. officeDownloads maps each file to the link to give the user; never give a sandbox path. sudo is rejected. Optional id is the idempotency key. Optional timeout is foreground seconds (max 300). Poll a backgrounded command with shell_wait / shell_view.",
    "shell_view": "Show the current screen of a project command: its status plus the last part of its output (the tail, like a terminal). A finished command returns the same receipt as shell_wait. To page through the output from the start, use project_logs. id is the operationId from shell_exec; omit it to read the latest operation.",
    "shell_wait": "Wait up to seconds (max 30) for a queued project command. It returns the moment the command finishes, so one generous wait beats several short polls. id is the operationId; omit it to wait on the latest operation.",
    "shell_write_to_process": "Type into the live bash PTY of a queued project command. id is the operationId from shell_exec. press_enter defaults true. The worker delivers bytes on the next poll; a finished operation is rejected.",
    "shell_kill_process": "Cancel a queued or running project operation. id is the operationId; omit it to cancel the latest active one.",
    "browser_view": "Read the current private preview and last trusted verification snapshot. This is not a live DOM dump.",
    "browser_navigate": "Open the session's private preview. url must be a relative path or this project's preview origin; arbitrary external sites are rejected. This starts the managed runtime when needed.",
    "browser_restart": "Cancel the current runtime and queue a fresh managed start.",
    "browser_click": "Click an interactive element (index from browser_view) or coordinates on the private preview. External sites are rejected. Needs a ready preview.",
    "browser_input": "Type into the focused or indexed field on the private preview. press_enter sends Enter after the text.",
    "browser_move_mouse": "Move the pointer on the private preview.",
    "browser_press_key": "Press one key on the private preview.",
    "browser_select_option": "Choose an option in a select on the private preview.",
    "browser_scroll_up": "Scroll the private preview up. to_top jumps to the start.",
    "browser_scroll_down": "Scroll the private preview down. to_bottom jumps to the end.",
    "browser_console_exec": "Evaluate JavaScript in the private preview page. This is not project_verify and not delivery evidence.",
    "browser_console_view": "Read the latest managed command log, which is the closest console this workspace exposes.",
    "deploy_expose_port": "Start the managed private preview on port, or reuse this project's dev server if one is already running or queued (runtimeReused). This is not a public deployment.",
    "deploy_apply_deployment": "Start the private preview (same kernel as deploy_expose_port). This is not a public CDN. deployed is always false; previewPrivate is true.",
    "make_manus_page": "Switch the preview to one existing file. file may be a source .html, or a collected deliverable — .pptx/.docx/.xlsx or .md/.txt/.csv (the officeFiles path). A missing path fails. In an office workspace, omitting file shows the newest collected office file; in a web project it shows the project page. This does not start Vite.",
    "read_file": "Read one saved source file. path is project-relative. Default (no offset/limit) returns path and a short excerpt, not the full text. Optional offset/limit are 0-based line counts for a window. Same store as file_read. sudo=true is rejected.",
    "write_file": "Overwrite one saved source file with path and content. Do not send approvalRef or hashes. Same store as file_write. sudo=true is rejected.",
    "search_replace": "Replace one unique old_string with new_string in a saved source file. Zero matches fail closed; several matches fail and say on which lines unless replace_all=true, which changes every occurrence. Same store as file_str_replace.",
    "bash": "Run one command in this project's E2B sandbox. Same worker and foreground/background contract as shell_exec: default waits until exit or about {fg_block_secs}s and returns commandFinished plus a short excerpt; full stdout stays in operation logs (project_logs / shell_view). Multi-line commands and heredocs are fine; a command up to {command_max} characters is typed as is; a longer one (up to {script_max}) is saved to a temporary script outside the project and run with bash. For a script you will rerun or edit, file_write it into the project first. An office workspace keeps the same sandbox across commands (installed packages stay). Project source files (what file_write/file_str_replace save) are re-written from the saved source before every command, so editing them inside the sandbox (python/sed) does not stick — change sources with file_str_replace/file_write. {sandbox_fonts} .pptx/.docx/.xlsx written in the workspace are listed on this receipt as officeFiles; that path is the deliverable — do not base64 the file into logs or file_write. officeDownloads maps each file to the link to give the user; never give a sandbox path. is_background=true returns running, not completion. sudo is rejected.",
    "grep": "Search saved source with a regular expression across the tree. Optional path is a file or directory prefix; optional glob limits names. This is not shell execution.",
    "list_dir": "List saved source paths under path. path may be '.' for the whole tree.",
    "glob": "Find saved source paths whose name or relative path matches pattern. Optional path limits the directory prefix.",
    "project_start": "Queue managed installation and Vite startup for an exact approved source revision. Use one idempotencyKey per intended operation, then inspect status/logs. Ready is not verified delivery; private browser preview may remain unavailable. A project has one dev server: if one is already running or queued, that one is returned (runtimeReused) instead of queuing another. Prefer deploy_expose_port.",
    "project_exec": "Queue one fixed project command (check, build or test) in E2B for the approved source revision. Reuse idempotencyKey on retries. Poll status/logs for actual results. A command passing is not browser or business verification. Prefer shell_exec.",
    "project_status": "Without operationId, discover this session's saved operations and current revision; continue with nextOperationCursor while hasMoreOperations. With operationId, read durable status and optionally wait up to waitSeconds (max 30; it returns as soon as the operation settles, so asking for the full budget costs nothing). A status is not business acceptance. Prefer shell_wait.",
    "project_logs": "Read bounded durable command output. Continue using returned nextSeq and nextOffset until hasMore is false. Full logs remain available through the authorized operation HTTP endpoint. Prefer shell_view.",
    "project_cancel": "Request cancellation of this session project's operation. Cancelling is intent; wait for a terminal status to confirm remote cleanup. Approval is not needed to stop owned work. Prefer shell_kill_process.",
    "project_verify": "Queue a locked-dependency build and the trusted browser suite for this exact approved revision. The task template checks real API creation/edit/filter/refresh and independent writer/reader access; any other web app is checked for visible rendered content, content still there after a reload, and no page errors or failed requests. The runtime owner temporarily serves built output, isolates verification data, then restores development. An identical retry returns the same operation. A key already used for a different request still queues this check and returns its operationId; that is not a failed acceptance. Read project_verification. Missing capabilities are blocked; passing covers only the declared suite.",
    "project_verification": "Read trusted browser assertions and artifact references for this session's verification operation. Source or approval changes make old evidence stale. Use real failed assertions to guide source fixes, then request a new verification. For build failures, read project_logs with logOperationId (the runtime owner), not the verification child ID. Never treat queued/completed alone as passed or a template suite as business acceptance.",
}


def interpolate_description(description: str) -> str:
    """把真实上限填进工具描述里。

    抄 grok `TruncationConfig::interpolate_description`：

        .replace("{max_lines_read}", &self.max_lines_read().to_string())

    grok 这么做的理由就是本仓 §4：描述里写死一个数字，改了常量不改描述，
    模型读到的还是旧的——不报错，只是它按一个不存在的窗口去分页。
    从常量渲染出来，两边不可能对不上。
    """
    return (
        description
        .replace("{max_read_chars}", str(PROJECT_READ_MAX_CHARS))
        .replace("{fg_block_secs}", str(int(SHELL_EXEC_FOREGROUND_BLOCK_SECONDS)))
        .replace("{command_max}", str(SHELL_COMMAND_MAX_CHARS))
        .replace("{script_max}", str(SHELL_SCRIPT_MAX_CHARS))
        .replace("{sandbox_fonts}", SANDBOX_FONTS_NOTE)
    )


def project_tool_definitions() -> list[dict]:
    return [{"type": "function", "function": {
        "name": name, "description": interpolate_description(_DESCRIPTIONS[name]),
        "parameters": model.model_json_schema(),
    }} for name, model in PROJECT_ARGUMENTS.items()]


PROJECT_TOOLS = project_tool_definitions()
