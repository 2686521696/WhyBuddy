import process from "node:process";

import { probeSlideruleBrowserRoute } from "../src/slideruleBrowserProbe.js";

const args = new Set(process.argv.slice(2));
const baseUrl = process.env.SLIDERULE_BROWSER_PROBE_BASE_URL || "http://localhost:3000";

if (args.has("--help") || args.has("--list")) {
  console.log("sliderule-browser-route-probe: optional /agent-loop/sliderule route probe");
  console.log("  SLIDERULE_BROWSER_PROBE_BASE_URL=http://localhost:3000 node agent-loop/scripts/sliderule-browser-route-probe.mjs");
  process.exit(0);
}

const result = await probeSlideruleBrowserRoute({ baseUrl });
console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exitCode = 1;
