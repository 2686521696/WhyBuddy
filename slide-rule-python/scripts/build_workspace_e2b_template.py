"""Build the general-purpose workspace E2B image (web / backend projects in any common language).

⚠ 2026-10-09：工程电脑只有 E2B 默认镜像（code-interpreter-v1）：Python 3.13、Node 20、gcc、一个 2018 年的
  Java 11，Go / PHP / Ruby / .NET / Rust / Maven 一个都没有（真沙盒里 command -v 逐个查过）。
  通用 Agent 接到「Go 写个短链服务」「Laravel 后台」「Spring Boot 接口」，电脑上连编译器都没有。

照 devcontainers/images 的 universal 镜像（MIT，GitHub Codespaces 默认）那张语言清单：Python、Node、Java、
.NET、PHP、Go、Ruby，外加 Rust。不直接 FROM 那张镜像：它是按 Codespaces 的 VS Code 体验做的，十几 GB，
还带一整套编辑器服务；这里在 code-interpreter-v1 上用发行版的包补齐同一张清单，保住 E2B 自己的那一层。

内存给到 4 GB：Spring Boot / .NET 的第一次构建在默认 2 GB 里会被 OOM 杀掉。

Prints template_id and name. Set WHYBUDDY_WORKSPACE_E2B_TEMPLATE to the name.

⚠ 2026-10-09 用户要求实测「直接用微软那张镜像」：`python scripts/build_workspace_e2b_template.py universal`
  建 UNIVERSAL_ALIAS，`verify whybuddy-workspace-universal` 量开机时间、语言、平台约定。两张并存，
  线上用哪张只看 WHYBUDDY_WORKSPACE_E2B_TEMPLATE。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ALIAS = "whybuddy-workspace"

#: 直接拿微软 devcontainers 的 universal 镜像当底座（GitHub Codespaces 默认那张）。版本钉死：换版本要重跑 verify。
#: 压缩后约 4 GB（6.1.9 的 amd64 清单 31 层）。默认用户是 codespace，语言装在 /usr/local 下、按组授权
#: （nvm / python / rvm / sdkman / golang …）；我们的平台约定用户是 user、工程在 /home/user/workspace。
UNIVERSAL_IMAGE = "mcr.microsoft.com/devcontainers/universal:6.1.9"
UNIVERSAL_ALIAS = "whybuddy-workspace-universal"
#: universal 镜像里给「能往全局装东西的用户」开的组：把 user 加进去，pip / npm -g / gem 才装得进去。
UNIVERSAL_TOOL_GROUPS = ("nvm", "python", "rvm", "sdkman", "golang", "oryx", "pipx", "conda", "hugo", "php")

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


def universal_template():
    """微软 universal 镜像 + 我们平台的约定（user 用户、/home/user/workspace）。"""
    from e2b import Template

    groups = " ".join(UNIVERSAL_TOOL_GROUPS)
    return (
        Template()
        .from_image(UNIVERSAL_IMAGE)
        .set_user("root")
        .run_cmd("id -u user >/dev/null 2>&1 || useradd -m -s /bin/bash user; "
                 f"for g in {groups}; do getent group $g >/dev/null && usermod -aG $g user; done; "
                 "mkdir -p /home/user/workspace && chown -R user:user /home/user")
        # ⚠ 2026-10-09 实测：PHP 的 xdebug.mode=debug，每跑一次 php / composer 都先打一行「Could not connect to
        #   debugging client」——模型读日志会被它带偏。第一版用 set_envs(XDEBUG_MODE=off)：E2B 的 set_envs 只在
        #   构建时生效，开出来的沙盒里没有（镜像自带的 ENV 倒是留着）。写进 PHP 自己的配置目录。
        .run_cmd("d=$(php -r 'echo PHP_CONFIG_FILE_SCAN_DIR;'); "
                 "if [ -n \"$d\" ]; then mkdir -p \"$d\" && echo 'xdebug.mode=off' > \"$d/zz-whybuddy-xdebug-off.ini\"; "
                 "else echo 'xdebug.mode=off' >> \"$(php -r 'echo php_ini_loaded_file();')\"; fi")
        .set_user("user")
        # ⚠ 2026-10-09 实测：universal 不带 Rust（镜像的语言清单里本来就没有）。照 rust-lang 官方的 rustup 装在
        #   user 自己的默认位置（~/.rustup、~/.cargo）——不靠 RUSTUP_HOME 之类的环境变量（同上，运行时没有），
        #   第一版装到 /usr/local 再设环境变量，运行时报「no default is configured」。命令链进 /usr/local/bin。
        .run_cmd("curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path")
        .set_user("root")
        .run_cmd("ln -sf /home/user/.cargo/bin/* /usr/local/bin/")
        .set_user("user")
        .set_workdir("/home/user")
    )


def verify(template: str) -> int:
    """开一台这个镜像的沙盒：量开机时间，逐个确认语言都在，再确认平台约定（用户、工作区、能装包）。"""
    import time

    from e2b_code_interpreter import Sandbox

    started = time.monotonic()
    box = Sandbox.create(template=template, api_key=os.environ["E2B_API_KEY"], timeout=300)
    print(f"create_seconds={time.monotonic() - started:.1f}")
    try:
        script = "; ".join(
            f"printf '%s: ' {cmd}; (command -v {cmd} >/dev/null && ({cmd} --version 2>&1 || {cmd} version 2>&1)"
            f" | head -1) || echo MISSING" for cmd in EXPECTED_COMMANDS + ("git",))
        facts = ("echo whoami=$(whoami) home=$HOME; mkdir -p /home/user/workspace && touch /home/user/workspace/.w"
                 " && echo workspace=writable; "
                 "free -m | sed -n 2p; df -h / | tail -1")
        out = box.commands.run(script + "; " + facts, timeout=180).stdout
        started = time.monotonic()

        def attempt(command):
            try:
                return box.commands.run(command, timeout=180).stdout
            except Exception as exc:                    # 装不上要看见原因，不要整个验证崩掉
                return f"FAILED {command[:60]!r}: {str(exc)[-400:]}\n"

        pip = attempt("cd /tmp && python3 -m pip install -q --user six && python3 -c 'import six; print(\"pip=ok\")'")
        npm = attempt("cd /home/user/workspace && npm init -y >/dev/null && npm install -s left-pad && echo npm=ok")
        out += pip + npm + f"install_seconds={time.monotonic() - started:.1f}\n"
    finally:
        box.kill()
    print(out)
    return 1 if "MISSING" in out or "pip=ok" not in out or "npm=ok" not in out else 0


def main() -> int:
    _load_env()
    if not os.getenv("E2B_API_KEY", "").strip():
        print("FAILED missing E2B_API_KEY", file=sys.stderr)
        return 1
    if sys.argv[1:2] == ["verify"]:
        return verify(sys.argv[2] if len(sys.argv) > 2 else ALIAS)
    from e2b import Template, default_build_logger

    universal = sys.argv[1:2] == ["universal"]
    info = Template.build(
        universal_template() if universal else workspace_template(),
        alias=UNIVERSAL_ALIAS if universal else ALIAS,
        cpu_count=2,
        memory_mb=4096,
        on_build_logs=default_build_logger(),
    )
    line = f"DONE name={info.name} template_id={info.template_id}"
    print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
