"""Build the general-purpose workspace E2B image (web / backend projects in any common language).

⚠ 2026-10-09：工程电脑只有 E2B 默认镜像（code-interpreter-v1）：Python 3.13、Node 20、gcc、一个 2018 年的
  Java 11，Go / PHP / Ruby / .NET / Rust / Maven 一个都没有（真沙盒里 command -v 逐个查过）。
  通用 Agent 接到「Go 写个短链服务」「Laravel 后台」「Spring Boot 接口」，电脑上连编译器都没有。

照 devcontainers/images 的 universal 镜像（MIT，GitHub Codespaces 默认）那张语言清单：Python、Node、Java、
.NET、PHP、Go、Ruby，外加 Rust。不直接 FROM 那张镜像：它是按 Codespaces 的 VS Code 体验做的，十几 GB，
还带一整套编辑器服务；这里在 code-interpreter-v1 上用发行版的包补齐同一张清单，保住 E2B 自己的那一层。

内存给到 4 GB：Spring Boot / .NET 的第一次构建在默认 2 GB 里会被 OOM 杀掉。

Prints template_id and name. Set WHYBUDDY_WORKSPACE_E2B_TEMPLATE to the name.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ALIAS = "whybuddy-workspace"

#: 发行版自带的包。Debian 13（trixie）：Go 1.24、PHP 8.4、Ruby 3.3、OpenJDK 21、Rust 1.85。
APT_PACKAGES = [
    "golang-go",
    "php-cli", "php-mbstring", "php-xml", "php-curl", "php-sqlite3", "php-zip", "php-intl", "php-mysql", "php-pgsql",
    "composer",
    "ruby-full",
    "openjdk-21-jdk-headless", "maven",
    "rustc", "cargo",
    "sqlite3", "unzip", "zip",
]

#: 用来确认装上了的那几条命令，构建完逐个跑一遍（verify 子命令）。
EXPECTED_COMMANDS = ("python3", "node", "npm", "java", "mvn", "go", "php", "composer", "ruby", "gem",
                     "dotnet", "rustc", "cargo")


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


def workspace_template():
    from e2b import Template

    return (
        Template()
        .from_template("code-interpreter-v1")
        .apt_install(APT_PACKAGES, no_install_recommends=True)
        # .NET 不在 Debian 源里：用微软官方安装脚本装 8.0 LTS。
        .run_cmd("curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh"
                 " && bash /tmp/dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet"
                 " && ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet && rm -f /tmp/dotnet-install.sh", user="root")
        # 镜像自带的 Java 11 排在 PATH 前面：让 java / javac 指向刚装的 21（Spring Boot 3 要求 17+）。
        .run_cmd("for b in java javac jar; do ln -sf /usr/lib/jvm/java-21-openjdk-amd64/bin/$b /usr/local/bin/$b; done",
                 user="root")
        # pnpm / yarn 走 Node 自带的 corepack，不另装。
        .run_cmd("corepack enable || true", user="root")
        .set_envs({"JAVA_HOME": "/usr/lib/jvm/java-21-openjdk-amd64", "DOTNET_ROOT": "/usr/share/dotnet",
                   "DOTNET_CLI_TELEMETRY_OPTOUT": "1", "DOTNET_NOLOGO": "1"})
    )


def verify(template: str) -> int:
    """开一台这个镜像的沙盒，逐个确认语言都在。"""
    from e2b_code_interpreter import Sandbox

    box = Sandbox.create(template=template, api_key=os.environ["E2B_API_KEY"], timeout=180)
    try:
        script = "; ".join(
            f"printf '%s: ' {cmd}; (command -v {cmd} >/dev/null && ({cmd} --version 2>&1 || {cmd} version 2>&1)"
            f" | head -1) || echo MISSING" for cmd in EXPECTED_COMMANDS)
        out = box.commands.run(script + "; free -m | sed -n 2p", timeout=120).stdout
    finally:
        box.kill()
    print(out)
    return 1 if "MISSING" in out else 0


def main() -> int:
    _load_env()
    if not os.getenv("E2B_API_KEY", "").strip():
        print("FAILED missing E2B_API_KEY", file=sys.stderr)
        return 1
    if sys.argv[1:2] == ["verify"]:
        return verify(sys.argv[2] if len(sys.argv) > 2 else ALIAS)
    from e2b import Template, default_build_logger

    info = Template.build(
        workspace_template(),
        alias=ALIAS,
        cpu_count=2,
        memory_mb=4096,
        on_build_logs=default_build_logger(),
    )
    line = f"DONE name={info.name} template_id={info.template_id}"
    print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
