import process from "node:process";

import { probeSlideruleBrowserRoute } from "../src/slideruleBrowserProbe.js";
import { resolveSlideruleBrowserProbeOptions } from "../src/slideruleBrowserProbeOptions.js";

const args = new Set(process.argv.slice(2));
const probeOptions = resolveSlideruleBrowserProbeOptions(process.env);

if (args.has("--help") || args.has("--list")) {
  console.log("sliderule-browser-route-probe: optional /agent-loop/sliderule route probe");
  console.log("  SLIDERULE_BROWSER_PROBE_BASE_URL=http://localhost:3000 node agent-loop/scripts/sliderule-browser-route-probe.mjs");
  console.log("  SLIDERULE_BROWSER_PROBE_REQUIRE_PYTHON=1 node agent-loop/scripts/sliderule-browser-route-probe.mjs");
  process.exit(0);
}

const result = await probeSlideruleBrowserRoute(probeOptions);
console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exitCode = 1;
