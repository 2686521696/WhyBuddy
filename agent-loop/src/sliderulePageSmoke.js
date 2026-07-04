export function evaluateSliderulePageSmokeEvidence(evidence) {
  const normalized = {
    hasSlideruleRoot: evidence?.hasSlideruleRoot === true,
    hasSlideRuleText: evidence?.hasSlideRuleText === true,
    hasPythonProvenance: evidence?.hasPythonProvenance === true,
    hasPythonBackend: evidence?.hasPythonBackend === true,
    hasCommandInput: evidence?.hasCommandInput === true,
    hasCommandSubmit: evidence?.hasCommandSubmit === true,
    hasResetControl: evidence?.hasResetControl === true,
    hasReloadRecoveryMarker: evidence?.hasReloadRecoveryMarker === true,
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

  return {
    hasSlideruleRoot: rootCount > 0,
    hasSlideRuleText: deriveSliderulePageIdentity({ rootText, title, route }),
    hasPythonProvenance: Boolean(pythonProvenance),
    hasPythonBackend: /python/i.test(String(backend || "")),
    hasCommandInput: (await commandInput.count()) > 0,
    hasCommandSubmit: (await composerButtons.count()) >= 2,
    hasResetControl: (await page.locator('[data-testid="sliderule-reset-session"]').count()) > 0,
    hasReloadRecoveryMarker: (await page.locator('[data-testid="sliderule-goal-display"]').count()) > 0,
  };
}
