export type AcceptanceStatus = "PASS" | "FAIL";

export interface AcceptanceCriterionResult {
  id: `AC-${string}`;
  title: string;
  status: AcceptanceStatus;
  evidence: Record<string, unknown>;
  blockers: string[];
}

export interface PocAcceptanceResult {
  status: "COMPLETE" | "INCOMPLETE";
  analysis_run_id: string;
  dataset_snapshot_id: string;
  checked_at: string;
  passed: number;
  failed: number;
  criteria: AcceptanceCriterionResult[];
}

export function summarizeAcceptance(
  analysisRunId: string,
  datasetSnapshotId: string,
  criteria: AcceptanceCriterionResult[],
  checkedAt: string,
): PocAcceptanceResult {
  const passed = criteria.filter((item) => item.status === "PASS").length;
  const failed = criteria.length - passed;
  return {
    status: failed === 0 ? "COMPLETE" : "INCOMPLETE",
    analysis_run_id: analysisRunId,
    dataset_snapshot_id: datasetSnapshotId,
    checked_at: checkedAt,
    passed,
    failed,
    criteria,
  };
}
