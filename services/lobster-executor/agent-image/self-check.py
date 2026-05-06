#!/usr/bin/env python3
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ARTIFACTS_DIR = Path(os.environ.get("CUBE_AGENT_SELF_CHECK_ARTIFACTS_DIR", "/workspace/artifacts"))
RESULT_FILE = ARTIFACTS_DIR / "agent-python-self-check.json"


def command_version(command, *args):
    path = shutil.which(command)
    if not path:
        return {
            "ok": False,
            "command": " ".join([command, *args]),
            "output": "command not found",
        }
    try:
        completed = subprocess.run(
            [command, *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return {
            "ok": completed.returncode == 0,
            "command": " ".join([command, *args]),
            "output": (completed.stdout or completed.stderr).strip(),
        }
    except Exception as exc:
        return {
            "ok": False,
            "command": " ".join([command, *args]),
            "output": str(exc),
        }


def command_any(label, candidates):
    attempts = [command_version(command, *args) for command, args in candidates]
    passed = next((item for item in attempts if item["ok"]), None)
    return {
        "ok": passed is not None,
        "command": label,
        "output": passed["output"] if passed else "\n".join(
            f"{item['command']}: {item['output']}" for item in attempts
        ),
        "attempts": attempts,
    }


def module_check(module):
    return {
        "ok": importlib.util.find_spec(module) is not None,
        "module": module,
    }


def main():
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    checks = [
        command_version("python", "--version"),
        command_version("pip", "--version"),
        command_version("pandoc", "--version"),
        command_version("libreoffice", "--version"),
        command_version("ffmpeg", "-version"),
        command_any(
            "imagemagick",
            [
                ("magick", ["--version"]),
                ("convert", ["--version"]),
            ],
        ),
    ]
    modules = [module_check(name) for name in ["requests", "pandas", "bs4"]]
    result = {
        "ok": all(item["ok"] for item in checks) and all(item["ok"] for item in modules),
        "python": sys.version,
        "checkedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "checks": checks,
        "modules": modules,
    }
    RESULT_FILE.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
