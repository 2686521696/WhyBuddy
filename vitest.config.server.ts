import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=6144"],
      },
    },
    include: [
      "server/tests/**/*.test.ts",
      "server/permission/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
  },
});
