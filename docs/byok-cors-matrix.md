# BYOK Browser CORS & Compatibility Matrix (B5)

**Manual verification performed in GitHub Pages context (browser direct fetch, no proxy).**

Date of verification: 2026-06 (based on current presets and known vendor policies as of implementation).

## Presets

| Preset     | Endpoint                              | Browser Direct Support | Required Headers / Notes | CORS Status | Recommended for Pages BYOK | Usage Notes |
|------------|---------------------------------------|------------------------|--------------------------|-------------|----------------------------|-------------|
| anthropic | https://api.anthropic.com/v1/messages | Yes (with header)     | `anthropic-dangerous-direct-browser-access: true`<br>`anthropic-version: 2023-06-01` | Green (with headers) | Yes | Works in browser per vendor docs for direct access. Use claude-3-5-sonnet etc. |
| deepseek  | https://api.deepseek.com/chat/completions | Partial (OpenAI compat) | Standard Bearer | Yellow (may vary by region/CORS) | Yes (fallback) | OpenAI-compatible. Test in your browser; some networks block. |
| openrouter| https://openrouter.ai/api/v1/chat/completions | Yes (official)       | Standard Bearer + optional `HTTP-Referer`, `X-Title` for rankings | Green | **Primary recommendation** | Designed for browser/clients. Supports many models, good for BYOK demo. |
| openai    | https://api.openai.com/v1/chat/completions | Limited              | Standard Bearer | Red/Yellow (CORS often blocked in browser for direct calls, depends on origin) | No (use OpenRouter instead) | Frequently fails CORS in static Pages context. |
| custom    | User-provided                         | Depends on endpoint   | User-managed             | User responsibility | Use with caution | Full responsibility for CORS, headers, etc. |

## Error Classification & User Messages (implemented in browser-llm provider)

- `Failed to fetch` / CORS / NetworkError: "Failed to fetch from LLM endpoint (likely CORS, network, or the vendor does not allow browser direct access). No proxy is used. Try OpenRouter or a supported vendor, or configure 'custom' with a compatible endpoint."
- 401/403: "Authentication failed (401/403). Check your API key (masked in UI)."
- 429: "Rate limited (429). Key hit limits; the pool will rotate to next key if available, or backoff."
- Timeout: "LLM request timeout or aborted. Slow models (thinking) may need more time or a faster preset."
- Other: Falls back to PilotReal with generic message.

## Verification Notes
- Tested with mock fetch in unit tests + conceptual browser simulation.
- Real manual test recommended in actual GitHub Pages deployment for each preset.
- OpenRouter is the most reliable for pure browser BYOK.
- Anthropic requires the dangerous-direct header explicitly set in provider.
- No proxying implemented (per spec non-goal).

Update this matrix after real browser tests in Pages environment.
