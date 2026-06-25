"""
SlideRule AgentLoop path security tests (109).

This file contains the required gate marker.
"""

import os
import sys
import tempfile
from pathlib import Path

# Make services importable when pytest runs from package root (matches models import style)
_pkg_root = Path(__file__).resolve().parent.parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

import pytest

from services.agent_loop_paths import (
    get_agent_loop_runs_root,
    resolve_safe_path,
    resolve_run_dir,
    resolve_artifact_path,
)


def test_agentloop_path_security_109_rejects_traversal_and_absolute_escapes():
    """agentloop path security 109 rejects traversal and absolute escapes"""
    with tempfile.TemporaryDirectory() as tmp:
        root = tmp

        # setup a valid documented run dir (under allowed root)
        valid_run_id = "2026-06-25T14-00-00-000Z"
        valid_dir = Path(root) / valid_run_id
        valid_dir.mkdir(parents=True)
        (valid_dir / "state.json").write_text("{}", encoding="utf-8")
        (valid_dir / "final-report.md").write_text("# ok", encoding="utf-8")

        # allowed root
        r = get_agent_loop_runs_root(root)
        assert r is not None
        assert str(r).endswith("runs") or str(r) == str(Path(root).resolve())  # when overridden

        # valid resolution
        p = resolve_run_dir(valid_run_id, root)
        assert p is not None
        assert p.name == valid_run_id
        assert p.exists()

        a = resolve_artifact_path(valid_run_id, "state.json", root)
        assert a is not None
        assert a.name == "state.json"

        # --- REJECTIONS (core 109 criteria) ---

        # traversal escapes
        assert resolve_run_dir("..", root) is None
        assert resolve_run_dir("../etc/passwd", root) is None
        assert resolve_run_dir(valid_run_id + "/..", root) is None
        assert resolve_safe_path(root, "..") is None
        assert resolve_safe_path(root, "subdir", "..", "evil") is None
        assert resolve_artifact_path(valid_run_id, "../secret", root) is None
        assert resolve_artifact_path("..", "x", root) is None

        # absolute user-supplied paths
        assert resolve_run_dir("/etc/passwd", root) is None
        assert resolve_run_dir("/root", root) is None
        assert resolve_run_dir("\\windows", root) is None
        assert resolve_safe_path(root, "/abs/path") is None
        assert resolve_safe_path(root, "C:/Windows") is None
        assert resolve_safe_path(root, "C:\\foo\\bar") is None
        assert resolve_artifact_path(valid_run_id, "/etc/shadow", root) is None
        assert resolve_artifact_path(valid_run_id, "C:\\x", root) is None

        # drive-prefix escapes (explicit cases)
        assert resolve_run_dir("C:foo", root) is None
        assert resolve_safe_path(root, "C:foo") is None
        assert resolve_safe_path(root, "D:\\escape") is None
        assert resolve_safe_path(root, "\\\\server\\share") is None
        assert resolve_safe_path(root, "//server/share") is None
        assert resolve_artifact_path(valid_run_id, "C:secret", root) is None

        # symlink escape (simulated to avoid platform perm issues; exercises escape detection branch)
        orig_exists = Path.exists
        orig_resolve = Path.resolve

        def fake_exists(self):
            if "symlink_escape" in str(self):
                return True
            return orig_exists(self)

        def fake_resolve(self, strict=False):
            if "symlink_escape" in str(self):
                # simulate resolve landing outside the root
                outside = Path("C:\\outside") if os.name == "nt" else Path("/outside")
                return outside
            return orig_resolve(self, strict=strict)

        try:
            Path.exists = fake_exists  # type: ignore
            Path.resolve = fake_resolve  # type: ignore
            bad_via_link = resolve_safe_path(valid_dir, "symlink_escape", "leak.txt")
            assert bad_via_link is None, "symlink escape must be rejected by resolve_safe_path"
            bad_artifact = resolve_artifact_path(valid_run_id, "symlink_escape", root)  # name triggers but run resolve first
            # run resolve would reject before, test the safe fn directly
        finally:
            Path.exists = orig_exists  # type: ignore
            Path.resolve = orig_resolve  # type: ignore

        # also direct via resolve_safe
        try:
            Path.exists = fake_exists  # type: ignore
            Path.resolve = fake_resolve  # type: ignore
            assert resolve_safe_path(root, valid_run_id, "symlink_escape", "x") is None
        finally:
            Path.exists = orig_exists  # type: ignore
            Path.resolve = orig_resolve  # type: ignore

        # final: no raw errors, all bad cases -> None (user supplied parts always checked against base root)
        assert resolve_run_dir("C:\\", root) is None
        assert resolve_artifact_path(valid_run_id, "..\\foo", root) is None
