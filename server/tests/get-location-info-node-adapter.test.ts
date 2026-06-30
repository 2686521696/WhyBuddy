import { describe, expect, it } from "vitest";

import { executeGetLocationInfoNode } from "../routes/node-adapters/get-location-info-node-adapter.js";

describe("get-location python proxy 105", () => {
  it("proxies location to python", async () => {
    const r = await executeGetLocationInfoNode({ nodeType: "get_location_info", input: {} }, {
      executePythonRuntime: async () => ({ ok: true, status: "completed", location: { source: "py" } }),
    });
    expect(r.output.location?.source).toBe("py");
  });

  it("passes wrapped {nodeType, input} payload to python bridge (not plain input) for correct device_location branch", async () => {
    let received: any = null;
    const execSpy = async (p: any) => {
      received = p;
      return { ok: true, status: "completed", location: { source: "py-with-nodeType" }, nodeType: "get_location_info" };
    };
    const r = await executeGetLocationInfoNode(
      { nodeType: "get_location_info", input: { coarseLocation: { city: "TestCity" } } },
      { executePythonRuntime: execSpy },
    );
    expect(received).toEqual({ nodeType: "get_location_info", input: { coarseLocation: { city: "TestCity" } } });
    expect(r.output.location?.source).toBe("py-with-nodeType");
  });
});

describe("executeGetLocationInfoNode", () => {
  it("returns caller-provided coarse location, timezone, locale, and governance summaries", async () => {
    const result = await executeGetLocationInfoNode({
      nodeType: "get_location_info",
      input: {
        coarseLocation: {
          countryCode: "cn",
          region: "Shanghai",
          city: "Shanghai",
          source: "manual_override",
        },
        timezone: "Asia/Shanghai",
        locale: "zh-cn",
        authorization: {
          status: "granted",
          grantedBy: "user",
          disclosureText: "Used to render local content and schedule hints.",
        },
        privacy: {
          allowCoarseLocation: true,
          allowTimezone: true,
          allowLocale: true,
          retention: "session",
        },
        context: {
          workflowId: "wf-location-1",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output.status).toBe("completed");
    expect(result.output.location).toEqual({
      coarseLocation: {
        countryCode: "CN",
        region: "Shanghai",
        city: "Shanghai",
        source: "manual_override",
        label: "Shanghai, Shanghai, CN",
      },
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
    });
    expect(result.output.authorization).toEqual({
      status: "granted",
      granted: true,
      grantedBy: "user",
      disclosureText: "Used to render local content and schedule hints.",
    });
    expect(result.output.privacy).toMatchObject({
      precisionLevel: "coarse",
      dataMinimization: "coarse_only",
      exactCoordinatesStored: false,
      exactCoordinatesAllowed: false,
      retention: "session",
    });
    expect(result.output.context).toEqual({
      workflowId: "wf-location-1",
    });
  });

  it("downgrades precise requests to coarse-only output and records warnings", async () => {
    const result = await executeGetLocationInfoNode({
      nodeType: "get_location_info",
      input: {
        coarseLocation: {
          countryCode: "US",
          region: "California",
          city: "San Francisco",
          source: "browser_hint",
        },
        timezone: "America/Los_Angeles",
        locale: "en-US",
        requestedPrecision: "precise",
        authorization: {
          status: "granted",
        },
      },
    });

    expect(result.output.location).toMatchObject({
      coarseLocation: {
        countryCode: "US",
        region: "California",
        city: "San Francisco",
      },
      timezone: "America/Los_Angeles",
      locale: "en-US",
    });
    expect(result.output.privacy).toMatchObject({
      precisionLevel: "precise_blocked",
      deniedFields: ["latitude", "longitude", "accuracyMeters"],
    });
    expect(result.output.warnings).toContain(
      "Precise location access was blocked and reduced to coarse-only output.",
    );
  });

  it("limits output to explicitly supplied fields when authorization is not granted", async () => {
    const result = await executeGetLocationInfoNode({
      nodeType: "get_location_info",
      input: {
        coarseLocation: {
          countryCode: "DE",
          region: "Berlin",
        },
        authorization: {
          status: "denied",
        },
        privacy: {
          allowTimezone: false,
          allowLocale: false,
        },
      },
    });

    expect(result.output.authorization).toEqual({
      status: "denied",
      granted: false,
    });
    expect(result.output.location).toEqual({
      coarseLocation: {
        countryCode: "DE",
        region: "Berlin",
        label: "Berlin, DE",
      },
    });
    expect(result.output.warnings).toContain(
      "Authorization was not granted; output is limited to explicitly provided coarse fields only.",
    );
  });

  it("drops invalid timezone values and records a warning", async () => {
    const result = await executeGetLocationInfoNode({
      nodeType: "get_location_info",
      input: {
        timezone: "Mars/Olympus",
        locale: "fr-fr",
        authorization: {
          status: "granted",
        },
      },
    });

    expect(result.output.location).toEqual({
      locale: "fr-FR",
    });
    expect(result.output.warnings).toContain(
      "timezone was ignored because it was not a valid IANA timezone.",
    );
  });
});
