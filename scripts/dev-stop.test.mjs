import test from "node:test";
import assert from "node:assert/strict";

import { findOrphanedPythonWorkerPids } from "./dev-stop.mjs";

test("findOrphanedPythonWorkerPids finds a spawn worker whose dead parent owns a dev port", () => {
  const processes = [
    {
      ProcessId: 39264,
      ParentProcessId: 20288,
      Name: "python.exe",
      CommandLine:
        '"C:\\Python312\\python.exe" "-c" "from multiprocessing.spawn import spawn_main; spawn_main(parent_pid=20288, pipe_handle=400)"',
    },
    {
      ProcessId: 41000,
      ParentProcessId: 20288,
      Name: "node.exe",
      CommandLine: "node unrelated.mjs",
    },
    {
      ProcessId: 42000,
      ParentProcessId: 99999,
      Name: "python.exe",
      CommandLine:
        '"C:\\Python312\\python.exe" "-c" "from multiprocessing.spawn import spawn_main; spawn_main(parent_pid=99999)"',
    },
  ];

  assert.deepEqual(findOrphanedPythonWorkerPids(processes, [20288]), [39264]);
});
