import type {
  ImageSearchNodeExecutionRequest,
  ImageSearchNodeExecutionResult,
  ImageSearchNodeInput,
  ImageSearchNodeType,
  WebAigcImageSearchMode,
  WebAigcImageSearchRequest,
  WebAigcImageSearchResponse,
  WebAigcImageSearchResultItem,
  WebAigcReferenceImageInput,
  WebAigcSearchProvenance,
  WebAigcSearchStatus,
} from "../../../shared/web-aigc-image-search.js";

export interface ImageSearchNodeAdapterDeps {
  executeImageSearch?: (
    request: WebAigcImageSearchRequest,
  ) => Promise<WebAigcImageSearchResponse>;
  now?: () => number;
}

const DEFAULT_IMAGE_CANDIDATES: WebAigcImageSearchResultItem[] = [
  {
    imageId: "img-cube-office-dashboard",
    title: "Cube Office Dashboard Illustration",
    summary: "Warm-toned product dashboard mockup with charts, pets mascot, and workspace panels.",
    previewUrl: "https://example.test/image-search/cube-office-dashboard-preview.jpg",
    sourceUrl: "https://example.test/image-search/cube-office-dashboard",
    source: "mock-image-catalog",
    tags: ["dashboard", "workspace", "office", "charts", "illustration"],
    availability: "available",
    score: 0.91,
    matchedBy: ["query", "tags"],
  },
  {
    imageId: "img-pet-avatar-grid",
    title: "Pet Avatar Reference Grid",
    summary: "A grid of colorful pet avatars suitable for onboarding, profile cards, and playful assistant scenes.",
    previewUrl: "https://example.test/image-search/pet-avatar-grid-preview.jpg",
    sourceUrl: "https://example.test/image-search/pet-avatar-grid",
    source: "mock-image-catalog",
    tags: ["avatar", "pets", "characters", "playful", "profile"],
    availability: "preview_only",
    score: 0.83,
    matchedBy: ["tags", "reference"],
  },
  {
    imageId: "img-night-operations-room",
    title: "Night Operations Room",
    summary: "Large-screen monitoring room with agents, telemetry walls, and blue ambient lighting.",
    previewUrl: "https://example.test/image-search/night-operations-room-preview.jpg",
    sourceUrl: "https://example.test/image-search/night-operations-room",
    source: "mock-image-catalog",
    tags: ["monitoring", "operations", "agents", "telemetry", "night"],
    availability: "unavailable",
    score: 0.78,
    matchedBy: ["query"],
  },
  {
    imageId: "img-mobile-chat-handshake",
    title: "Mobile Chat Handoff Scene",
    summary: "Mobile messaging interface with card previews, handoff confirmation, and assistant follow-up.",
    previewUrl: "https://example.test/image-search/mobile-chat-handoff-preview.jpg",
    sourceUrl: "https://example.test/image-search/mobile-chat-handoff",
    source: "mock-image-catalog",
    tags: ["mobile", "chat", "handoff", "cards", "assistant"],
    availability: "available",
    score: 0.8,
    matchedBy: ["query", "reference"],
  },
];

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function normalizeMode(value: unknown): WebAigcImageSearchMode {
  return value === "hybrid" ? "hybrid" : "mock";
}

function normalizeTopK(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 4;
  }

  return Math.max(1, Math.min(8, Math.floor(value)));
}

function normalizeMinScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.15;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeStatus(
  response: WebAigcImageSearchResponse,
  results: WebAigcImageSearchResultItem[],
): WebAigcSearchStatus {
  if (
    response.status === "completed" ||
    response.status === "degraded" ||
    response.status === "empty" ||
    response.status === "error" ||
    response.status === "permission_denied"
  ) {
    return response.status;
  }

  if (response.ok === false && response.error?.code === "permission_denied") {
    return "permission_denied";
  }

  if (response.ok === false || response.error) {
    return "error";
  }

  if (results.length === 0) {
    return "empty";
  }

  return response.degraded ? "degraded" : "completed";
}

function buildDefaultProvenance(
  response: WebAigcImageSearchResponse,
): WebAigcSearchProvenance | undefined {
  if (!response.query) {
    return undefined;
  }

  return {
    provider: "fake",
    source: "fake-image-search",
    query: response.query,
  };
}

function resolveProviderAuditId(context: Record<string, unknown>): string | undefined {
  const provenance = normalizeObject(context.provenance);
  const providerClosure = normalizeObject(context.providerClosure);
  const providerClosureMetadata = normalizeObject(providerClosure.metadata);

  return (
    normalizeString(provenance.auditId) ||
    normalizeString(providerClosureMetadata.auditId)
  );
}

function normalizeReferenceImage(value: unknown): WebAigcReferenceImageInput | undefined {
  const record = normalizeObject(value);
  const description = normalizeString(record.description);
  const tags = normalizeStringArray(record.tags);
  const previewUrl = normalizeString(record.previewUrl);
  const sourceHint = normalizeString(record.sourceHint);

  if (!description && tags.length === 0 && !previewUrl && !sourceHint) {
    return undefined;
  }

  return {
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(sourceHint ? { sourceHint } : {}),
  };
}

function tokenize(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .toLowerCase()
    .split(/[\s,.;:/\\|_\-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeRequest(input: ImageSearchNodeInput | undefined): WebAigcImageSearchRequest {
  const query = normalizeString(input?.query);
  const tags = normalizeStringArray(input?.tags);
  const referenceImage = normalizeReferenceImage(input?.referenceImage);

  if (!query && tags.length === 0 && !referenceImage?.description && (referenceImage?.tags?.length ?? 0) === 0) {
    throw new Error("Image search node input requires query, tags, or referenceImage description.");
  }

  return {
    ...(query ? { query } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(referenceImage ? { referenceImage } : {}),
    options: {
      topK: normalizeTopK(input?.options?.topK),
      minScore: normalizeMinScore(input?.options?.minScore),
      mode: normalizeMode(input?.options?.mode),
    },
  };
}

function buildSearchQuery(request: WebAigcImageSearchRequest): string {
  const segments = [
    request.query,
    ...(request.tags ?? []),
    request.referenceImage?.description,
    ...(request.referenceImage?.tags ?? []),
  ].filter((segment): segment is string => Boolean(segment));

  return segments.join(" | ");
}

function scoreCandidate(
  candidate: WebAigcImageSearchResultItem,
  request: WebAigcImageSearchRequest,
): WebAigcImageSearchResultItem | undefined {
  const queryTokens = tokenize(request.query);
  const tagTokens = normalizeStringArray(request.tags);
  const referenceTokens = [
    ...tokenize(request.referenceImage?.description),
    ...normalizeStringArray(request.referenceImage?.tags),
  ];

  const haystack = [
    candidate.title,
    candidate.summary,
    candidate.source,
    ...candidate.tags,
  ]
    .join(" ")
    .toLowerCase();

  const matchedBy: Array<"query" | "tags" | "reference"> = [];
  let score = 0;

  const queryHits = queryTokens.filter((term) => haystack.includes(term)).length;
  if (queryHits > 0) {
    matchedBy.push("query");
    score += queryHits / Math.max(queryTokens.length, 1) * 0.55;
  }

  const tagHits = tagTokens.filter((term) => candidate.tags.includes(term)).length;
  if (tagHits > 0) {
    matchedBy.push("tags");
    score += tagHits / Math.max(tagTokens.length, 1) * 0.3;
  }

  const referenceHits = referenceTokens.filter((term) => haystack.includes(term)).length;
  if (referenceHits > 0) {
    matchedBy.push("reference");
    score += referenceHits / Math.max(referenceTokens.length, 1) * 0.25;
  }

  if (matchedBy.length === 0) {
    return undefined;
  }

  return {
    ...candidate,
    score: Number((Math.min(1, score)).toFixed(4)),
    matchedBy,
  };
}

function buildMockImageSearchResponse(
  request: WebAigcImageSearchRequest,
): WebAigcImageSearchResponse {
  const normalizedCandidates = DEFAULT_IMAGE_CANDIDATES
    .map((candidate) => scoreCandidate(candidate, request))
    .filter((candidate): candidate is WebAigcImageSearchResultItem => Boolean(candidate))
    .sort((left, right) => right.score - left.score);

  const minScore = request.options?.minScore ?? 0.15;
  const topK = request.options?.topK ?? 4;
  const filtered = normalizedCandidates.filter((candidate) => candidate.score >= minScore);
  const selected = filtered.length > 0 ? filtered.slice(0, topK) : DEFAULT_IMAGE_CANDIDATES.slice(0, topK).map((candidate) => ({
    ...candidate,
    score: 0.1,
    matchedBy: [],
  }));

  const warnings: string[] = [];
  let degraded = false;
  let fallbackReason: string | undefined;

  if (filtered.length === 0) {
    degraded = true;
    fallbackReason = "No strong image matches were found; returned fallback catalog previews.";
    warnings.push("候选图片与输入相似度不足，已返回默认预览集合。");
  }

  if (selected.some((item) => item.availability !== "available")) {
    warnings.push("部分图片仅支持预览或当前源不可用，请根据 availability 字段做下游处理。");
  }

  return {
    query: buildSearchQuery(request),
    normalized: {
      ...(request.query ? { textQuery: request.query } : {}),
      tags: request.tags ?? [],
      ...(request.referenceImage?.description
        ? { referenceDescription: request.referenceImage.description }
        : {}),
      referenceTags: request.referenceImage?.tags ?? [],
    },
    results: selected,
    totalCandidates: selected.length,
    degraded,
    ...(fallbackReason ? { fallbackReason } : {}),
    warnings,
    mode: request.options?.mode ?? "mock",
    status: selected.length === 0 ? "empty" : degraded ? "degraded" : "completed",
    provenance: {
      provider: "fake",
      source: "fake-image-search",
      query: buildSearchQuery(request),
    },
  };
}

function buildSourceDomains(results: WebAigcImageSearchResultItem[]): string[] {
  return Array.from(
    new Set(
      results
        .map((item) => {
          try {
            return new URL(item.sourceUrl).hostname;
          } catch {
            return item.source;
          }
        })
        .filter(Boolean),
    ),
  );
}

export function isImageSearchNodeType(value: unknown): value is ImageSearchNodeType {
  return value === "image_search";
}

export async function executeImageSearchNode(
  request: ImageSearchNodeExecutionRequest,
  deps: ImageSearchNodeAdapterDeps = {},
): Promise<ImageSearchNodeExecutionResult> {
  if (!isImageSearchNodeType(request.nodeType)) {
    throw new Error("Unsupported image_search node type.");
  }

  const normalizedRequest = normalizeRequest(request.input);
  const inputContext = normalizeObject(request.input?.context);
  // consume python provider closure summary (if present) to decide posture and preserve metadata
  const providerClosure = (inputContext as Record<string, unknown>).providerClosure;
  const context: Record<string, unknown> = {
    ...inputContext,
    ...(providerClosure ? { providerClosure } : {}),
  };
  let response: WebAigcImageSearchResponse;

  try {
    if (deps.executeImageSearch) {
      response = await deps.executeImageSearch(normalizedRequest);
    } else {
      response = buildMockImageSearchResponse(normalizedRequest);
    }
  } catch (error) {
    const fallback = buildMockImageSearchResponse(normalizedRequest);
    response = {
      ...fallback,
      // 显式覆盖 status：mock 兜底自身可能是 "completed"，但执行器异常的
      // 回退必须如实呈现 degraded（normalizeStatus 优先信任显式 status，
      // 不覆盖会把降级吞成 completed）。
      status: "degraded",
      degraded: true,
      fallbackReason: `Image search backend unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
      warnings: [
        ...fallback.warnings,
        "图片搜索执行器异常，已自动回退到本地候选图片集合。",
      ],
    };
  }

  const results = Array.isArray(response.results) ? response.results : [];
  const status = normalizeStatus(response, results);
  const baseProvenance = response.provenance ?? buildDefaultProvenance(response);
  const providerAuditId = resolveProviderAuditId(context);
  const provenance = baseProvenance
    ? {
      ...baseProvenance,
      ...(providerAuditId ? { auditId: providerAuditId } : {}),
    }
    : undefined;
  const result = {
    ...response,
    results,
    totalCandidates:
      typeof response.totalCandidates === "number" && Number.isFinite(response.totalCandidates)
        ? response.totalCandidates
        : Array.isArray(response.results)
          ? response.results.length
          : 0,
    warnings: Array.isArray(response.warnings) ? response.warnings : [],
    mode: normalizeMode(response.mode),
    status,
    ...(response.error ? { error: response.error } : {}),
    ...(provenance ? { provenance } : {}),
  };

  return {
    ok: status !== "error" && status !== "permission_denied",
    nodeType: "image_search",
    output: {
      ...result,
      result,
      previews: result.results.map((item) => item.previewUrl),
      sourceDomains: buildSourceDomains(result.results),
      availabilitySummary: {
        available: result.results.filter((item) => item.availability === "available").length,
        previewOnly: result.results.filter((item) => item.availability === "preview_only").length,
        unavailable: result.results.filter((item) => item.availability === "unavailable").length,
      },
      context,
    },
  };
}
