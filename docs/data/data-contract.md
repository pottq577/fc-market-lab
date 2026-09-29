---
meta:
  contentType: Reference
---

# 어떤 데이터를 어떻게 확보하고 검증하는가

이 문서는 FC온라인 시장 분석에 사용할 데이터 출처, 이용 조건, 가격 의미, 품질 기준을 정의한다.
구현은 이 문서의 Gate를 통과한 source만 자동 수집 경로로 사용한다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 데이터 source 우선순위

데이터는 source 성격을 구분해 저장한다.
기술적으로 접근 가능하다는 사실과 자동 수집이 허용된다는 판단을 같은 것으로 취급하지 않는다.

| 우선순위 | source                    | 사용 목적                                  | 기본 처리                              |
| -------- | ------------------------- | ------------------------------------------ | -------------------------------------- |
| 1        | NEXON Open API            | 선수 metadata, 랭커, 매치, 공식 ID mapping | 자동 수집 후보                         |
| 2        | FC온라인 공식 공개 페이지 | 가격, 공지, 상품, 이벤트, 팀컬러 정보      | source별 이용 조건 확인 후 결정        |
| 3        | 수동 annotation           | 핵심 사건, 상품 구성, source 해석          | PoC 기본 방식                          |
| 4        | 제3자 공개 dataset        | 누락 보완, 교차검증                        | license와 provenance 확인 후 제한 사용 |
| 5        | 비공식 서비스             | 탐색과 교차검증                            | 핵심 원본으로 사용하지 않음            |

Open API 약관과 공식 데이터센터의 자동 접근 조건을 동일한 규칙으로 가정하지 않는다.
Gate 0A는 source별 공식 문서와 이용 조건을 따로 검토한다.

참고할 공식 문서는 다음과 같다:

- NEXON Open API 이용약관: `https://openapi.nexon.com/ko/support/terms/`
- NEXON Open API 요청 가이드: `https://openapi.nexon.com/ko/guide/request-api/`
- FC온라인 데이터센터: `https://fconline.nexon.com/DataCenter`

정책 문구는 변경될 수 있으므로 구현 코드에 법적 판단을 하드코딩하지 않는다.
검토 결과를 evidence record로 남긴다.

## Gate 0A: source viability를 확인한다

Gate 0A는 전체 선수 catalog를 만들기 전에 소수 instrument로 데이터 접근 가능성과 이용 조건을 확인한다.
다음 항목을 모두 충족해야 통과한다:

- 공식 또는 이용 가능한 source를 식별한다
- 기계 판독 가능한 응답 또는 재현 가능한 수동 export 경로를 확인한다
- source timestamp와 observation timestamp를 구분할 수 있다
- 가격의 의미를 `MARKET_REFERENCE_PRICE`, `TRADE_PRICE`, `UNKNOWN` 중 하나로 분류할 수 있다
- 가격 history의 최대 기간과 native temporal granularity를 확인한다
- 같은 instrument에서 같은 절차를 다시 실행해 같은 의미의 데이터를 얻을 수 있다
- source별 자동 접근, 저장, 가공 조건을 확인한다
- 검토한 URL, 검토 시각, 관련 조항, 판단 근거를 저장한다

Gate evidence는 최소 다음 필드를 가진다:

```text
source_id
source_url
policy_url
policy_checked_at
access_method
native_granularity
history_span
price_semantics
automation_decision
decision_reason
evidence_hash
```

`automation_decision`은 `ALLOWED`, `MANUAL_ONLY`, `UNKNOWN`, `REJECTED` 중 하나다.
`UNKNOWN` 상태에서는 자동 collector를 구현하지 않는다.

## Gate 0B: coverage viability를 확인한다

Gate 0B는 seed catalog를 정한 뒤 실제 표본 전체에 source가 적용되는지 확인한다.
Gate 0A 통과가 표본 coverage를 보장하지 않기 때문에 별도 단계로 둔다.

다음 조건을 모두 검증한다:

- seed player 20–30명의 주요 class와 grade를 식별한다
- primary instrument마다 최소 180일 history span을 확보한다
- 목표 history span은 365일이다
- source-native expected observation 기준 coverage ratio를 계산한다
- primary instrument의 coverage ratio는 90% 이상이어야 한다
- 누락 구간과 source outage를 별도 상태로 기록한다
- source별 temporal granularity가 섞이면 series를 분리하거나 명시적으로 normalize한다

180일과 90%는 1차 PoC acceptance threshold다.
source 특성상 이 기준이 부적절하다는 증거가 나오면 ADR을 추가해 변경한다.

## 가격 데이터 의미를 보존한다

가격 graph 값을 실제 체결가로 단정하지 않는다.
source가 실제 체결값임을 명시적으로 보장할 때만 `TRADE_PRICE`를 사용한다.

기본 `price_point`는 다음 정보를 보존한다:

```text
instrument_id
price_semantics
source_timestamp
observed_at
value
currency
source_snapshot_id
quality_status
```

공식 기준가 규칙이 변경된 시점을 Regime marker로 연결한다.
Regime 경계를 넘는 수익률은 metric이 명시적으로 허용하지 않는 한 계산하지 않는다.

## 일별 분석 시점을 만든다

분석은 source-native observation을 먼저 보존한 뒤 필요할 때 일별 series를 만든다.
일별 값을 만들 때 미래 observation을 당겨 쓰지 않는다.

Korean Standard Time (KST) 기준 분석일 `D`의 값은 해당 날짜 cutoff 이전에 존재하는 유효 observation만 사용한다.
source가 하루에 하나의 값을 제공하면 그 값을 그대로 사용한다.

1일 수익률은 인접 분석일 양쪽에 유효한 값이 있을 때만 계산한다:

```text
return_1d(t) = price(t) / price(t - 1) - 1
```

하루가 누락됐다고 이전 값을 자동 forward-fill하지 않는다.
이벤트 window의 양 끝값을 비교할 때는 실제 elapsed period를 결과에 기록한다.

## 데이터 품질을 검사한다

Normalized 데이터로 승격하기 전에 다음 품질 규칙을 실행한다:

- timestamp 역전
- 동일 source와 instrument의 중복 timestamp
- 0 이하의 가격
- 예상 observation 누락
- 비정상적으로 긴 동일 값 반복
- grade 혼합
- `spid` mapping 변경
- metadata schema 또는 의미 변경
- price source 변경
- source-native granularity 변경
- Regime 경계 누락

동일 값이 오래 반복됐다는 사실만으로 stale data로 단정하지 않는다.
`UNCHANGED_RUN` flag를 남기고 source snapshot 자체가 갱신되지 않은 경우에만 `STALE_SOURCE`로 분류한다.

수집 실패는 가격 0으로 저장하지 않는다.
`MISSING`, `FETCH_FAILED`, `STALE_SOURCE`, `INVALID` 상태를 실제 가격값과 분리한다.

## 공지와 상품 데이터를 수집한다

공지, 이벤트, 유료상품은 PoC에서 사람이 먼저 annotation한다.
자동 자연어 분석은 현재 범위에 포함하지 않는다.

이벤트 source에는 다음 내용을 저장한다:

- 공지와 업데이트
- 개발자 노트와 라커룸 토크
- 이벤트와 버닝
- 유료상품 공지
- 시장 정책 변경
- 사고 대응
- 보상

상품 source에는 다음 내용을 저장한다:

- 판매 기간
- 가격과 currency
- 구매 제한
- 판매 channel
- reward 구성
- 선수팩 class, grade, OVR, Top Price 조건
- 공개된 probability
- 공개된 popularity signal

판매금액 기반 인기순위를 절대 판매량으로 변환하지 않는다.

## 제3자 데이터를 제한한다

제3자 dataset은 license, origin, collection method를 확인한 경우에만 사용한다.
source를 확인할 수 없는 데이터는 핵심 가격 series나 acceptance evidence에 포함하지 않는다.

비공식 서비스는 탐색과 교차검증에 사용할 수 있다.
해당 서비스의 데이터를 원본처럼 재배포하거나 공식 데이터와 같은 신뢰 수준으로 표시하지 않는다.
