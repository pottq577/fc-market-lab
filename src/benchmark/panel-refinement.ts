export const DEFAULT_REFINEMENT_PANEL_SIZES = [
  200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800,
] as const;

export interface RefinementPairLike {
  smaller_panel_label: string;
  smaller_panel_size: number;
  larger_panel_label: string;
  larger_panel_size: number;
  status: "PASS" | "FAIL" | "INSUFFICIENT";
}

export interface PassTailSummary {
  start_panel_label: string;
  start_panel_size: number;
  end_panel_label: string;
  end_panel_size: number;
  pass_pair_count: number;
}

export function parseRefinementPanelSizes(value?: string): number[] {
  if (value === undefined) return [...DEFAULT_REFINEMENT_PANEL_SIZES];
  const parts = value.split(",").map((item) => item.trim());
  if (parts.length === 0 || parts.some((item) => item === "")) {
    throw new TypeError("--panel-sizes must be a comma-separated list of positive integers");
  }
  const sizes = parts.map((item) => Number(item));
  if (sizes.some((size) => !Number.isSafeInteger(size) || size <= 0)) {
    throw new TypeError("--panel-sizes must contain positive safe integers");
  }
  if (new Set(sizes).size !== sizes.length) {
    throw new TypeError("--panel-sizes must not contain duplicates");
  }
  for (let index = 1; index < sizes.length; index += 1) {
    if (sizes[index]! <= sizes[index - 1]!) {
      throw new TypeError("--panel-sizes must be strictly increasing");
    }
  }
  return sizes;
}

export function validateRefinementPanelSizes(
  requested: readonly number[],
  baseline: readonly number[],
): number[] {
  if (requested.length < 3) {
    throw new TypeError("panel refinement requires at least three panel sizes");
  }
  if (baseline.length < 2) {
    throw new TypeError("baseline panel family requires at least two panel sizes");
  }
  const baselineSorted = [...baseline].sort((left, right) => left - right);
  const baselineMax = baselineSorted.at(-1)!;
  const requestedMax = requested.at(-1)!;
  if (requestedMax !== baselineMax) {
    throw new TypeError(
      `refinement largest panel must remain P${baselineMax}; got P${requestedMax}`,
    );
  }
  if (requested.some((size) => size > baselineMax)) {
    throw new TypeError(`refinement panel sizes must not exceed P${baselineMax}`);
  }
  const baselineSet = new Set(baselineSorted);
  const shared = requested.filter((size) => baselineSet.has(size));
  if (shared.length < 2 || !shared.includes(baselineMax)) {
    throw new TypeError(
      "refinement must share at least two baseline panel sizes including the largest panel",
    );
  }
  return shared;
}

export function summarizePassTail(
  pairs: readonly RefinementPairLike[],
): PassTailSummary | null {
  if (pairs.length === 0) return null;
  for (let index = 0; index < pairs.length - 1; index += 1) {
    const current = pairs[index]!;
    const next = pairs[index + 1]!;
    if (current.larger_panel_size !== next.smaller_panel_size) {
      throw new TypeError("refinement pairs must form a contiguous ascending chain");
    }
  }
  for (let index = 0; index < pairs.length; index += 1) {
    const tail = pairs.slice(index);
    if (tail.every((pair) => pair.status === "PASS")) {
      const first = tail[0]!;
      const last = tail.at(-1)!;
      return {
        start_panel_label: first.smaller_panel_label,
        start_panel_size: first.smaller_panel_size,
        end_panel_label: last.larger_panel_label,
        end_panel_size: last.larger_panel_size,
        pass_pair_count: tail.length,
      };
    }
  }
  return null;
}
