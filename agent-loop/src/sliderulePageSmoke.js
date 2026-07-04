export function evaluateSliderulePageSmokeEvidence(evidence) {
  const normalized = {
    hasSlideruleRoot: evidence?.hasSlideruleRoot === true,
    hasSlideRuleText: evidence?.hasSlideRuleText === true,
    hasPythonProvenance: evidence?.hasPythonProvenance === true,
    hasPythonBackend: evidence?.hasPythonBackend === true,
    hasCommandInput: evidence?.hasCommandInput === true,
    hasCommandSubmit: evidence?.hasCommandSubmit === true,
    hasCommandInputMutation: evidence?.hasCommandInputMutation === true,
    hasCommandSubmitEnabled: evidence?.hasCommandSubmitEnabled === true,
    hasResetControl: evidence?.hasResetControl === true,
    hasResetClickAcknowledged: evidence?.hasResetClickAcknowledged === true,
    hasReloadRecoveryMarker: evidence?.hasReloadRecoveryMarker === true,
    hasReloadAfterReset: evidence?.hasReloadAfterReset === true,
  };

  const hasCoreInteractiveSurface =
    normalized.hasSlideruleRoot &&
    normalized.hasSlideRuleText &&
    normalized.hasCommandInput &&
    normalized.hasCommandSubmit &&
    normalized.hasResetControl &&
    normalized.hasReloadRecoveryMarker;

  if (!hasCoreInteractiveSurface) {
    return {
      ok: false,
      status: "incomplete",
      reason: "sliderule page is missing required command/reset/reload controls",
      evidence: normalized,
    };
  }

  const hasActionableControls =
    normalized.hasCommandInputMutation &&
    normalized.hasCommandSubmitEnabled &&
    normalized.hasResetClickAcknowledged &&
    normalized.hasReloadAfterReset;
  if (!hasActionableControls) {
    return {
      ok: false,
      status: "incomplete-action",
      reason: "sliderule page controls are present but not actionable",
      evidence: normalized,
    };
  }

  if (!normalized.hasPythonProvenance || !normalized.hasPythonBackend) {
    return {
      ok: false,
      status: "incomplete-python",
      reason: "sliderule page is missing required python provenance/backend markers",
      evidence: normalized,
    };
  }

  return {
    ok: true,
    status: "ready",
    reason: "sliderule page rendered required command/reset/reload controls and python markers",
    evidence: normalized,
  };
}

export function evaluateSlideruleCommandSmokeEvidence(evidence) {
  const pageResult = evaluateSliderulePageSmokeEvidence(evidence);
  const normalized = {
    ...pageResult.evidence,
    hasDriveFullPost: evidence?.hasDriveFullPost === true,
    hasPythonDriveFullResponse: evidence?.hasPythonDriveFullResponse === true,
    hasPythonPublishClosureResponse: evidence?.hasPythonPublishClosureResponse === true,
    hasPythonSkillRuntimeGraphResponse: evidence?.hasPythonSkillRuntimeGraphResponse === true,
    hasCommandSettled: evidence?.hasCommandSettled === true,
    hasPageUsableAfterCommand: evidence?.hasPageUsableAfterCommand === true,
    hasNoFatalConsoleErrors: evidence?.hasNoFatalConsoleErrors === true,
  };

  if (!pageResult.ok) {
    return {
      ...pageResult,
      evidence: normalized,
    };
  }

  const hasCommandClosure =
    normalized.hasDriveFullPost &&
    normalized.hasPythonDriveFullResponse &&
    normalized.hasPythonPublishClosureResponse &&
    normalized.hasPythonSkillRuntimeGraphResponse &&
    normalized.hasCommandSettled &&
    normalized.hasPageUsableAfterCommand &&
    normalized.hasNoFatalConsoleErrors;

  if (!hasCommandClosure) {
    return {
      ok: false,
      status: "incomplete-command",
      reason: "sliderule page command did not close through python /drive-full with runtime evidence and usable page recovery",
      evidence: normalized,
    };
  }

  return {
    ok: true,
    status: "command-ready",
    reason: "sliderule page submitted a real command through python /drive-full, received runtime evidence, and stayed usable",
    evidence: normalized,
  };
}

export function evaluateSlideruleRuntimeSurfaceSmokeEvidence(evidence) {
  const commandResult = evaluateSlideruleCommandSmokeEvidence(evidence);
  const normalized = {
    ...commandResult.evidence,
    hasPublishClosureSurface: evidence?.hasPublishClosureSurface === true,
    hasCrossRuntimeGraphSurface: evidence?.hasCrossRuntimeGraphSurface === true,
  };

  if (!commandResult.ok) {
    return {
      ...commandResult,
      evidence: normalized,
    };
  }

  if (!normalized.hasPublishClosureSurface || !normalized.hasCrossRuntimeGraphSurface) {
    return {
      ok: false,
      status: "incomplete-runtime-surface",
      reason: "sliderule page did not render AppBundle runtime closure surfaces after python /drive-full",
      evidence: normalized,
    };
  }

  return {
    ok: true,
    status: "runtime-surface-ready",
    reason: "sliderule page rendered AppBundle publish closure and cross-runtime graph after python /drive-full",
    evidence: normalized,
  };
}

export function evaluateSliderulePersistenceReplaySmokeEvidence(evidence) {
  const runtimeResult = evaluateSlideruleRuntimeSurfaceSmokeEvidence(evidence);
  const normalized = {
    ...runtimeResult.evidence,
    hasPublishClosureAfterReplay: evidence?.hasPublishClosureAfterReplay === true,
    hasCrossRuntimeGraphAfterReplay: evidence?.hasCrossRuntimeGraphAfterReplay === true,
    hasPageUsableAfterReplay: evidence?.hasPageUsableAfterReplay === true,
  };

  if (!runtimeResult.ok) {
    return {
      ...runtimeResult,
      evidence: normalized,
    };
  }

  const hasReplayClosure =
    normalized.hasPublishClosureAfterReplay &&
    normalized.hasCrossRuntimeGraphAfterReplay &&
    normalized.hasPageUsableAfterReplay;

  if (!hasReplayClosure) {
    return {
      ok: false,
      status: "incomplete-persistence-replay",
      reason: "sliderule page lost AppBundle runtime closure surfaces after reload",
      evidence: normalized,
    };
  }

  return {
    ok: true,
    status: "persistence-replay-ready",
    reason: "sliderule page restored AppBundle runtime closure surfaces after reload",
    evidence: normalized,
  };
}

export function deriveSliderulePageIdentity({ rootText = "", title = "", route = "" } = {}) {
  return /SlideRule|sliderule/i.test(`${rootText}\n${title}\n${route}`);
}

async function clickFirstVisibleEnabled(locator, { reverse = false } = {}) {
  const count = await locator.count().catch(() => 0);
  const indexes = Array.from({ length: count }, (_, index) => index);
  if (reverse) indexes.reverse();
  for (const index of indexes) {
    const target = locator.nth(index);
    const visible = await target.isVisible().catch(() => false);
    const disabled = await target.isDisabled().catch(() => true);
    if (visible && !disabled) {
      await target.click();
      return true;
    }
  }
  return false;
}

export async function collectSliderulePageSmokeEvidence(page) {
  const root = page.locator('[data-testid="sliderule-root"]').first();
  const rootCount = await root.count();
  const rootText = rootCount > 0 ? await root.innerText({ timeout: 3000 }).catch(() => "") : "";
  const title = await page.title().catch(() => "");
  const route = page.url();
  const pythonProvenance = rootCount > 0 ? await root.getAttribute("data-python-provenance").catch(() => "") : "";
  const backend = rootCount > 0 ? await root.getAttribute("data-backend").catch(() => "") : "";
  const commandInput = page.locator('[data-testid="sliderule-composer-input"]').first();
  const composerButtons = page.locator('[data-testid="sliderule-composer-dock"] button');
  const resetControls = page.locator('[data-testid="sliderule-reset-session"]');
  const goalDisplay = page.locator('[data-testid="sliderule-goal-display"]').first();
  const smokeCommand = "SlideRule page controls smoke";

  let hasCommandInputMutation = false;
  let hasCommandSubmitEnabled = false;
  if ((await commandInput.count()) > 0) {
    await commandInput.fill(smokeCommand).catch(() => {});
    const value = await commandInput.inputValue().catch(() => "");
    hasCommandInputMutation = value === smokeCommand;
    const buttonCount = await composerButtons.count();
    for (let index = 0; index < buttonCount; index += 1) {
      const button = composerButtons.nth(index);
      const visible = await button.isVisible().catch(() => false);
      const disabled = await button.isDisabled().catch(() => true);
      if (visible && !disabled) {
        hasCommandSubmitEnabled = true;
        break;
      }
    }
  }

  let hasResetClickAcknowledged = false;
  if ((await resetControls.count()) > 0) {
    const clicked = await clickFirstVisibleEnabled(resetControls).catch(() => false);
    if (clicked) {
      await page
        .waitForFunction(
          () => {
            const input = document.querySelector('[data-testid="sliderule-composer-input"]');
            return input && "value" in input && input.value === "";
          },
          undefined,
          { timeout: 5000 },
        )
        .catch(() => {});
    }
    const valueAfterReset = await commandInput.inputValue().catch(() => "");
    hasResetClickAcknowledged = valueAfterReset === "";
  }
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-testid="sliderule-root"]', { timeout: 10000 }).catch(() => {});
  const hasReloadAfterReset = (await goalDisplay.count().catch(() => 0)) > 0;

  return {
    hasSlideruleRoot: rootCount > 0,
    hasSlideRuleText: deriveSliderulePageIdentity({ rootText, title, route }),
    hasPythonProvenance: Boolean(pythonProvenance),
    hasPythonBackend: /python/i.test(String(backend || "")),
    hasCommandInput: (await commandInput.count()) > 0,
    hasCommandSubmit: (await composerButtons.count()) >= 2,
    hasCommandInputMutation,
    hasCommandSubmitEnabled,
    hasResetControl: (await resetControls.count()) > 0,
    hasResetClickAcknowledged,
    hasReloadRecoveryMarker: (await page.locator('[data-testid="sliderule-goal-display"]').count()) > 0,
    hasReloadAfterReset,
  };
}

export async function collectSlideruleCommandSmokeEvidence(page, options = {}) {
  const commandText = options.commandText || "采购审批应用 command smoke";
  const responseTimeoutMs = options.responseTimeoutMs || 60000;
  const baseEvidence = await collectSliderulePageSmokeEvidence(page);
  const fatalConsoleErrors = [];
  let hasDriveFullPost = false;
  let hasPythonDriveFullResponse = false;
  let hasPythonPublishClosureResponse = false;
  let hasPythonSkillRuntimeGraphResponse = false;

  const onRequest = (request) => {
    if (request.method() === "POST" && /\/api\/sliderule\/drive-full(?:\?|$)/.test(request.url())) {
      hasDriveFullPost = true;
    }
  };
  const onConsole = (message) => {
    if (message.type() === "error") fatalConsoleErrors.push(message.text());
  };
  const onPageError = (error) => {
    fatalConsoleErrors.push(String(error?.message || error));
  };

  page.on("request", onRequest);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    const commandInput = page.locator('[data-testid="sliderule-composer-input"]').first();
    const composerButtons = page.locator('[data-testid="sliderule-composer-dock"] button');
    await commandInput.fill(commandText);

    const responsePromise = page
      .waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/api\/sliderule\/drive-full(?:\?|$)/.test(response.url()),
        { timeout: responseTimeoutMs },
      )
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        hasPythonDriveFullResponse =
          response.ok() && body?.backend === "python" && Boolean(body?.state);
        hasPythonPublishClosureResponse =
          response.ok() && body?.backend === "python" && Boolean(body?.publishClosure);
        hasPythonSkillRuntimeGraphResponse =
          response.ok() &&
          body?.backend === "python" &&
          Array.isArray(body?.skillRuntimeGraph?.edges) &&
          body.skillRuntimeGraph.edges.length > 0;
      })
      .catch(() => {});

    await clickFirstVisibleEnabled(composerButtons, { reverse: true });

    await responsePromise;
    await commandInput.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await page
      .waitForFunction(
        () => {
          const input = document.querySelector('[data-testid="sliderule-composer-input"]');
          return input && "disabled" in input && input.disabled === false;
        },
        undefined,
        { timeout: 30000 },
      )
      .catch(() => {});
    const hasCommandSettled = await commandInput.isEnabled().catch(() => false);
    const hasPageUsableAfterCommand =
      (await page.locator('[data-testid="sliderule-root"]').count().catch(() => 0)) > 0 &&
      (await commandInput.count().catch(() => 0)) > 0 &&
      hasCommandSettled;
    const hasPublishClosureSurface =
      (await page.locator('[data-testid="sliderule-publish-closure"]').count().catch(() => 0)) > 0;
    const hasCrossRuntimeGraphSurface =
      (await page.locator('[data-testid="sliderule-cross-runtime-graph"]').count().catch(() => 0)) > 0;

    return {
      ...baseEvidence,
      hasDriveFullPost,
      hasPythonDriveFullResponse,
      hasPythonPublishClosureResponse,
      hasPythonSkillRuntimeGraphResponse,
      hasCommandSettled,
      hasPageUsableAfterCommand,
      hasNoFatalConsoleErrors: fatalConsoleErrors.length === 0,
      hasPublishClosureSurface,
      hasCrossRuntimeGraphSurface,
    };
  } finally {
    page.off("request", onRequest);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

export async function collectSliderulePersistenceReplaySmokeEvidence(page, options = {}) {
  const commandEvidence = await collectSlideruleCommandSmokeEvidence(page, options);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  await page.waitForSelector('[data-testid="sliderule-root"]', { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-testid="sliderule-composer-input"]', { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-testid="sliderule-publish-closure"]', { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-testid="sliderule-cross-runtime-graph"]', { timeout: 15000 }).catch(() => {});

  const commandInput = page.locator('[data-testid="sliderule-composer-input"]').first();
  const hasPublishClosureAfterReplay =
    (await page.locator('[data-testid="sliderule-publish-closure"]').count().catch(() => 0)) > 0;
  const hasCrossRuntimeGraphAfterReplay =
    (await page.locator('[data-testid="sliderule-cross-runtime-graph"]').count().catch(() => 0)) > 0;
  const hasPageUsableAfterReplay =
    (await page.locator('[data-testid="sliderule-root"]').count().catch(() => 0)) > 0 &&
    (await commandInput.count().catch(() => 0)) > 0 &&
    (await commandInput.isEnabled().catch(() => false));

  return {
    ...commandEvidence,
    hasPublishClosureAfterReplay,
    hasCrossRuntimeGraphAfterReplay,
    hasPageUsableAfterReplay,
  };
}
