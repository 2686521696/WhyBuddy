import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();

// 端口兜底清扫：命令行模式匹配抓不到的漂移进程（真实事故：一个手工/异目录
// 启动的 uvicorn 常驻 9700，dev:stop 报 "No project dev processes found"，
// 之后每次"重启"其实都没换掉它，且它没有继承 .env 的 LLM key）。
// 只杀名字像 dev 栈的进程（node/npm/python/uvicorn），其他占用者只提示不动手。
const DEV_PORTS = [
  Number(process.env.VITE_PORT || 3000),
  3001,
  Number(process.env.SLIDE_RULE_PYTHON_PORT || 9700),
  Number(process.env.LOBSTER_EXECUTOR_PORT || 3031),
];
const DEV_PROCESS_NAMES = ["node", "npm", "cmd", "python", "python3", "uvicorn"];

function escapeForPowerShell(value) {
  return value.replace(/'/g, "''");
}

async function stopWindowsProjectProcesses() {
  const escapedRoot = escapeForPowerShell(projectRoot);
  const escapedPid = String(process.pid);
  const command = [
    `$root = '${escapedRoot}'`,
    `$selfPid = ${escapedPid}`,
    `function Test-ProjectProcess([string] $name, [string] $commandLine) {`,
    `  if (-not $commandLine) { return $false }`,
    `  if ($name -like 'python*') {`,
    `    # slide-rule-python 的 uvicorn dev server。注意 --reload 的 worker 是`,
    `    # multiprocessing spawn 出来的：命令行里没有 'uvicorn' 字样（真实事故：`,
    `    # 按命令行杀 uvicorn 全部漏掉 worker，死掉的 reloader 留下孤儿监听套接字，`,
    `    # netstat 报一个已不存在的属主 PID）。按可执行文件路径兜底识别。`,
    `    if ($commandLine -match 'uvicorn\\s+app:app' -and $commandLine -like '*slide-rule-python*') { return $true }`,
    `    if ($commandLine -match 'spawn_main' -and $commandLine -like '*slide-rule-python*') { return $true }`,
    `    return $false`,
    `  }`,
    `  if ($commandLine -like "*$root*") { return $true }`,
    `  if ($commandLine -match 'scripts[\\\\/]dev-all\\.mjs') { return $true }`,
    `  # Keep server patterns so dev:stop also catches manual "npm run dev:server".`,
    `  if ($commandLine -match '--import\\s+tsx/esm\\s+server/index\\.ts') { return $true }`,
    `  if ($commandLine -match '--watch-path=server\\s+--watch-path=shared\\s+--import\\s+tsx/esm\\s+server/index\\.ts') { return $true }`,
    `  if ($commandLine -match 'tsx(?:\\.cmd)?\"?\\s+watch.*server/index\\.ts') { return $true }`,
    `  if ($commandLine -match 'services[\\\\/]lobster-executor[\\\\/]src[\\\\/]index\\.ts') { return $true }`,
    `  if ($commandLine -match 'vite(?:\\.cmd)?\"?\\s+--host') { return $true }`,
    `  if ($commandLine -match 'npm(?:\\.cmd)?\"?\\s+run\\s+dev(?::server|:all|:frontend|:advanced|:sliderule)?') { return $true }`,
    `  return $false`,
    `}`,
    `$all = Get-CimInstance Win32_Process | Where-Object {`,
    `  $_.ProcessId -ne $selfPid -and`,
    `  (@('node.exe', 'npm.exe', 'cmd.exe') -contains $_.Name -or $_.Name -like 'python*')`,
    `}`,
    `$matched = $all | Where-Object { Test-ProjectProcess $_.Name $_.CommandLine }`,
    `$processes = @($matched)`,
    `if (-not $processes) {`,
    `  Write-Output 'No project dev processes found.'`,
    `  exit 0`,
    `}`,
    `$processes | Sort-Object ProcessId -Unique | Sort-Object ProcessId -Descending | ForEach-Object {`,
    `  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue`,
    `  Write-Output ("Stopped PID {0}" -f $_.ProcessId)`,
    `}`,
  ].join("\n");

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: projectRoot,
  });

  process.stdout.write(stdout);
}

async function stopUnixProjectProcesses() {
  const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,command="], {
    cwd: projectRoot,
  });

  const targets = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter((entry) => {
      if (!entry || entry.pid === process.pid || !entry.command.includes(projectRoot)) return false;
      if (entry.command.includes("node")) return true;   // catches vite, executor, and any manual dev:server
      // Only the slide-rule-python uvicorn dev server; never a stray pytest / worker.
      return (
        entry.command.includes("uvicorn") &&
        entry.command.includes("app:app") &&
        entry.command.includes("slide-rule-python")
      );
    });

  if (!targets.length) {
    console.log("No project dev processes found.");
    return;
  }

  for (const target of targets) {
    process.kill(target.pid, "SIGTERM");
    console.log(`Stopped PID ${target.pid}`);
  }
}

async function sweepWindowsDevPorts() {
  const names = DEV_PROCESS_NAMES.map((n) => `'${n}'`).join(",");
  const command = [
    `$selfPid = ${process.pid}`,
    `$devNames = @(${names})`,
    `foreach ($port in @(${DEV_PORTS.join(",")})) {`,
    `  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {`,
    `    $ownerPid = $_.OwningProcess`,
    `    if (-not $ownerPid -or $ownerPid -eq $selfPid) { return }`,
    `    $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue`,
    `    if (-not $proc) {`,
    `      # 属主查不到（tasklist 也看不见）= 多半是 WSL 端口转发或提权进程。`,
    `      # 强杀尝试一次；端口若仍被占，只有 wsl --shutdown / 管理员能解。`,
    `      Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue`,
    `      Write-Output ("Port {0} owner PID {1} is UNRESOLVABLE (likely WSL relay or elevated process). Tried force-stop; if the port stays busy run: wsl --shutdown" -f $port, $ownerPid)`,
    `      return`,
    `    }`,
    `    if ($devNames -contains $proc.ProcessName) {`,
    `      Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue`,
    `      Write-Output ("Stopped PID {0} (port {1}, {2})" -f $ownerPid, $port, $proc.ProcessName)`,
    `    } else {`,
    `      Write-Output ("Port {0} held by PID {1} ({2}) - not a dev process, left running" -f $port, $ownerPid, $proc.ProcessName)`,
    `    }`,
    `  }`,
    `}`,
  ].join("\n");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
      cwd: projectRoot,
    });
    if (stdout.trim()) process.stdout.write(stdout);
  } catch (error) {
    // 清扫失败必须出声（真实事故：这里静默吞错，幽灵端口占用零提示）。
    console.warn(
      `[dev:stop] port sweep failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function sweepUnixDevPorts() {
  for (const port of DEV_PORTS) {
    let pids = [];
    try {
      const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
      pids = stdout.split("\n").map((s) => Number(s.trim())).filter(Boolean);
    } catch {
      continue; // lsof missing or no listener
    }
    for (const pid of pids) {
      if (pid === process.pid) continue;
      let commandLine = "";
      try {
        const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
        commandLine = stdout.trim();
      } catch {
        continue;
      }
      const lower = commandLine.toLowerCase();
      if (DEV_PROCESS_NAMES.some((name) => lower.includes(name))) {
        try {
          process.kill(pid, "SIGTERM");
          console.log(`Stopped PID ${pid} (port ${port})`);
        } catch {
          /* already gone */
        }
      } else {
        console.log(`Port ${port} held by PID ${pid} (${commandLine.slice(0, 60)}) - not a dev process, left running`);
      }
    }
  }
}

if (process.platform === "win32") {
  await stopWindowsProjectProcesses();
  await sweepWindowsDevPorts();
} else {
  await stopUnixProjectProcesses();
  await sweepUnixDevPorts();
}

console.log("dev:stop complete.");
