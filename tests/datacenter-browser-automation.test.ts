import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { extractDatacenterMetadata } from "../src/collect/datacenter-browser-extract.ts";
import {
  DATACENTER_PLAYWRIGHT_CAPTURE_METHOD,
  parseDatacenterMetadataEvidenceDocument,
} from "../src/evidence/datacenter-metadata.ts";

const raw = Buffer.from("<html>rendered player detail</html>");
const rawHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
const pageText = `
선수 상세 정보
마르크 쿠쿠레야
LB 120
1998.07.22 174cm 71kg 보통
첼시
스페인
특성
강철몸
강화
1
팀컬러
소속 팀컬러
스페인
첼시
FC 바르셀로나
Path to Glory
관계 팀컬러
2026 스페인
속력 125
가속력 123
골 결정력 101
슛 파워 110
중거리 슛 108
위치 선정 115
발리슛 100
페널티 킥 99
짧은 패스 121
시야 119
크로스 124
긴 패스 118
프리킥 105
커브 120
드리블 122
볼 컨트롤 121
민첩성 126
밸런스 125
반응 속도 123
대인 수비 124
`;

test("accepts Playwright Data Center metadata evidence", () => {
  const document = parseDatacenterMetadataEvidenceDocument({
    schema_version: 1,
    catalog_id: "sample-market-test",
    capture_method: DATACENTER_PLAYWRIGHT_CAPTURE_METHOD,
    entries: [
      {
        spid: "863239231",
        grade: 1,
        player_name: "마르크 쿠쿠레야",
        observed_at: "2026-09-30T06:00:00.000Z",
        source_url:
          "https://fconline.nexon.com/DataCenter/PlayerInfo?n1Strong=1&spid=863239231",
        raw_sha256: rawHash,
        salary: 27,
        positions: [{ name: "LB", ovr: 120, primary: true }],
        ovr: 120,
        stats: { 속력: 125 },
        traits: [],
        clubs: [],
        nations: [],
        team_colors: [],
      },
    ],
  });
  assert.equal(document.capture_method, DATACENTER_PLAYWRIGHT_CAPTURE_METHOD);
});

test("extracts complete metadata from browser-observed player data", () => {
  const response = JSON.stringify({
    players: [
      {
        spid: 863239231,
        name: "마르크 쿠쿠레야",
        pay: 27,
        ovr: 120,
        position: "lb",
        position2: "lwb",
        ovr2: 118,
        teamColor: {
          teamColor1: { name: "첼시" },
          teamColor2: { name: "스페인" },
        },
      },
    ],
  });
  const metadata = extractDatacenterMetadata({
    spid: "863239231",
    expected_player_name: "마르크 쿠쿠레야",
    page_text: pageText,
    response_bodies: [response],
  });
  assert.equal(metadata.salary, 27);
  assert.deepEqual(metadata.positions, [
    { name: "LB", ovr: 120, primary: true },
    { name: "LWB", ovr: 118, primary: false },
  ]);
  assert.equal(metadata.stats.속력, 125);
  assert.deepEqual(metadata.clubs, ["첼시"]);
  assert.deepEqual(metadata.nations, ["스페인"]);
  assert.ok(metadata.team_colors.includes("Path to Glory"));
});
