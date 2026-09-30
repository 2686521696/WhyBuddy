"""源码版本按「哪一句用户的话之后改出来的」分组。叶子：只吃 (revision, createdAt) 和 (timestamp, 原话)。

两处在用，口径必须同一份（CLAUDE.md §四）：
  · 模型：project_revisions 回执里的 turns（ProjectTools._revisions_by_turn）——撤销「那一轮」回到它的起点；
  · 人：工作台「版本」页（ProjectSourceOperations.revisions）——每一版标上第几轮、那一轮说了什么。

⚠ 2026-09-30 隔离真机第 140 轮（租房指南 Word，三轮）：「版本」页 13 行 prv-… 编号，03:47:02～03:47:04
  两秒里就有 7 版——每处 file_str_replace 存一版。人看不出哪一版是哪一轮改的，也就无从「切回上一轮」。
  模型那边 2026-09-27 第 57 轮已经为同一件事做了分组；人这边一直没接。
"""

from __future__ import annotations

from typing import Iterable, Sequence

REVISION_TURNS_HINT = (
    "turns 按用户的话分组：每一轮开始时是哪一版（startedFrom）、这一轮改出了几版。"
    "一轮里每处编辑都会存一版；要撤销某一轮的全部改动，恢复到那一轮的 startedFrom——"
    "只退到上一版（parentRevision）通常只撤掉那一轮最后一处小改动。"
)


def user_turns(transcript: Iterable) -> list[tuple[str, str]]:
    """会话记录里用户说过的每一句（时间戳, 原话），按时间排好。"""
    rows = [(str(row.get("timestamp") or ""), str(row.get("text") or ""))
            for row in (transcript or [])
            if isinstance(row, dict) and row.get("role") == "user" and row.get("kind") == "turn"]
    return sorted((row for row in rows if row[0]), key=lambda row: row[0])


def turn_of(created: str, ordered: Sequence[tuple[str, str]]) -> tuple[int, str] | None:
    """某一版是第几轮（从 1 数）改出来的、那一轮的原话。比第一句话还早（建工程的模板）→ None。"""
    found = None
    for index, (started, text) in enumerate(ordered):
        if created and created >= started:
            found = (index + 1, text)
        else:
            break
    return found


def revisions_by_turn(chain, turns, *, keep=6):
    """把源码版本按「哪一句用户的话之后改出来的」分组。

    ⚠ 2026-09-27 隔离真机第 57 轮（待读书单 + 追问「主色换紫色、按钮改胶囊形」+
      「刚才这次改动不要了，恢复到改之前的版本」）：紫色那一轮是 11 次 file_str_replace，
      每次都存一版。project_revisions 一页只给 5 版、只有 revision / parentRevision /
      createdAt，看不出哪几版是哪一轮改的。模型恢复到「直接上一版」——只撤掉最后一处
      小改动，紫色还在，回话却说「已恢复到刚才改动之前的版本」。
    chain：从最早到最新的 (revision, createdAt)；turns：(timestamp, 用户原话)。
    时间戳同为 ISO 串，直接比较。返回最新在前、只含改出了版本的那几轮。
    """
    ordered = sorted((t for t in turns if t[0]), key=lambda t: t[0])
    out = []
    for index, (started, text) in enumerate(ordered):
        ended = ordered[index + 1][0] if index + 1 < len(ordered) else None
        before = [rev for rev, created in chain if created and created < started]
        made = [rev for rev, created in chain
                if created and created >= started and (ended is None or created < ended)]
        if not made:
            continue
        out.append({"turn": text[:60], "at": started, "startedFrom": before[-1] if before else None,
                    "revisionsMade": len(made), "endedAt": made[-1]})
    return list(reversed(out))[:keep]


def label_revisions(entries: list[dict], transcript: Iterable) -> list[dict]:
    """给「版本」页的每一行（最新在前）标上第几轮、那一轮的原话、是不是这一轮最后改出的那一版。"""
    ordered = user_turns(transcript)
    out = []
    previous_turn = None
    for entry in entries:
        found = turn_of(str(entry.get("createdAt") or ""), ordered)
        index = found[0] if found else None
        out.append({**entry,
                    "turnIndex": index,
                    "turnText": found[1][:80] if found else None,
                    # 最新在前：同一轮里第一次出现的那一行就是这一轮收尾时的那一版
                    "turnLast": index is not None and index != previous_turn})
        previous_turn = index
    return out
