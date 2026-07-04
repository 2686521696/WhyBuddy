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

export function deriveSliderulePageIdentity({ rootText = "", title = "", route = "" } = {}) {
  return /SlideRule|sliderule/i.test(`${rootText}\n${title}\n${route}`);
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
  const resetControl = page.locator('[data-testid="sliderule-reset-session"]').first();
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
  if ((await resetControl.count()) > 0) {
    await resetControl.click().catch(() => {});
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
    hasResetControl: (await resetControl.count()) > 0,
    hasResetClickAcknowledged,
    hasReloadRecoveryMarker: (await page.locator('[data-testid="sliderule-goal-display"]').count()) > 0,
    hasReloadAfterReset,
  };
}
