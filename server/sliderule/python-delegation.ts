/**
 * Thin delegation helper for calling the Python SlideRule V5 backend (tws-ai-slide-rule-python).
 *
 * Extracted so that route tests can reliably vi.mock this module (or spy on the export)
 * without global fetch pollution and without same-module lexical binding issues.
 *
 * Used by server/routes/sliderule.ts for V5 capabilities when SLIDERULE_V5_BACKEND=python (default).
 */

export async function callPythonSlideRule(
  pythonBase: string,
  endpoint: string,
  payload: any,
  internalKey: string
) {
  const resp = await fetch(`${pythonBase}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': internalKey,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`python ${endpoint} failed: ${resp.status}`);
  return await resp.json();
}
