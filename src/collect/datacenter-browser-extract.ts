export interface BrowserMetadataPosition {
  name: string;
  ovr: number;
  primary: boolean;
}

export interface BrowserMetadataExtraction {
  player_name: string;
  salary: number;
  positions: BrowserMetadataPosition[];
  ovr: number;
  stats: Record<string, number>;
  traits: string[];
  clubs: string[];
  nations: string[];
  team_colors: string[];
}

const STAT_NAMES = [
  "속력",
  "가속력",
  "골 결정력",
  "슛 파워",
  "중거리 슛",
  "위치 선정",
  "발리슛",
  "페널티 킥",
  "짧은 패스",
  "시야",
  "크로스",
  "긴 패스",
  "프리킥",
  "커브",
  "드리블",
  "볼 컨트롤",
  "민첩성",
  "밸런스",
  "반응 속도",
  "대인 수비",
  "태클",
  "가로채기",
  "헤더",
  "슬라이딩 태클",
  "몸싸움",
  "스태미너",
  "적극성",
  "점프",
  "침착성",
  "GK 다이빙",
  "GK 핸들링",
  "GK 킥",
  "GK 반응속도",
  "GK 위치선정",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (/^\d+$/.test(normalized)) {
      const parsed = Number(normalized);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }
  }
  return null;
}

function matchesSpid(value: unknown, spid: string): boolean {
  return String(value ?? "") === spid;
}

function findPlayerRecord(value: unknown, spid: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPlayerRecord(item, spid);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (
    matchesSpid(value.spid ?? value.spId, spid) &&
    (toPositiveInteger(value.pay) !== null || toPositiveInteger(value.ovr) !== null)
  ) {
    return value;
  }
  for (const item of Object.values(value)) {
    const found = findPlayerRecord(item, spid);
    if (found) {
      return found;
    }
  }
  return null;
}

function recordFromJson(raw: string, spid: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return null;
  }
  try {
    return findPlayerRecord(JSON.parse(trimmed), spid);
  } catch {
    return null;
  }
}

function readJsonString(window: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i").exec(window);
  return match?.[1]?.trim() || null;
}

function readJsonInteger(window: string, key: string): number | null {
  const match = new RegExp(`"${key}"\\s*:\\s*(?:"([0-9,]+)"|([0-9]+))`, "i").exec(window);
  return toPositiveInteger(match?.[1] ?? match?.[2]);
}

function recordFromTextWindow(raw: string, spid: string): Record<string, unknown> | null {
  const pattern = new RegExp(`"(?:spid|spId)"\\s*:\\s*"?${spid}"?`, "i");
  const match = pattern.exec(raw);
  if (!match) {
    return null;
  }
  const start = Math.max(0, match.index - 3000);
  const end = Math.min(raw.length, match.index + 30000);
  const window = raw.slice(start, end);
  const pay = readJsonInteger(window, "pay");
  const ovr = readJsonInteger(window, "ovr");
  const position = readJsonString(window, "position");
  if (pay === null || ovr === null || position === null) {
    return null;
  }
  return {
    spid,
    name: readJsonString(window, "name") ?? undefined,
    pay,
    ovr,
    position,
    position2: readJsonString(window, "position2") ?? "",
    ovr2: readJsonInteger(window, "ovr2") ?? 0,
    position3: readJsonString(window, "position3") ?? "",
    ovr3: readJsonInteger(window, "ovr3") ?? 0,
  };
}

function findRecord(rawBodies: string[], spid: string): Record<string, unknown> | null {
  for (const raw of rawBodies) {
    const parsed = recordFromJson(raw, spid) ?? recordFromTextWindow(raw, spid);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function normalizePositionName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{1,4}$/.test(normalized) ? normalized : null;
}

function positionsFromRecord(record: Record<string, unknown>): BrowserMetadataPosition[] {
  const primaryName = normalizePositionName(record.position);
  const primaryOvr = toPositiveInteger(record.ovr);
  if (!primaryName || primaryOvr === null) {
    throw new TypeError("Data Center player record has no primary position/OVR");
  }
  const positions: BrowserMetadataPosition[] = [
    { name: primaryName, ovr: primaryOvr, primary: true },
  ];
  for (const suffix of ["2", "3"] as const) {
    const name = normalizePositionName(record[`position${suffix}`]);
    const ovr = toPositiveInteger(record[`ovr${suffix}`]);
    if (name && ovr !== null && !positions.some((item) => item.name === name)) {
      positions.push({ name, ovr, primary: false });
    }
  }
  return positions;
}

export function extractStatsFromPageText(text: string): Record<string, number> {
  const normalized = text.replace(/\r/g, "\n");
  const stats: Record<string, number> = {};
  for (const name of STAT_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`${escaped}\\s*[:：]?\\s*(\\d{1,3})(?!\\d)`),
      new RegExp(`(\\d{1,3})(?!\\d)\\s*${escaped}`),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(normalized);
      if (!match) {
        continue;
      }
      const value = Number(match[1]);
      if (Number.isInteger(value) && value >= 0 && value <= 250) {
        stats[name] = value;
        break;
      }
    }
  }
  return stats;
}

function teamColorsFromRecord(record: Record<string, unknown>): string[] {
  const teamColor = record.teamColor;
  if (!isRecord(teamColor)) {
    return [];
  }
  const names: string[] = [];
  for (const value of Object.values(teamColor)) {
    if (!isRecord(value) || typeof value.name !== "string") {
      continue;
    }
    const name = value.name.trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function cleanPageLine(line: string): string {
  return line
    .replace(/^Image(?::\s*|\s+)/i, "")
    .replace(/^\[Button:\s*([^\]]+)\]$/i, "$1")
    .trim();
}

function pageLines(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map(cleanPageLine)
    .filter(Boolean);
}

function recordFromRenderedPageText(
  text: string,
  spid: string,
  playerName: string,
): Record<string, unknown> | null {
  const lines = pageLines(text);
  const playerIndexes = lines
    .map((line, index) => (line === playerName ? index : -1))
    .filter((index) => index >= 0);

  for (const playerIndex of playerIndexes) {
    let positionIndex = -1;
    let position: string | null = null;
    let ovr: number | null = null;
    const end = Math.min(lines.length, playerIndex + 6);
    for (let index = playerIndex + 1; index < end; index += 1) {
      const match = /^([A-Z]{1,4})\s+(\d{2,3})$/.exec(lines[index]!);
      if (!match) {
        continue;
      }
      positionIndex = index;
      position = normalizePositionName(match[1]);
      ovr = toPositiveInteger(match[2]);
      break;
    }
    if (positionIndex < 0 || !position || ovr === null) {
      continue;
    }

    let pay: number | null = null;
    const salaryStart = Math.max(0, playerIndex - 8);
    for (let index = playerIndex - 1; index >= salaryStart; index -= 1) {
      const line = lines[index]!;
      if (!/^\d{1,3}$/.test(line)) {
        continue;
      }
      const candidate = toPositiveInteger(line);
      if (candidate !== null && candidate <= 99) {
        pay = candidate;
        break;
      }
    }
    if (pay === null) {
      continue;
    }

    return { spid, name: playerName, pay, ovr, position };
  }

  return null;
}

function recordFromRenderedSummary(
  text: string,
  spid: string,
  playerName: string,
): Record<string, unknown> | null {
  const lines = pageLines(text);
  const detailIndex = lines.findIndex((line) => line === "선수 상세 정보");
  const start = detailIndex >= 0 ? detailIndex + 1 : 0;
  const end = Math.min(lines.length - 2, start + 40);

  for (let index = start; index < end; index += 1) {
    const ovr = toPositiveInteger(lines[index]);
    const position = normalizePositionName(lines[index + 1]);
    const pay = toPositiveInteger(lines[index + 2]);
    if (
      ovr === null ||
      ovr < 50 ||
      ovr > 250 ||
      !position ||
      pay === null ||
      pay > 99
    ) {
      continue;
    }

    return {
      spid,
      name: lines.includes(playerName) ? playerName : undefined,
      pay,
      ovr,
      position,
    };
  }

  return null;
}

function linesBetween(
  lines: string[],
  startLabel: string,
  endLabels: ReadonlySet<string>,
): string[] {
  const start = lines.findIndex((line) => line === startLabel);
  if (start < 0) {
    return [];
  }
  const result: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (endLabels.has(line)) {
      break;
    }
    result.push(line);
  }
  return result;
}

function extractAffiliations(text: string): { clubs: string[]; nations: string[] } {
  const lines = pageLines(text);
  const traitsIndex = lines.findIndex((line) => line === "특성");
  if (traitsIndex < 0) {
    return { clubs: [], nations: [] };
  }
  let bioIndex = -1;
  for (let index = traitsIndex - 1; index >= 0; index -= 1) {
    if (/\d{4}\.\d{2}\.\d{2}.*\d{2,3}cm.*\d{2,3}kg/.test(lines[index]!)) {
      bioIndex = index;
      break;
    }
  }
  if (bioIndex < 0) {
    return { clubs: [], nations: [] };
  }
  const candidates = lines
    .slice(bioIndex + 1, traitsIndex)
    .filter((line) => line !== "카카오" && !/^Image(?::|$)/i.test(line));
  if (candidates.length === 0) {
    return { clubs: [], nations: [] };
  }
  if (candidates.length === 1) {
    return { clubs: [], nations: [candidates[0]!.split(",")[0]!.trim()] };
  }
  return {
    clubs: [candidates[0]!],
    nations: [candidates.at(-1)!.split(",")[0]!.trim()],
  };
}

function extractTraits(text: string): string[] {
  const lines = pageLines(text);
  const section = linesBetween(lines, "특성", new Set(["강화"]));
  const traits: string[] = [];
  for (const line of section) {
    const normalized = line.replace(/^Image:\s*/i, "").trim();
    if (!normalized || /^Image$/i.test(normalized)) {
      continue;
    }
    for (const part of normalized.split(/\s{2,}/)) {
      const value = part.trim();
      if (value && !traits.includes(value)) {
        traits.push(value);
      }
    }
  }
  return traits.slice(0, 20);
}

function teamColorsFromPage(text: string): string[] {
  const lines = pageLines(text);
  const start = lines.findIndex((line) => line === "소속 팀컬러");
  if (start < 0) {
    return [];
  }
  const knownStats = new Set<string>(STAT_NAMES);
  const result: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (knownStats.has(line) || line === "클래스 비교" || line.startsWith("상위 랭커가")) {
      break;
    }
    if (
      line === "소속 팀컬러" ||
      line === "관계 팀컬러" ||
      line === "강화 팀컬러" ||
      /^Lv\./i.test(line) ||
      /^[-+]?\d+(?:\.\d+)?$/.test(line)
    ) {
      continue;
    }
    if (!result.includes(line)) {
      result.push(line);
    }
  }
  return result;
}

export function extractDatacenterMetadata(input: {
  spid: string;
  expected_player_name: string;
  page_text: string;
  page_html?: string;
  response_bodies: string[];
}): BrowserMetadataExtraction {
  if (!/^\d+$/.test(input.spid)) {
    throw new TypeError("spid must contain digits only");
  }
  const structuredSources = input.page_html
    ? [...input.response_bodies, input.page_html]
    : input.response_bodies;
  const record =
    findRecord(structuredSources, input.spid) ??
    recordFromRenderedPageText(
      input.page_text,
      input.spid,
      input.expected_player_name,
    ) ??
    recordFromRenderedSummary(
      input.page_text,
      input.spid,
      input.expected_player_name,
    );
  if (!record) {
    throw new TypeError(
      `no Data Center player record, rendered header, or rendered summary found for spid=${input.spid}`,
    );
  }
  const salary = toPositiveInteger(record.pay);
  if (salary === null) {
    throw new TypeError(`Data Center player record has no salary for spid=${input.spid}`);
  }
  const positions = positionsFromRecord(record);
  const ovr = positions[0]!.ovr;
  const stats = extractStatsFromPageText(input.page_text);
  if (Object.keys(stats).length < 20) {
    throw new TypeError(
      `Data Center stats are incomplete for spid=${input.spid}: ${Object.keys(stats).length} named stats`,
    );
  }
  const recordName = typeof record.name === "string" ? record.name.trim() : "";
  if (recordName && recordName !== input.expected_player_name) {
    throw new TypeError(
      `Data Center player name ${recordName} != expected ${input.expected_player_name}`,
    );
  }

  const affiliations = extractAffiliations(input.page_text);
  const teamColors = [
    ...teamColorsFromRecord(record),
    ...teamColorsFromPage(input.page_text),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  if (affiliations.nations.length === 0) {
    throw new TypeError(`no Data Center nation found for spid=${input.spid}`);
  }
  if (teamColors.length === 0) {
    throw new TypeError(`no Data Center team colors found for spid=${input.spid}`);
  }

  return {
    player_name: input.expected_player_name,
    salary,
    positions,
    ovr,
    stats,
    traits: extractTraits(input.page_text),
    clubs: affiliations.clubs,
    nations: affiliations.nations,
    team_colors: teamColors,
  };
}
