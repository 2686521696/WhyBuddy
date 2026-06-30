import { describe, expect, it } from "vitest";

import { executeGetDeviceInfoNode } from "../routes/node-adapters/get-device-info-node-adapter.js";

describe("executeGetDeviceInfoNode", () => {
  it("returns summary-level runtime and client hints with privacy metadata", async () => {
    const result = await executeGetDeviceInfoNode(
      {
        nodeType: "get_device_info",
        input: {
          clientHints: {
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
            platform: "desktop-web",
            locale: "zh-cn",
            timezone: "Asia/Shanghai",
            appVersion: "1.2.3",
            screenCategory: "desktop",
          },
          privacy: {
            retention: "session",
          },
        },
      },
      {
        processPlatform: "win32",
        processArch: "x64",
        processVersion: "v22.0.0",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      nodeType: "get_device_info",
      output: {
        status: "completed",
        runtime: {
          runtime: "node",
          platform: "win32",
          arch: "x64",
          nodeVersion: "v22.0.0",
        },
        client: {
          platform: "desktop-web",
          browserFamily: "Chrome",
          osFamily: "Windows",
          locale: "zh-CN",
          timezone: "Asia/Shanghai",
          appVersion: "1.2.3",
          screenCategory: "desktop",
        },
        privacy: {
          collectionMode: "summary_only",
          rawUserAgentStored: false,
          retention: "session",
          redactedFields: ["clientHints.userAgent"],
        },
        compatibility: {
          hostRuntime: "server",
          hasClientHints: true,
          fallbackMode: false,
        },
      },
    });
  });

  it("falls back to runtime-only summary when client hints are filtered out", async () => {
    const result = await executeGetDeviceInfoNode(
      {
        nodeType: "get_device_info",
        input: {
          clientHints: {
            userAgent: "Mozilla/5.0 Firefox/124.0",
            timezone: "Mars/Olympus",
          },
          privacy: {
            allowClientHints: false,
            allowRuntimeDetails: false,
          },
        },
      },
      {
        processPlatform: "linux",
        processArch: "arm64",
        processVersion: "v22.1.0",
      },
    );

    expect(result.output.runtime).toEqual({
      runtime: "node",
    });
    expect(result.output.client).toBeUndefined();
    expect(result.output.compatibility.fallbackMode).toBe(true);
    expect(result.output.warnings).toContain(
      "Client hints were unavailable; only runtime summary was returned.",
    );
  });

  it("proxies to python-owned when executePythonRuntime wired (105 longtail)", async () => {
    const result = await executeGetDeviceInfoNode(
      { nodeType: "get_device_info", input: {} },
      {
        executePythonRuntime: async (i: any) => ({ ok: true, status: "completed", runtime: { runtime: "python" }, metadata: { fromPy: true } }),
      },
    );
    expect(result.output.runtime?.runtime).toBe("python");
    expect(result.output.metadata?.fromPy).toBe(true);
  });
});
