import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { ResolvedAcceptanceTargetDocument } from "../catalog/acceptance-targets.ts";

const SSS_PRODUCT_IDS = [
  "sss-mortar-top-price-730-pre-fix",
  "sss-mortar-top-price-730-post-fix",
] as const;

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

export interface SeedAcceptanceTargetsResult {
  premium_memberships_created: number;
  direct_exposures_created: number;
  same_player_relations_created: number;
  relation_snapshots_created: number;
}

export function seedAcceptanceTargets(
  db: DatabaseSync,
  document: ResolvedAcceptanceTargetDocument,
): SeedAcceptanceTargetsResult {
  const instrument = db.prepare("SELECT 1 AS found FROM instrument WHERE instrument_id = ?");
  for (const target of document.targets) {
    const instrumentId = `${target.spid}:${target.grade}`;
    if (!instrument.get(instrumentId)) {
      throw new TypeError(`acceptance target instrument ${instrumentId} is missing; run acceptance:ingest-targets first`);
    }
  }

  for (const target of document.targets.filter((item) => item.roles.includes("PACK_EXPOSED"))) {
    if (target.season !== "26FSL" || target.grade < 8 || target.grade > 11) {
      throw new TypeError(
        `PACK_EXPOSED acceptance target ${target.target_id} must be a 26FSL 8–11강 instrument`,
      );
    }
  }
  for (const target of document.targets.filter((item) => item.roles.includes("REGIME_TARGET"))) {
    if (target.season !== "26TOTS" || target.grade !== 11) {
      throw new TypeError(
        `REGIME_TARGET ${target.target_id} must be a 26TOTS 11강 instrument`,
      );
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT OR IGNORE INTO cohort_definition(
        cohort_id, name, aggregation_level, rule_version, rule_params_json
      ) VALUES ('PREMIUM_SCARCE', 'PREMIUM_SCARCE', 'PLAYER', 'manual-acceptance-v1', ?)`,
    ).run(JSON.stringify({
      catalog_id: document.catalog_id,
      roles: ["PREMIUM_SCARCE"],
      interpretation: "manually evidenced scarce/high-end acceptance cohort",
    }));

    const definition = db.prepare(
      `SELECT name, aggregation_level, rule_version
       FROM cohort_definition WHERE cohort_id = 'PREMIUM_SCARCE'`,
    ).get() as { name: string; aggregation_level: string; rule_version: string } | undefined;
    if (
      !definition || definition.name !== "PREMIUM_SCARCE" ||
      definition.aggregation_level !== "PLAYER" ||
      definition.rule_version !== "manual-acceptance-v1"
    ) {
      throw new TypeError("PREMIUM_SCARCE cohort definition conflicts with acceptance contract");
    }

    const membershipInsert = db.prepare(
      `INSERT OR IGNORE INTO cohort_membership(
        cohort_id, instrument_id, valid_from, valid_to, membership_source, confidence
      ) VALUES ('PREMIUM_SCARCE', ?, ?, NULL, ?, 1)`,
    );
    let premiumMembershipsCreated = 0;
    for (const target of document.targets.filter((item) => item.roles.includes("PREMIUM_SCARCE"))) {
      premiumMembershipsCreated += Number(membershipInsert.run(
        `${target.spid}:${target.grade}`,
        new Date(target.valid_from).toISOString(),
        `ACCEPTANCE_TARGET:${target.target_id}`,
      ).changes);
    }

    const products = new Map<string, { sale_start: string; sale_end: string | null }>();
    for (const productId of SSS_PRODUCT_IDS) {
      const product = db.prepare(
        "SELECT sale_start, sale_end FROM product WHERE product_id = ?",
      ).get(productId) as { sale_start: string; sale_end: string | null } | undefined;
      if (!product) throw new TypeError(`SSS product ${productId} is missing; run ingest:annotations first`);
      products.set(productId, product);
    }

    const exposureInsert = db.prepare(
      `INSERT OR IGNORE INTO exposure(
        exposure_id, event_id, product_id, instrument_id, exposure_type,
        valid_from, valid_to, source, confidence
      ) VALUES (?, NULL, ?, ?, 'DIRECT', ?, ?, ?, 1)`,
    );
    let directExposuresCreated = 0;
    for (const target of document.targets.filter((item) => item.roles.includes("PACK_EXPOSED"))) {
      for (const productId of SSS_PRODUCT_IDS) {
        const product = products.get(productId)!;
        const exposureId = deterministicId(
          "exposure",
          document.catalog_id,
          target.target_id,
          productId,
          "DIRECT",
        );
        directExposuresCreated += Number(exposureInsert.run(
          exposureId,
          productId,
          `${target.spid}:${target.grade}`,
          product.sale_start,
          product.sale_end,
          `ACCEPTANCE_TARGET:${target.target_id}`,
        ).changes);
      }
    }

    const relationInsert = db.prepare(
      `INSERT OR IGNORE INTO card_relation(
        relation_id, source_instrument, target_instrument, same_player,
        same_position, relation_source, valid_from, valid_to
      ) VALUES (?, ?, ?, 1, 0, 'SAME_PLAYER_ACCEPTANCE_TARGET', ?, NULL)`,
    );
    const snapshotInsert = db.prepare(
      `INSERT OR IGNORE INTO relation_snapshot(
        relation_id, as_of, shared_team_colors_json, salary_diff, ovr_diff,
        stat_distance, price_ratio, usage_distance, movement_similarity, definition_version
      ) VALUES (?, ?, '[]', NULL, NULL, NULL, NULL, NULL, NULL,
        'acceptance-target-identity-v1')`,
    );
    let samePlayerRelationsCreated = 0;
    let relationSnapshotsCreated = 0;
    for (const target of document.targets.filter((item) => item.roles.includes("SAME_PLAYER"))) {
      const targetInstrument = `${target.spid}:${target.grade}`;
      const peers = db.prepare(
        `SELECT peer.instrument_id
         FROM player_card target_card
         JOIN player_card peer_card ON peer_card.player_id = target_card.player_id
         JOIN instrument peer ON peer.spid = peer_card.spid
         WHERE target_card.spid = ? AND peer.instrument_id <> ?
         ORDER BY peer.instrument_id`,
      ).all(target.spid, targetInstrument) as Array<{ instrument_id: string }>;
      if (peers.length === 0) {
        throw new TypeError(
          `SAME_PLAYER acceptance target ${target.target_id} has no sibling instrument`,
        );
      }
      for (const peer of peers) {
        const [left, right] = [targetInstrument, peer.instrument_id].sort();
        const validFrom = new Date(target.valid_from).toISOString();
        const relationId = deterministicId(
          "rel",
          document.catalog_id,
          target.target_id,
          left!,
          right!,
          "SAME_PLAYER_ACCEPTANCE_TARGET",
        );
        samePlayerRelationsCreated += Number(
          relationInsert.run(relationId, left!, right!, validFrom).changes,
        );
        relationSnapshotsCreated += Number(
          snapshotInsert.run(relationId, validFrom).changes,
        );
      }
    }

    db.exec("COMMIT");
    return {
      premium_memberships_created: premiumMembershipsCreated,
      direct_exposures_created: directExposuresCreated,
      same_player_relations_created: samePlayerRelationsCreated,
      relation_snapshots_created: relationSnapshotsCreated,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
