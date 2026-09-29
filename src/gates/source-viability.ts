export const PRICE_SEMANTICS = [
  "MARKET_REFERENCE_PRICE",
  "TRADE_PRICE",
  "UNKNOWN",
] as const;

export const AUTOMATION_DECISIONS = [
  "ALLOWED",
  "MANUAL_ONLY",
  "UNKNOWN",
  "REJECTED",
] as const;

export type PriceSemantics = (typeof PRICE_SEMANTICS)[number];
export type AutomationDecision = (typeof AUTOMATION_DECISIONS)[number];
export type Gate0ASourceStatus =
  | "READY_AUTOMATION"
  | "READY_MANUAL"
  | "INCOMPLETE"
  | "REJECTED";
export type Gate0AStatus = "READY_AUTOMATION" | "READY_MANUAL" | "BLOCKED";

export interface SourceViabilityEvidence {
  source_id: string;
  purpose: string;
  source_url: string;
  policy_url: string;
  policy_checked_at: string;
  access_method: string;
  native_granularity: string;
  history_span: string;
  price_semantics: PriceSemantics;
  automation_decision: AutomationDecision;
  decision_reason: string;
  evidence_hash: string;
}

export interface SourceViabilityDocument {
  schema_version: 1;
  evidence: SourceViabilityEvidence[];
}

export interface Gate0ASourceResult {
  source_id: string;
  status: Gate0ASourceStatus;
  blockers: string[];
  automation_decision: AutomationDecision;
}

export interface Gate0ASummary {
  status: Gate0AStatus;
  sources: Gate0ASourceResult[];
}

const UNKNOWN = "UNKNOWN";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${context}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  context: string,
): T {
  const value = readRequiredString(record, key, context);
  if (!allowed.includes(value as T)) {
    throw new TypeError(
      `${context}.${key} must be one of: ${allowed.join(", ")}`,
    );
  }
  return value as T;
}

function assertHttpUrlOrUnknown(value: string, field: string): void {
  if (value === UNKNOWN) {
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an absolute HTTP(S) URL or UNKNOWN`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${field} must be an absolute HTTP(S) URL or UNKNOWN`);
  }
}

function assertTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
}

function assertEvidenceHash(value: string, field: string): void {
  if (value === UNKNOWN) {
    return;
  }

  if (!/^sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new TypeError(`${field} must be sha256:<64 hex chars> or UNKNOWN`);
  }
}

export function parseSourceViabilityDocument(
  value: unknown,
): SourceViabilityDocument {
  if (!isRecord(value)) {
    throw new TypeError("document must be an object");
  }

  if (value.schema_version !== 1) {
    throw new TypeError("document.schema_version must be 1");
  }

  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    throw new TypeError("document.evidence must be a non-empty array");
  }

  const evidence = value.evidence.map((item, index) => {
    const context = `document.evidence[${index}]`;
    if (!isRecord(item)) {
      throw new TypeError(`${context} must be an object`);
    }

    const source_url = readRequiredString(item, "source_url", context);
    const policy_url = readRequiredString(item, "policy_url", context);
    const policy_checked_at = readRequiredString(
      item,
      "policy_checked_at",
      context,
    );

    assertHttpUrlOrUnknown(source_url, `${context}.source_url`);
    assertHttpUrlOrUnknown(policy_url, `${context}.policy_url`);
    assertTimestamp(policy_checked_at, `${context}.policy_checked_at`);
    const evidence_hash = readRequiredString(item, "evidence_hash", context);
    assertEvidenceHash(evidence_hash, `${context}.evidence_hash`);

    return {
      source_id: readRequiredString(item, "source_id", context),
      purpose: readRequiredString(item, "purpose", context),
      source_url,
      policy_url,
      policy_checked_at,
      access_method: readRequiredString(item, "access_method", context),
      native_granularity: readRequiredString(
        item,
        "native_granularity",
        context,
      ),
      history_span: readRequiredString(item, "history_span", context),
      price_semantics: readEnum(
        item,
        "price_semantics",
        PRICE_SEMANTICS,
        context,
      ),
      automation_decision: readEnum(
        item,
        "automation_decision",
        AUTOMATION_DECISIONS,
        context,
      ),
      decision_reason: readRequiredString(item, "decision_reason", context),
      evidence_hash,
    } satisfies SourceViabilityEvidence;
  });

  const ids = new Set<string>();
  for (const item of evidence) {
    if (ids.has(item.source_id)) {
      throw new TypeError(`duplicate source_id: ${item.source_id}`);
    }
    ids.add(item.source_id);
  }

  return { schema_version: 1, evidence };
}

function unresolvedFields(source: SourceViabilityEvidence): string[] {
  const fields: Array<keyof SourceViabilityEvidence> = [
    "source_url",
    "policy_url",
    "access_method",
    "native_granularity",
    "history_span",
    "price_semantics",
    "evidence_hash",
  ];

  return fields.filter((field) => source[field] === UNKNOWN);
}

export function evaluateGate0A(
  document: SourceViabilityDocument,
): Gate0ASummary {
  const sources = document.evidence.map((source): Gate0ASourceResult => {
    if (source.automation_decision === "REJECTED") {
      return {
        source_id: source.source_id,
        status: "REJECTED",
        blockers: [source.decision_reason],
        automation_decision: source.automation_decision,
      };
    }

    const unresolved = unresolvedFields(source);
    if (source.automation_decision === "UNKNOWN") {
      unresolved.push("automation_decision");
    }

    if (unresolved.length > 0) {
      return {
        source_id: source.source_id,
        status: "INCOMPLETE",
        blockers: unresolved.map((field) => `${field}=UNKNOWN`),
        automation_decision: source.automation_decision,
      };
    }

    return {
      source_id: source.source_id,
      status:
        source.automation_decision === "ALLOWED"
          ? "READY_AUTOMATION"
          : "READY_MANUAL",
      blockers: [],
      automation_decision: source.automation_decision,
    };
  });

  let status: Gate0AStatus = "BLOCKED";
  if (sources.some((source) => source.status === "READY_AUTOMATION")) {
    status = "READY_AUTOMATION";
  } else if (sources.some((source) => source.status === "READY_MANUAL")) {
    status = "READY_MANUAL";
  }

  return { status, sources };
}
