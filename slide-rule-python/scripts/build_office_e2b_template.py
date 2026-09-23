"""Build the Work-mode office E2B image.

code-interpreter-v1 plus headless LibreOffice. The office workspace boots this
image; preview conversion runs soffice inside that sandbox. Do not apt-get
LibreOffice on every bash — the default sandbox is too small and too slow.

Prints template_id and name. Set WHYBUDDY_OFFICE_E2B_TEMPLATE to the name.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ALIAS = "whybuddy-office"


def _load_env() -> None:
    root = Path(__file__).resolve().parents[2]
    for env_path in (root / ".env", root / "slide-rule-python" / ".env"):
        try:
            text = env_path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def office_template():
    from e2b import Template

    return (
        Template()
        .from_template("code-interpreter-v1")
        .apt_install(
            [
                "libreoffice-writer",
                "libreoffice-calc",
                "libreoffice-impress",
                "fonts-noto-cjk",
            ],
            no_install_recommends=True,
        )
    )


def main() -> int:
    _load_env()
    if not os.getenv("E2B_API_KEY", "").strip():
        print("FAILED missing E2B_API_KEY", file=sys.stderr)
        return 1
    from e2b import Template, default_build_logger

    info = Template.build(
        office_template(),
        alias=ALIAS,
        cpu_count=2,
        memory_mb=4096,
        on_build_logs=default_build_logger(),
    )
    line = f"DONE name={info.name} template_id={info.template_id}"
    _status(line)
    print(line)
    return 0


def _status(line: str) -> None:
    path = Path(__file__).resolve().parents[2] / "tmp" / "office-e2b-template.status"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(line + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        line = f"FAILED {type(exc).__name__}: {exc}"
        try:
            _status(line)
        except Exception:
            pass
        print(line, file=sys.stderr)
        raise
