"""改名兼容 · 旧环境变量兜底（发布门 G1，2026-07-15）。

原 Node 侧 rename-compat 测试的第 ② 项（WHYBUDDY_SESSIONS_FILE 旧 env
仍能选中会话存储文件）随 NodeRetirement 移交 Python——行为落点是
persistence._resolve_store_file 的 env 兜底链（新名优先，旧名兜底）。
"""

from __future__ import annotations

from pathlib import Path

from services.persistence import _resolve_store_file


def test_legacy_whybuddy_env_selects_store_file(monkeypatch, tmp_path):
    legacy = tmp_path / "legacy-sessions.json"
    monkeypatch.delenv("SLIDERULE_SESSIONS_FILE", raising=False)
    monkeypatch.setenv("WHYBUDDY_SESSIONS_FILE", str(legacy))
    assert _resolve_store_file() == Path(str(legacy))


def test_new_env_wins_over_legacy(monkeypatch, tmp_path):
    new = tmp_path / "new-sessions.json"
    legacy = tmp_path / "legacy-sessions.json"
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(new))
    monkeypatch.setenv("WHYBUDDY_SESSIONS_FILE", str(legacy))
    assert _resolve_store_file() == Path(str(new))


def test_explicit_path_beats_env(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "env.json"))
    explicit = tmp_path / "explicit.json"
    assert _resolve_store_file(explicit) == explicit
