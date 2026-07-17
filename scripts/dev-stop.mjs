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
    `function Test-ProjectProcess([string] $name, [string] $commandLine, [string] $exePath) {`,
    `  if ($name -like 'python*') {`,
    `    # slide-rule-python 的 uvicorn dev server。注意 --reload 的 worker 是`,
    `    # multiprocessing spawn 出来的：命令行里没有 'uvicorn' 字样、可能也没有`,
    `    # 项目路径（真实事故：reloader 父进程死了，worker 孤儿继承监听套接字，`,
    `    # netstat 报一个已不存在的父 PID，按命令行匹配全部漏掉）。`,
    `    # 按可执行文件路径兜底：venv 解释器一定在 slide-rule-python 目录下。`,
    `    if ($exePath -and $exePath -like '*slide-rule-python*') { return $true }`,
    `    if (-not $commandLine) { return $false }`,
    `    if ($commandLine -match 'uvicorn\\s+app:app' -and $commandLine -like '*slide-rule-python*') { return $true }`,
    `    if ($commandLine -match 'spawn_main' -and $commandLine -like '*slide-rule-python*') { return $true }`,
    `    return $false`,
    `  }`,
    `  if (-not $commandLine) { return $false }`,
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
    `$all = Get-CimInstance Win32_Process`,
    `$candidates = $all | Where-Object {`,
    `  $_.ProcessId -ne $selfPid -and`,
    `  (@('node.exe', 'npm.exe', 'cmd.exe') -contains $_.Name -or $_.Name -like 'python*')`,
    `}`,
    `$matched = @($candidates | Where-Object { Test-ProjectProcess $_.Name $_.CommandLine $_.ExecutablePath })`,
    `# 后代闭包：被匹配进程 spawn 的子进程一并收编（父被杀、子漏杀 = 孤儿`,
    `# 继续占端口的根因）。全表建 ParentProcessId 索引再 BFS。`,
    `$byParent = @{}`,
    `foreach ($p in $all) {`,
    `  $key = [int]$p.ParentProcessId`,
    `  if (-not $byParent.ContainsKey($key)) { $byParent[$key] = @() }`,
    `  $byParent[$key] += $p`,
    `}`,
    `$seen = @{}`,
    `$queue = New-Object System.Collections.Queue`,
    `foreach ($m in $matched) { if (-not $seen.ContainsKey([int]$m.ProcessId)) { $seen[[int]$m.ProcessId] = $true; $queue.Enqueue($m) } }`,
    `$kill = @()`,
    `while ($queue.Count -gt 0) {`,
    `  $p = $queue.Dequeue()`,
    `  $kill += $p`,
    `  if ($byParent.ContainsKey([int]$p.ProcessId)) {`,
    `    foreach ($c in $byParent[[int]$p.ProcessId]) {`,
    `      $cid = [int]$c.ProcessId`,
    `      if ($cid -ne $selfPid -and -not $seen.ContainsKey($cid)) { $seen[$cid] = $true; $queue.Enqueue($c) }`,
    `    }`,
    `  }`,
    `}`,
    `if (-not $kill) {`,
    `  Write-Output 'No project dev processes found.'`,
    `  exit 0`,
    `}`,
    `$kill | Sort-Object ProcessId -Unique | Sort-Object ProcessId -Descending | ForEach-Object {`,
    `  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue`,
    `  Write-Output ("Stopped PID {0} ({1})" -f $_.ProcessId, $_.Name)`,
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
      // slide-rule-python 的 uvicorn dev server 及其 --reload spawn worker
      // （worker 命令行只有 "python -c ...spawn_main..."，但解释器路径在项目
      // venv 下所以过了 projectRoot 过滤；父死子活会留孤儿监听套接字）。
      if (entry.command.includes("slide-rule-python") && entry.command.includes("spawn_main")) {
        return true;
      }
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

/** netstat -ano 找某端口的 LISTENING 属主 PID（不依赖 Get-NetTCPConnection——
 *  真实事故：NetTCPIP 模块在部分机器上整段抛错，sweep 一个进程都没扫到）。 */
async function listWindowsListeningPids(port) {
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], { cwd: projectRoot });
    const pids = new Set();
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
      if (m && Number(m[1]) === port) pids.add(Number(m[2]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

/** tasklist 解析进程名；返回 null = PID 查不到（幽灵：属主已死、端口表未刷新，
 *  或 WSL 端口转发/提权进程）。 */
async function resolveWindowsProcessName(pid) {
  try {
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { cwd: projectRoot }
    );
    const m = stdout.match(/^"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function sweepWindowsDevPorts() {
  let sawGhost = false;
  for (const port of DEV_PORTS) {
    for (const pid of await listWindowsListeningPids(port)) {
      if (pid === process.pid) continue;
      const name = await resolveWindowsProcessName(pid);
      if (name === null) {
        // 幽灵 PID：真实事故里这是"已退出的父进程"——监听套接字被它 spawn 的
        // 子进程继承着，端口表还挂着死父 PID。真正的持有者（孤儿 python worker）
        // 由 stopWindowsProjectProcesses 的可执行路径匹配 + 后代闭包负责收掉，
        // 这里只把真相喊出来，最后统一复查端口是否解放。
        console.log(
          `Port ${port} owner PID ${pid} is UNRESOLVABLE (dead parent with orphaned child, ` +
            `WSL relay, or elevated process). Orphan cleanup already ran; re-checking below.`
        );
        sawGhost = true;
        continue;
      }
      const base = name.toLowerCase().replace(/\.exe$/, "");
      if (DEV_PROCESS_NAMES.includes(base)) {
        // /T 连子进程树一起收：父进程单杀会把继承了套接字的子进程留成下一个幽灵
        try {
          await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { cwd: projectRoot });
          console.log(`Stopped PID ${pid} tree (port ${port}, ${name})`);
        } catch (error) {
          console.warn(`[dev:stop] taskkill PID ${pid} (port ${port}) failed: ${error?.message ?? error}`);
        }
      } else {
        console.log(`Port ${port} held by PID ${pid} (${name}) - not a dev process, left running`);
      }
    }
  }
  // 终局复查：清扫完端口必须真的空了，否则大声说出来（静默失败 = 下一次
  // "重启没生效" 的幽灵现场）。
  await new Promise((r) => setTimeout(r, 500));
  const stillBusy = [];
  for (const port of DEV_PORTS) {
    const pids = (await listWindowsListeningPids(port)).filter((p) => p !== process.pid);
    if (pids.length) stillBusy.push({ port, pids });
  }
  if (stillBusy.length) {
    for (const { port, pids } of stillBusy) {
      console.warn(
        `[dev:stop] !!! Port ${port} is STILL occupied after cleanup (PID ${pids.join(",")}). ` +
          `If the PID is unresolvable it is likely a WSL relay - run "wsl --shutdown" (Windows) and retry.`
      );
    }
  } else if (sawGhost) {
    console.log("Ghost owner cleared - all dev ports are free now.");
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
