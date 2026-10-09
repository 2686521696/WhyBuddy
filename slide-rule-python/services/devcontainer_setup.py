"""工程自己声明的「新电脑开好后先跑什么」：读 devcontainer.json 的生命周期命令。

⚠ 2026-10-09 线上 Django 借阅登记 sr-20261009072201-D28Z7A4YAG：一个工程一台电脑，电脑活着时装过的都在；
  闲置太久被回收后，预览面板「叫醒」开到新电脑上，平台只记得**怎么启动**（上次的启动命令
  `python3 manage.py migrate && runserver`），不记得**启动前要装什么**——`ImportError: Couldn't import Django`，
  面板每 30 秒再叫一次，几分钟里开了 13 台新电脑，台台失败。

  这不是 Django 的事（Go / Rails / Spring 一样），是生命周期少了「新电脑开机」这一步。不替模型猜怎么装依赖
  （那是 ×N 的适配），照 Codespaces 的标准：工程里的 `.devcontainer/devcontainer.json` 声明 onCreateCommand /
  updateContentCommand / postCreateCommand，平台只管「什么时候跑」——每次给这个工程开新电脑时，按规范的顺序
  先跑它们，再跑命令或启动服务器。依赖怎么装由模型写进工程，跟着源码走，换了电脑也不丢。

规范（containers.dev/implementors/json_reference）：命令可以是字符串（交给 shell）、数组（不经 shell 的一条命令）、
或对象（具名的几条，规范里是并行；这里按名字顺序串行跑，在一台电脑的一个终端里更好读、失败也看得清是哪条）。
文件是 JSONC：允许注释和尾逗号。

本模块是叶子：只解析，不碰沙盒。
"""

from __future__ import annotations

import json
import re
import shlex

#: 规范认的两个位置，前者优先。
DEVCONTAINER_PATHS = (".devcontainer/devcontainer.json", ".devcontainer.json")
#: 规范里「容器建好后」的三步，按这个顺序跑。postStart / postAttach 是每次启动 / 连上时跑，不在「新电脑」这一步。
LIFECYCLE_KEYS = ("onCreateCommand", "updateContentCommand", "postCreateCommand")

_JSONC_TOKENS = re.compile(r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*.*?\*/', re.S)
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")


def parse_jsonc(text: str) -> object:
    """JSON 加注释、尾逗号（devcontainer.json 的写法）。字符串里的 // 不当注释。"""
    stripped = _JSONC_TOKENS.sub(lambda m: m.group(0) if m.group(0).startswith('"') else "", text)
    previous = None
    while previous != stripped:                       # 尾逗号后面可能紧跟着另一个尾逗号的收尾
        previous, stripped = stripped, _TRAILING_COMMA.sub(r"\1", stripped)
    return json.loads(stripped)


def _one(value: object) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list) and value and all(isinstance(part, str) for part in value):
        return [shlex.join(value)]
    if isinstance(value, dict):
        return [line for name in sorted(value) for line in _one(value[name])]
    return []


def setup_command(files: dict[str, object]) -> tuple[str | None, str | None]:
    """(要跑的那一行, 从哪个文件读的)。没有声明返回 (None, None)；文件坏了返回 (None, 路径) 让调用方照实说。"""
    for path in DEVCONTAINER_PATHS:
        text = files.get(path)
        if not isinstance(text, str):
            continue
        try:
            config = parse_jsonc(text)
        except ValueError:
            return None, path
        if not isinstance(config, dict):
            return None, path
        lines = [line for key in LIFECYCLE_KEYS for line in _one(config.get(key))]
        return (" && ".join(f"({line})" if len(lines) > 1 else line for line in lines) or None), path
    return None, None
