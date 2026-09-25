// @vitest-environment jsdom
/**
 * 交付判定 hook 把缺项码一起带回来。
 *
 * ⚠ 2026-09-25 隔离真机 sr-20260925070944-QGT6D76EYV：卡片要靠缺项码分辨「没通过」
 *   和「没能跑起来」。hook 把 blockedReasons 丢掉，卡片判据照样全绿（它们直接喂
 *   model），所以这里单独钉住 hook。响应形状照 Python ProjectDeliveryService.status()。
 */
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../project-runtime/project-workspace-client", () => ({
  requestProjectWorkspace: vi.fn(async () =>
    Response.json({
      projectId: "prj-1",
      revision: "prv-1",
      eligible: false,
      profile: {},
      blockedReasons: ["project_verification_environment_blocked"],
      verificationId: "pvr-1",
      releases: [],
      deployment: { status: "not_configured", publicUrl: null },
    })
  ),
}));

import {
  useProjectDeliveryVerdict,
  type DeliveryVerdict,
} from "../project-runtime/delivery-verdict-client";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

it("returns the server's blocked reasons alongside eligibility", async () => {
  let seen: DeliveryVerdict | null = null;
  function Probe() {
    seen = useProjectDeliveryVerdict("prj-1");
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(<Probe />);
  });
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(seen).toEqual({
    eligible: false,
    blockedReasons: ["project_verification_environment_blocked"],
  });
});
