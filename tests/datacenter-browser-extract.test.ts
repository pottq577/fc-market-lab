import assert from "node:assert/strict";
import test from "node:test";

import {
  extractDatacenterMetadata,
  extractStatsFromPageText,
} from "../src/collect/datacenter-browser-extract.ts";

const player = {
  spid: 863239231,
  name: "마르크 쿠쿠레야",
  pay: 27,
  ovr: 120,
  position: "lb",
  position2: "lwb",
  ovr2: 118,
  position3: "",
  ovr3: 0,
  teamColor: {
    teamColor1: { name: "첼시" },
    teamColor2: { name: "" },
    teamColor3: { name: "스페인" },
  },
};

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

const renderedOnlyPageText = `
선수 상세 정보
116
LB
26
1
Image
Image
마르크 쿠쿠레야
Image
Image
Image
Image
26
마르크 쿠쿠레야
[Button: 카카오]
LB 116
1998.07.22 174cm 71kg 보통
Image 첼시
Image 스페인
특성
Image: 강철몸 강철몸
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

const summaryOnlyPageText = `
선수 상세 정보
116
LB
26
1
Image
Image
1998.07.22 174cm 71kg 보통
Image 첼시
Image 스페인
특성
Image: 강철몸 강철몸
강화
1
팀컬러
소속 팀컬러
스페인
첼시
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

test("extracts named stats from rendered page text", () => {
  const stats = extractStatsFromPageText(pageText);
  assert.equal(stats.속력, 125);
  assert.equal(stats["볼 컨트롤"], 121);
  assert.equal(Object.keys(stats).length, 20);
});

test("extracts metadata from a browser-observed JSON response", () => {
  const result = extractDatacenterMetadata({
    spid: "863239231",
    expected_player_name: "마르크 쿠쿠레야",
    page_text: pageText,
    response_bodies: [JSON.stringify({ players: [player] })],
  });
  assert.equal(result.salary, 27);
  assert.equal(result.ovr, 120);
  assert.deepEqual(result.positions, [
    { name: "LB", ovr: 120, primary: true },
    { name: "LWB", ovr: 118, primary: false },
  ]);
  assert.deepEqual(result.clubs, ["첼시"]);
  assert.deepEqual(result.nations, ["스페인"]);
  assert.ok(result.team_colors.includes("Path to Glory"));
  assert.equal(result.stats.속력, 125);
});


test("falls back to the rendered Data Center header when no player JSON is observed", () => {
  const result = extractDatacenterMetadata({
    spid: "863239231",
    expected_player_name: "마르크 쿠쿠레야",
    page_text: renderedOnlyPageText,
    response_bodies: [],
  });

  assert.equal(result.salary, 26);
  assert.equal(result.ovr, 116);
  assert.deepEqual(result.positions, [
    { name: "LB", ovr: 116, primary: true },
  ]);
  assert.deepEqual(result.clubs, ["첼시"]);
  assert.deepEqual(result.nations, ["스페인"]);
  assert.ok(result.team_colors.includes("Path to Glory"));
});


test("falls back to the rendered summary even when the player-name node is late", () => {
  const result = extractDatacenterMetadata({
    spid: "863239231",
    expected_player_name: "마르크 쿠쿠레야",
    page_text: summaryOnlyPageText,
    response_bodies: [],
  });

  assert.equal(result.salary, 26);
  assert.equal(result.ovr, 116);
  assert.deepEqual(result.positions, [
    { name: "LB", ovr: 116, primary: true },
  ]);
  assert.deepEqual(result.clubs, ["첼시"]);
  assert.deepEqual(result.nations, ["스페인"]);
});

test("uses embedded page HTML as a structured metadata fallback", () => {
  const result = extractDatacenterMetadata({
    spid: "863239231",
    expected_player_name: "마르크 쿠쿠레야",
    page_text: pageText,
    page_html:
      '<script>window.player={"spid":863239231,"name":"마르크 쿠쿠레야","pay":26,"ovr":116,"position":"LB"};</script>',
    response_bodies: [],
  });

  assert.equal(result.salary, 26);
  assert.equal(result.ovr, 116);
  assert.deepEqual(result.positions, [
    { name: "LB", ovr: 116, primary: true },
  ]);
});

test("rejects a mismatched player record", () => {
  assert.throws(
    () =>
      extractDatacenterMetadata({
        spid: "863239231",
        expected_player_name: "다른 선수",
        page_text: pageText,
        response_bodies: [JSON.stringify(player)],
      }),
    /player name/,
  );
});
