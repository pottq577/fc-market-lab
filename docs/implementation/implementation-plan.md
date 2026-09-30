---
meta:
  contentType: How-to
---

# 어떤 순서로 PoC를 구현하는가

이 문서는 데이터 접근 검증부터 사건 replay까지의 구현 순서를 고정한다.
앞 단계의 Gate가 실패하면 뒤 단계를 억지로 진행하지 않고 해당 단계의 source 또는 설계를 수정한다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 1. Gate 0A에서 source viability를 확인한다

소수 instrument로 가격 history의 접근 방식과 이용 조건을 먼저 확인한다:

1. 공식 source와 관련 policy URL을 기록한다
2. 기계 판독 또는 재현 가능한 수동 export 가능성을 확인한다
3. history span과 native granularity를 확인한다
4. 가격 의미를 분류한다
5. automation decision과 근거를 evidence로 저장한다

`UNKNOWN` 또는 `REJECTED`이면 자동 collector 구현을 시작하지 않는다.

## 2. Seed catalog를 고정한다

20–30명 seed player와 primary instrument를 선정한다.
선정 근거에는 랭커 사용량, 주요 팀컬러 또는 포지션, 여러 class 비교 가능성을 포함한다.

이 단계에서 `SAMPLE_MARKET`의 player set을 고정한다.
Replay 중 결과에 맞춰 seed를 바꾸지 않는다.

## 3. Gate 0B에서 표본 coverage를 검증한다

Seed catalog 전체에 Gate 0A source를 적용한다.
Primary instrument마다 history span, expected observation, valid observation, coverage ratio를 계산한다.

History qualification은 두 경로를 사용한다:

- 출시 후 180일 이상 지난 instrument는 최소 180일 history와 90% 이상 coverage를 요구한다
- 출시 후 180일이 지나지 않은 instrument는 공식 출시일 evidence를 연결하고 출시일부터 최신 observation까지 90% 이상 full-lifetime coverage를 요구한다

Gate가 실패하면 source 누락, observation 누락, 출시일 evidence 누락을 구분한다. 원인에 맞는 입력만 수정한다. 365개 observation은 계속 목표값으로 유지한다.

## 4. Raw와 Normalized 가격 데이터를 적재한다

Raw payload를 불변 snapshot으로 저장한 뒤 `player`, `player_card`, `instrument`, `price_point`로 정규화한다.
누락, fetch failure, stale source, invalid value를 가격값과 분리한다.

Regime 경계와 `price_semantics`도 이 단계에서 연결한다.

## 5. Metadata와 usage를 연결한다

이 단계는 source가 실제로 제공하는 범위대로 나눠 진행한다. Open API identity metadata와 현재 usage observation을 먼저 연결한 뒤 Data Center 상세 metadata를 보강한다.

1. `spid`, 시즌, 포지션 코드 정적 metadata를 Raw snapshot으로 저장한다
2. Seed card의 이름과 시즌 identity를 `IDENTITY_ONLY` metadata snapshot으로 정규화한다
3. Daily Chart usage를 `PLAYER_CARD` 단위 observation으로 저장한다
4. 급여, OVR, 세부 능력치, 특성, 팀컬러는 수동 Data Center evidence로 `FULL` metadata snapshot을 추가한다
5. 포지션이 확인된 card에는 Open API ranker stats를 추가할 수 있다

Source가 grade를 제공하지 않으면 usage를 grade별 instrument에 투영하지 않는다. 과거 usage를 제공하지 않는 source는 빈 데이터를 생성하지 않고 `UNAVAILABLE_SOURCE` evidence를 남긴다.

## 6. 이벤트와 상품을 annotation한다

Replay에 필요한 주요 공지와 상품을 사람이 등록한다.
`announced_at`, `effective_at`, `ended_at`, source를 분리하고 상품 reward와 exposure를 연결한다.

초기 필수 사건은 라커룸 토크 11화, SSS 20코인 사건, 기준가 규칙 변경이다.

## 7. 관계와 cohort snapshot을 생성한다

동일 선수 relation과 팀컬러 대체 relation을 만든다.
시간 의존 feature는 `relation_snapshot.as_of`에 저장한다.

`CORE`, `META`, `PACK_EXPOSED`, `INDIRECT_EXPOSED`처럼 구성원이 변하는 cohort는 membership 유효 기간을 저장한다.

## 8. dataset snapshot과 analysis run을 구현한다

분석 input을 `dataset_snapshot`으로 고정하고 모든 Derived 계산을 `analysis_run`에서 실행한다.
Commit, analysis version, parameter hash를 결과와 함께 보존한다.

이 단계가 끝나기 전에는 수동으로 만든 숫자를 최종 report 값으로 사용하지 않는다.

## 9. 시장 metric을 구현한다

다음 순서로 계산한다:

1. instrument return
2. player return
3. `SAMPLE_MARKET` return과 index
4. cohort return과 index
5. relative strength
6. breadth
7. IQR과 MAD dispersion

데이터 충분성 기준을 각 단계에서 적용한다.
기준 미달은 `NO_RESULT`로 유지한다.

## 10. Event study와 replay를 구현한다

D−7부터 D+7까지 기본 window를 계산한다.
Replay query는 `analysis_cutoff` 뒤의 usage, relation snapshot, cohort membership을 읽지 못하게 제한한다.

라커룸 토크 11화와 SSS 사건을 acceptance fixture가 아닌 실제 dataset replay로 실행한다.

## 11. Shock와 Regime 처리를 구현한다

30개 valid observation baseline과 robust z-score 계약으로 Shock candidate를 계산한다.
원인 annotation은 detector와 별도로 연결한다.

Regime marker는 공식 source와 수동 annotation으로 등록하고 기본 return 계산에서 경계를 차단한다.

## 12. Acceptance를 실행하고 결과를 검토한다

`poc/poc-plan.md`의 `AC-001`부터 `AC-014`까지 evidence를 남긴다.
하나라도 실패하면 PoC 완료로 표시하지 않는다.

기술적 acceptance가 모두 통과한 뒤에만 지표의 실질적 의미, 공개 서비스 가능성, 추가 통계 모델 필요성을 검토한다.
