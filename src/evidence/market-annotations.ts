export const MARKET_EVENT_TYPES = [
  "MAINTENANCE_NOTICE",
  "MAINTENANCE",
  "UPDATE_NOTICE",
  "GAMEPLAY_PATCH",
  "TRAIT_CHANGE",
  "NEW_CLASS",
  "EVENT_START",
  "EVENT_END",
  "BURNING",
  "PAID_PRODUCT_START",
  "PAID_PRODUCT_END",
  "MEMBERSHIP_RESET",
  "BP_SUPPLY",
  "PLAYER_SUPPLY",
  "FEE_CHANGE",
  "MARKET_RULE_CHANGE",
  "INCIDENT",
  "COMPENSATION",
  "UNKNOWN_SHOCK",
] as const;

export const REWARD_TYPES = [
  "BP",
  "FC",
  "MC",
  "PLAYER_PACK",
  "CHOICE_PACK",
  "EXCHANGE_TOKEN",
  "OTHER_ITEM",
] as const;

export const EXPOSURE_TYPES = ["DIRECT", "INDIRECT"] as const;

export type MarketEventType = (typeof MARKET_EVENT_TYPES)[number];
export type RewardType = (typeof REWARD_TYPES)[number];
export type ExposureType = (typeof EXPOSURE_TYPES)[number];

export interface MarketEventAnnotation {
  event_id: string;
  event_type: MarketEventType;
  title: string;
  announced_at: string | null;
  effective_at: string | null;
  ended_at: string | null;
  first_observed_at: string | null;
  source_url: string;
  confidence: number;
  notes: string | null;
}

export interface ProductRewardAnnotation {
  reward_id: string;
  reward_type: RewardType;
  quantity: number;
  probability: number | null;
  class_filter: string[];
  grade_min: number | null;
  grade_max: number | null;
  ovr_min: number | null;
  top_price_n: number | null;
}

export interface ProductAnnotation {
  product_id: string;
  name: string;
  sale_start: string;
  sale_end: string | null;
  price: number;
  currency: string;
  purchase_limit: number | null;
  channel: string;
  source_url: string;
  notes: string | null;
  rewards: ProductRewardAnnotation[];
}

export interface ExposureAnnotation {
  exposure_id: string;
  event_id: string | null;
  product_id: string | null;
  instrument_id: string;
  exposure_type: ExposureType;
  valid_from: string;
  valid_to: string | null;
  source: string;
  confidence: number;
}

export interface MarketAnnotationDocument {
  schema_version: 1;
  annotated_at: string;
  events: MarketEventAnnotation[];
  products: ProductAnnotation[];
  exposures: ExposureAnnotation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
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

function nullableString(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${context}.${key} must be null or a non-empty string`);
  }
  return value.trim();
}

function identifier(value: string, field: string): string {
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) {
    throw new TypeError(`${field} contains unsupported characters`);
  }
  return value;
}

function timestamp(value: string, field: string): string {
  if (!/T/.test(value)) {
    throw new TypeError(`${field} must include a time and timezone`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${field} must include an explicit timezone`);
  }
  return parsed.toISOString();
}

function nullableTimestamp(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string | null {
  const value = nullableString(record, key, context);
  return value === null ? null : timestamp(value, `${context}.${key}`);
}

function requiredTimestamp(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  return timestamp(requiredString(record, key, context), `${context}.${key}`);
}

function sourceUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${field} must use http or https`);
  }
  return parsed.toString();
}

function finiteNumber(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${context}.${key} must be a finite number`);
  }
  return value;
}

function nullableInteger(
  record: Record<string, unknown>,
  key: string,
  context: string,
  minimum: number,
  maximum?: number,
): number | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new TypeError(`${context}.${key} must be null or a valid integer`);
  }
  return value;
}

function confidenceField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = finiteNumber(record, key, context);
  if (value < 0 || value > 1) {
    throw new TypeError(`${context}.${key} must be between 0 and 1`);
  }
  return value;
}

function parseEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function assertUnique(ids: string[], field: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new TypeError(`duplicate ${field}: ${id}`);
    }
    seen.add(id);
  }
}

function parseEvent(value: unknown, index: number): MarketEventAnnotation {
  const context = `events[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const event = {
    event_id: identifier(requiredString(value, "event_id", context), `${context}.event_id`),
    event_type: parseEnum(value.event_type, MARKET_EVENT_TYPES, `${context}.event_type`),
    title: requiredString(value, "title", context),
    announced_at: nullableTimestamp(value, "announced_at", context),
    effective_at: nullableTimestamp(value, "effective_at", context),
    ended_at: nullableTimestamp(value, "ended_at", context),
    first_observed_at: nullableTimestamp(value, "first_observed_at", context),
    source_url: sourceUrl(requiredString(value, "source_url", context), `${context}.source_url`),
    confidence: confidenceField(value, "confidence", context),
    notes: nullableString(value, "notes", context),
  };
  if (!event.announced_at && !event.effective_at && !event.first_observed_at) {
    throw new TypeError(`${context} must define announced_at, effective_at, or first_observed_at`);
  }
  if (event.ended_at && event.effective_at && event.ended_at < event.effective_at) {
    throw new TypeError(`${context}.ended_at must not be before effective_at`);
  }
  return event;
}

function parseReward(value: unknown, productIndex: number, index: number): ProductRewardAnnotation {
  const context = `products[${productIndex}].rewards[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const quantity = finiteNumber(value, "quantity", context);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new TypeError(`${context}.quantity must be a positive integer`);
  }
  const probabilityValue = value.probability;
  let probability: number | null = null;
  if (probabilityValue !== null && probabilityValue !== undefined) {
    probability = finiteNumber(value, "probability", context);
    if (probability < 0 || probability > 1) {
      throw new TypeError(`${context}.probability must be between 0 and 1`);
    }
  }
  if (!Array.isArray(value.class_filter)) {
    throw new TypeError(`${context}.class_filter must be an array`);
  }
  const classFilter = value.class_filter.map((item, itemIndex) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new TypeError(`${context}.class_filter[${itemIndex}] must be a non-empty string`);
    }
    return item.trim();
  });
  assertUnique(classFilter, `${context}.class_filter`);
  const gradeMin = nullableInteger(value, "grade_min", context, 1, 13);
  const gradeMax = nullableInteger(value, "grade_max", context, 1, 13);
  if (gradeMin !== null && gradeMax !== null && gradeMin > gradeMax) {
    throw new TypeError(`${context}.grade_min must not exceed grade_max`);
  }
  return {
    reward_id: identifier(requiredString(value, "reward_id", context), `${context}.reward_id`),
    reward_type: parseEnum(value.reward_type, REWARD_TYPES, `${context}.reward_type`),
    quantity,
    probability,
    class_filter: classFilter,
    grade_min: gradeMin,
    grade_max: gradeMax,
    ovr_min: nullableInteger(value, "ovr_min", context, 1),
    top_price_n: nullableInteger(value, "top_price_n", context, 1),
  };
}

function parseProduct(value: unknown, index: number): ProductAnnotation {
  const context = `products[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const saleStart = requiredTimestamp(value, "sale_start", context);
  const saleEnd = nullableTimestamp(value, "sale_end", context);
  if (saleEnd && saleEnd < saleStart) {
    throw new TypeError(`${context}.sale_end must not be before sale_start`);
  }
  const price = finiteNumber(value, "price", context);
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new TypeError(`${context}.price must be a non-negative integer`);
  }
  const purchaseLimit = nullableInteger(value, "purchase_limit", context, 1);
  if (!Array.isArray(value.rewards)) {
    throw new TypeError(`${context}.rewards must be an array`);
  }
  const rewards = value.rewards.map((reward, rewardIndex) =>
    parseReward(reward, index, rewardIndex),
  );
  assertUnique(rewards.map((reward) => reward.reward_id), "reward_id");
  return {
    product_id: identifier(requiredString(value, "product_id", context), `${context}.product_id`),
    name: requiredString(value, "name", context),
    sale_start: saleStart,
    sale_end: saleEnd,
    price,
    currency: requiredString(value, "currency", context),
    purchase_limit: purchaseLimit,
    channel: requiredString(value, "channel", context),
    source_url: sourceUrl(requiredString(value, "source_url", context), `${context}.source_url`),
    notes: nullableString(value, "notes", context),
    rewards,
  };
}

function parseExposure(value: unknown, index: number): ExposureAnnotation {
  const context = `exposures[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const eventId = nullableString(value, "event_id", context);
  const productId = nullableString(value, "product_id", context);
  if (eventId === null && productId === null) {
    throw new TypeError(`${context} must reference event_id or product_id`);
  }
  const validFrom = requiredTimestamp(value, "valid_from", context);
  const validTo = nullableTimestamp(value, "valid_to", context);
  if (validTo && validTo < validFrom) {
    throw new TypeError(`${context}.valid_to must not be before valid_from`);
  }
  return {
    exposure_id: identifier(requiredString(value, "exposure_id", context), `${context}.exposure_id`),
    event_id: eventId === null ? null : identifier(eventId, `${context}.event_id`),
    product_id: productId === null ? null : identifier(productId, `${context}.product_id`),
    instrument_id: requiredString(value, "instrument_id", context),
    exposure_type: parseEnum(value.exposure_type, EXPOSURE_TYPES, `${context}.exposure_type`),
    valid_from: validFrom,
    valid_to: validTo,
    source: requiredString(value, "source", context),
    confidence: confidenceField(value, "confidence", context),
  };
}

export function parseMarketAnnotationDocument(value: unknown): MarketAnnotationDocument {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw new TypeError("market annotation schema_version must be 1");
  }
  if (!Array.isArray(value.events) || !Array.isArray(value.products) || !Array.isArray(value.exposures)) {
    throw new TypeError("market annotation events, products, and exposures must be arrays");
  }
  const document: MarketAnnotationDocument = {
    schema_version: 1,
    annotated_at: requiredTimestamp(value, "annotated_at", "marketAnnotation"),
    events: value.events.map(parseEvent),
    products: value.products.map(parseProduct),
    exposures: value.exposures.map(parseExposure),
  };
  if (document.events.length === 0 && document.products.length === 0) {
    throw new TypeError("market annotation must contain at least one event or product");
  }
  assertUnique(document.events.map((event) => event.event_id), "event_id");
  assertUnique(document.products.map((product) => product.product_id), "product_id");
  assertUnique(
    document.products.flatMap((product) => product.rewards.map((reward) => reward.reward_id)),
    "reward_id",
  );
  assertUnique(document.exposures.map((exposure) => exposure.exposure_id), "exposure_id");
  return document;
}
