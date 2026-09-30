export const OPENAPI_METADATA_URLS = {
  spid: "https://open.api.nexon.com/static/fconline/meta/spid.json",
  season: "https://open.api.nexon.com/static/fconline/meta/seasonid.json",
  position: "https://open.api.nexon.com/static/fconline/meta/spposition.json",
} as const;

export type OpenApiMetadataKind = keyof typeof OPENAPI_METADATA_URLS;

export interface OpenApiMetadataArtifact {
  kind: OpenApiMetadataKind;
  source_url: string;
  observed_at: string;
  raw: Buffer;
}

async function fetchArtifact(
  kind: OpenApiMetadataKind,
  observedAt: string,
  fetchImpl: typeof fetch,
): Promise<OpenApiMetadataArtifact> {
  const source_url = OPENAPI_METADATA_URLS[kind];
  const response = await fetchImpl(source_url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Open API metadata ${kind} request failed: ${response.status} ${response.statusText}`,
    );
  }

  return {
    kind,
    source_url,
    observed_at: observedAt,
    raw: Buffer.from(await response.arrayBuffer()),
  };
}

export async function collectOpenApiMetadata(
  options: {
    observedAt?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<OpenApiMetadataArtifact[]> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new TypeError("observedAt must be an ISO-8601-compatible timestamp");
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  const artifacts: OpenApiMetadataArtifact[] = [];
  for (const kind of ["spid", "season", "position"] as const) {
    artifacts.push(await fetchArtifact(kind, observedAt, fetchImpl));
  }
  return artifacts;
}
