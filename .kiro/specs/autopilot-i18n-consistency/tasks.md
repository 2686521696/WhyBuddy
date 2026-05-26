# Implementation Plan: Autopilot i18n Consistency

## Overview

This plan implements i18n consistency for the Autopilot page across two fronts: (1) frontend legacy display fallback via dictionary expansion and locale wiring, and (2) backend locale-aware prompt generation so LLM-generated content respects the user's locale. The implementation is organized into four segments: Frontend Legacy Display Fallback, Request Contract + Frontend Propagation, Backend Locale Resolution, and Prompt Builders (with discovery). TypeScript throughout, Vitest + fast-check for property-based testing.

## Tasks

- [ ] 1. Frontend Legacy Display Fallback
  - [x] 1.1 Create `client/src/pages/autopilot/right-rail/role-labels.ts` with ROLE_LABELS dictionary and resolveRoleLabel/resolveStageLabel functions
    - Export `ROLE_LABELS: Record<string, Record<AppLocale, string>>` with entries for all known role identifiers (intake-analyst, repo-researcher, route-planner, spec-curator, effect-previewer, prompt-packager, engineering-operator, review-auditor)
    - Export `resolveRoleLabel(roleId: string, locale: AppLocale): string` that returns the localized label or falls back to raw roleId
    - Export `resolveStageLabel(index: number, locale: AppLocale): string` returning `"阶段 N"` for zh-CN and `"Stage N"` for en-US
    - Replace existing hardcoded English-only `STAGE_LABELS` record in RoleStatusStrip with locale-aware version
    - _Requirements: 1.1, 1.2, 1.3, 5.4_

  - [x] 1.2 Wire locale into RoleStatusStrip via `useAppStore(state => state.locale)`
    - Read locale from `useAppStore(state => state.locale)` — this is an explicit exception to the right-rail props-only convention because RoleStatusStrip already consumes `useBlueprintRealtimeStore` directly as a store-consumer observation strip
    - Other right-rail generation call sites (AutopilotRightRail, use-auto-advance) should use `props.locale`, NOT `useAppStore`
    - Call `resolveRoleLabel(roleId, locale)` for each role badge instead of displaying raw roleId strings
    - Call `resolveStageLabel(index, locale)` for stage labels instead of hardcoded English `STAGE_LABELS`
    - _Requirements: 1.1, 1.2, 1.4, 5.4_

  - [x] 1.3 Expand `copyDynamic` dictionary for route names and clarification legacy strings
    - Extend `DYNAMIC_ZH_COPY` in `client/src/pages/autopilot/copy-dynamic.ts`
    - Add Chinese translations for all known route names (e.g., `PrimaryruntimePath`, `ConservativeFallbackPath`)
    - Add Chinese translations for known stage sub-step labels (e.g., `Establish repository-backed executor bridge`, `Select executor-backed runtime path`)
    - Add Chinese translations for known legacy clarification question patterns
    - Preserve existing function signature and fallback behavior (return original text when no match)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.2_

  - [x] 1.4 Audit and expand `blueprintCopy` dictionary coverage for spec tree node terms
    - SpecTreeWorkbench already uses `blueprintCopy(node.title, locale)` at line 363 — do NOT introduce `copyDynamic` here
    - Audit all known LLM-generated node titles that appear in the spec tree and ensure dictionary coverage in `lib/blueprint-copy.ts`
    - Add missing Chinese translations for node terms not yet in the blueprintCopy dictionary
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.5 Wire locale into RouteCard for route name and description localization
    - Read locale from props or `useAppStore(state => state.locale)`
    - Apply `copyDynamic(locale, routeName)` and `copyDynamic(locale, routeDescription)` for display
    - Pass through original text when locale is en-US
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 1.6 Audit ProcessArtifactSplitPanel for remaining hardcoded English labels
    - Component already accepts `locale: AppLocale` as a prop — do NOT wire locale from scratch
    - Identify any remaining hardcoded English lane titles or artifact type labels not yet covered by `t_Helper`
    - Add `t(locale, zhText, enText)` calls for any uncovered labels
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 1.7 Audit and fill gaps in WorkbenchStatusBar locale coverage
    - Component already accepts `locale: AppLocale` as a prop and has locale-aware functions (`resolveTitle`, `resolveSubtitle`, `resolveActionLabels`) — do NOT wire locale from scratch
    - Identify any remaining static labels, status text, or section titles not yet covered by the existing locale-aware functions
    - Add `t(locale, zhText, enText)` calls for any uncovered labels
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 1.8 Wire clarification display fallback with copyDynamic for legacy English questions
    - When locale is zh-CN and clarification questions are legacy (English, generated without locale awareness), apply `copyDynamic(locale, questionText)` before display
    - When locale is zh-CN and backend provides localized questions (Requirement 7), display directly
    - When locale is en-US, display unchanged
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 2. Checkpoint - Ensure all frontend display fallback tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Request Contract + Frontend Propagation
  - [x] 3.1 Add locale field to all relevant request types in `shared/blueprint/contracts.ts`
    - Add `locale?: "zh-CN" | "en-US"` to `BlueprintGenerationRequest` (job creation)
    - Add `locale?: "zh-CN" | "en-US"` to `BlueprintGenerateSpecDocumentsRequest` (spec docs generation)
    - Add `locale?: "zh-CN" | "en-US"` to `BlueprintClarificationSessionRequest` (clarification session — currently has `strategyId` and `templateId` but no locale)
    - Consider defining a shared locale mixin pattern if more request types need it in future
    - _Requirements: 6.2_

  - [x] 3.2 Include locale in AutopilotRoutePage job creation from `useAppStore`
    - Read locale from `useAppStore(state => state.locale)` at the time of API call initiation
    - Include locale in the `BlueprintGenerationRequest` payload passed to `createBlueprintGenerationJob` / `createBlueprintGenerationCompatJob`
    - _Requirements: 6.1, 6.4_

  - [x] 3.3 Include locale in AutopilotRightRail manual spec docs generation
    - Use `props.locale` from `AutopilotRightRailProps` (NOT `useAppStore`) — right-rail components follow props-only convention
    - Include locale in the `BlueprintGenerateSpecDocumentsRequest` payload at the spec docs generation call site
    - _Requirements: 6.1, 6.4_

  - [x] 3.4 Include locale in `use-auto-advance.ts` auto spec docs generation
    - Add `locale: AppLocale` as a parameter to the relevant function/hook (NOT reading `useAppStore` directly inside the hook)
    - The caller (`AutopilotRightRail` or `AutopilotRoutePage`) passes `props.locale` or store locale when invoking the hook
    - Include locale in the `BlueprintGenerateSpecDocumentsRequest` payload for auto-advance spec docs generation
    - _Requirements: 6.1, 6.4_

  - [x] 3.5 Include locale in frontend clarification session creation
    - Locate the frontend call to `createClarificationSession(intakeId, request)` that sends `BlueprintClarificationSessionRequest`
    - Include locale from the page-level locale (via props or `useAppStore` at the page/container boundary)
    - _Requirements: 6.1, 6.4, 9.1_

  - [x]* 3.6 Write unit tests for locale propagation in API calls
    - Verify job creation request payload includes locale from store
    - Verify spec docs request payload includes locale from store
    - Verify clarification session request payload includes locale from store
    - Verify locale is read at call time (not stale)
    - _Requirements: 6.1, 6.4_

- [x] 4. Checkpoint - Ensure all contract and propagation tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Backend Locale Resolution
  - [x] 5.1 Create shared `resolveRequestLocale` utility in `server/routes/blueprint.ts`
    - Implement `resolveRequestLocale(body: unknown): "zh-CN" | "en-US"` that returns "zh-CN" only when explicitly set, defaults to "en-US" for backward compatibility
    - Handle missing, undefined, null, or invalid locale values gracefully
    - _Requirements: 6.3_

  - [x] 5.2 Wire `resolveRequestLocale` into generation job route handler
    - In the POST handler for blueprint generation jobs, call `resolveRequestLocale(req.body)` and pass the resolved locale to downstream prompt/generation functions
    - _Requirements: 7.5_

  - [x] 5.3 Wire `resolveRequestLocale` into spec documents route handler
    - In the handler for spec documents generation, call `resolveRequestLocale(req.body)` and pass the resolved locale downstream
    - _Requirements: 7.5_

  - [x] 5.4 Wire `resolveRequestLocale` into clarification route handler
    - Update `parseClarificationSessionRequest` (in `server/routes/blueprint.ts` around line 2478) to extract the locale field from the request body
    - Pass resolved locale from the clarification route handler to `createClarificationSession` → `generateClarificationQuestionsWithLlm`
    - _Requirements: 7.3, 7.5_

  - [x] 5.5 Pass resolved locale to all downstream prompt/generation functions
    - Ensure every prompt builder invocation receives the resolved locale parameter
    - Verify no prompt builder path is missed (routeset, spec tree, spec docs, clarification)
    - _Requirements: 7.5_

- [x] 6. Checkpoint - Ensure all backend locale resolution tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Prompt Builders (with discovery)
  - [x] 7.1 Discovery: locate all real LLM generation functions and their parameter signatures
    - Identify the actual route set generator function(s) and their call signatures
    - Identify the agent-driven route set generator (if separate)
    - Identify the spec tree selection/generation path function(s)
    - Identify the spec documents generation function(s)
    - Identify the clarification questions generation function (`generateClarificationQuestionsWithLlm`)
    - Produce a discovery table documenting each flow:
      | Flow | Function | Request type | Locale source | Prompt/system message location |
      At minimum cover: route set legacy generator, agent-driven route set generator, select route / spec tree generation path, spec documents generation path, clarification question path
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 7.2 Inject locale into route set generator prompt builder
    - Add locale parameter to the route set generator function signature
    - When locale is zh-CN, inject Chinese-language system instruction directing LLM to generate route names and descriptions in Chinese
    - When locale is en-US, use existing English prompt unchanged
    - _Requirements: 7.1, 7.4_

  - [x] 7.3 Inject locale into spec tree generation path
    - Add locale parameter to the spec tree generation function signature
    - When locale is zh-CN, inject Chinese-language system instruction directing LLM to generate node names in Chinese
    - When locale is en-US, use existing English prompt unchanged
    - _Requirements: 7.2, 7.4_

  - [x] 7.4 Inject locale into spec documents generation
    - Add locale parameter to the spec documents generation function signature
    - When locale is zh-CN, inject Chinese-language system instruction directing LLM to generate document content in Chinese
    - When locale is en-US, use existing English prompt unchanged
    - _Requirements: 7.2, 7.4_

  - [x] 7.5 Inject locale into clarification questions generation
    - Modify `generateClarificationQuestionsWithLlm` to accept and use the request locale parameter instead of hardcoding language
    - When locale is zh-CN, generate clarification questions in Chinese
    - When locale is en-US, generate clarification questions in English
    - _Requirements: 7.3, 9.1_

- [x] 8. Checkpoint - Ensure all prompt builder tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Property Tests and Non-Regression
  - [x]* 9.1 Write property tests for resolveRoleLabel (Properties 1 & 2)
    - **Property 1: Role label resolver locale symmetry** — For any roleId in ROLE_LABELS and any valid locale, resolveRoleLabel returns the dictionary label and the result is NOT equal to the raw roleId (since dictionary entries provide human-readable forms)
    - **Property 2: Role label resolver fallback passthrough** — For any string NOT in ROLE_LABELS, resolveRoleLabel returns the input unchanged
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x]* 9.2 Write property test for resolveStageLabel (Property 6)
    - **Property 6: Stage label locale correctness** — For any valid stage index (0–5), zh-CN returns string starting with "阶段", en-US returns string starting with "Stage"
    - **Validates: Requirements 5.4**

  - [x]* 9.3 Write property tests for copyDynamic (Properties 3, 4, 5)
    - **Property 3: copyDynamic en-US passthrough** — For any string, copyDynamic("en-US", value) returns value unchanged
    - **Property 4: copyDynamic zh-CN dictionary hit** — For any key in DYNAMIC_ZH_COPY, copyDynamic("zh-CN", key) returns DYNAMIC_ZH_COPY[key] (the corresponding Chinese translation value from the dictionary)
    - **Property 5: copyDynamic zh-CN fallback passthrough** — For any string not matching dictionary or regex, copyDynamic("zh-CN", value) returns value unchanged
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 8.4**

  - [x]* 9.4 Write property test for resolveRequestLocale (Property 7)
    - **Property 7: Locale resolution defaults to en-US** — For any payload where locale is missing, undefined, null, or not "zh-CN", resolveRequestLocale returns "en-US"
    - **Validates: Requirements 6.3**

  - [x]* 9.5 Write property test for prompt builder locale (Property 8)
    - **Property 8: Prompt builder locale determines system message language** — For zh-CN, systemMessage contains Chinese characters; for en-US, systemMessage does not contain Chinese characters
    - **Validates: Requirements 7.1, 7.2, 7.4**

  - [x] 9.6 Non-regression verification
    - Confirm no locale-related imports added to Scene3D or PetWorkers components
    - Confirm `t_Helper` signature remains `(locale: AppLocale, zh: string, en: string) => string`
    - Confirm no `copyDynamic` or `blueprintCopy` calls wrap `console.log` arguments
    - Confirm API endpoint string constants remain unchanged
    - Confirm `useAppStore` is the locale source (not a separate `useLocaleStore`)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 10. Final checkpoint - Ensure all tests pass and docs are in sync
  - Ensure all tests pass, ask the user if questions arise.
  - Verify `requirements.md` does not reference "SpecTreeWorkbench + copyDynamic" (should be blueprintCopy)
  - Verify `design.md` documents all three request types with locale (not just `BlueprintGenerationRequest`)
  - Verify `design.md` Property 4 does not require value to differ from key
  - Verify tasks/design/requirements are consistent on `copyDynamic` vs `blueprintCopy` boundary

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `t_Helper` function signature remains unchanged throughout — only new call sites are added
- `copyDynamic` and `blueprintCopy` coexist as separate dictionaries serving different component trees (no consolidation in this spec)
- Backend defaults to `"en-US"` when locale is missing for full backward compatibility
- **Locale read boundary**: `useAppStore(state => state.locale)` is read at the page/container level (`AutopilotRoutePage`). Right-rail components receive locale via `props.locale`. Right-rail hooks receive locale as a function parameter. `RoleStatusStrip` is the only explicit exception (already a direct store consumer).
- SpecTreeWorkbench already uses `blueprintCopy(node.title, locale)` — task 1.4 expands dictionary coverage, not wiring
- ProcessArtifactSplitPanel already accepts `locale: AppLocale` prop — task 1.6 audits for gaps only
- WorkbenchStatusBar already has locale-aware functions — task 1.7 audits for remaining gaps only
- Task 7.1 (discovery) is critical because there is no single prompt builder entry point; multiple LLM generation paths exist; output must be a structured table
- Property 4 asserts `copyDynamic('zh-CN', key) === DYNAMIC_ZH_COPY[key]` without requiring the translation to differ from the key
- LLM fallback is best-effort for known legacy strings only; free-text content (route descriptions, clarification questions) cannot be fully covered by dictionaries

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.5", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 2, "tasks": ["1.6", "1.7", "1.8", "3.6", "5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 4, "tasks": ["5.5", "7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5"] },
    { "id": 7, "tasks": ["9.6"] }
  ]
}
```
