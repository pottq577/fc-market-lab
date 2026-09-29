---
meta:
  contentType: Reference
---

# 시장 상태를 어떻게 계산하고 해석하는가

이 문서는 가격 observation을 시장 지표로 변환하는 계산 계약을 정의한다.
PoC는 설명 가능한 통계와 시점 일관성을 우선하며, 모든 결과는 `analysis_run`으로 재현할 수 있어야 한다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 외부 요인과 내부 요인을 분리한다

분석 feature는 발생 원인에 따라 두 범주로 나눈다.
외부 사건과 카드 자체 특성을 하나의 합성 feature로 섞지 않는다.

외부 요인은 다음 범위를 포함한다:

- 점검과 업데이트 공지
- 정기점검과 실제 적용
- 신규 클래스와 특성 변경
- 이벤트와 버닝
- 유료상품과 선수팩
- BP 지급과 보상
- 멤버십
- 수수료 정책
- 기준가 산정 규칙
- 운영 사고와 후속 대응

내부 요인은 다음 범위를 포함한다:

- 동일 선수의 다른 클래스
- 급여와 OVR 차이
- 포지션과 주요 능력치
- 특성과 신체 조건
- 소속팀, 국가, 팀컬러
- 대체재 수와 관계 feature
- 랭커 사용량과 경기 기록
- 가격대와 grade
- 희소성 annotation

월초, 월말, 요일 같은 calendar 값은 원인으로 고정하지 않는다.
같은 기간에 반복되는 상품, 멤버십, 이벤트와 함께 관측한다.

## instrument 수익률을 계산한다

가격 분석은 동일한 `price_semantics`와 Regime 안에서만 기본 수익률을 계산한다.
인접 분석 시점 중 하나라도 invalid이면 `NO_RESULT`를 반환한다.

```text
instrument_return_i(t) = price_i(t) / price_i(t - 1) - 1
```

일별 series는 `data/data-contract.md`의 cutoff 규칙을 따른다.
누락값을 자동 forward-fill하지 않는다.

## 같은 선수가 지수를 과도하게 지배하지 않게 한다

한 선수가 많은 class와 grade를 가진다는 이유로 `SAMPLE_MARKET`에서 더 큰 가중치를 받지 않게 계층 집계를 사용한다.

```text
player_return_p(t) = median(instrument_return_i(t) for player p)
sample_market_return(t) = median(player_return_p(t) for seed players)
```

`SAMPLE_MARKET`과 여러 선수를 포함하는 cohort의 기본 aggregation level은 `PLAYER`다.
`SAME_PLAYER`처럼 한 선수 내부 instrument를 비교하는 cohort는 `INSTRUMENT`를 사용한다.

Cohort definition은 `aggregation_level`을 명시한다.
계산 시 암묵적으로 aggregation level을 바꾸지 않는다.

## 지수를 누적한다

Index는 기준값 100에서 시작해 기간 return을 누적한다:

```text
index(t) = index(t - 1) * (1 + return(t))
```

Index는 가격 총액이나 시가총액을 의미하지 않는다.
전체 유통량과 거래량을 알 수 없기 때문에 대표 표본의 상대 변화만 표현한다.

## 데이터 충분성 기준을 적용한다

Metric은 충분한 aggregation unit이 존재할 때만 결과를 생성한다.
기준 미만에서는 임의의 값이나 0을 반환하지 않는다.

`SAMPLE_MARKET`의 기본 조건은 다음과 같다:

- valid seed player가 최소 10명이어야 한다
- frozen seed sample의 60% 이상이 valid해야 한다

다른 cross-player cohort의 기본 조건은 다음과 같다:

- valid aggregation unit이 최소 3개여야 한다
- 해당 시점 membership의 60% 이상이 valid해야 한다

Metric version은 `min_valid_count`와 `min_coverage_ratio`를 parameter로 저장한다.
PoC 결과가 threshold에 민감하면 threshold 변경을 ADR로 남긴다.

## breadth를 계산한다

`breadth`는 valid aggregation unit 중 return이 0보다 큰 비율이다:

```text
breadth(t) = count(return > 0) / count(valid return)
```

Aggregation unit은 cohort definition을 따른다.
`PLAYER` cohort에서는 player return을 사용한다.

## 상대강도를 계산한다

Cohort의 nominal 변화와 표본 시장의 공통 움직임을 분리하기 위해 상대강도를 사용한다:

```text
relative_strength(t)
  = cohort_return(t) - sample_market_return(t)
```

이 값은 인과 효과가 아니다.
같은 기간 `SAMPLE_MARKET` 대비 상대 차이를 표현한다.

## dispersion을 계산한다

시장 내부의 움직임이 얼마나 갈라지는지 확인하기 위해 Interquartile Range (IQR)와 Median Absolute Deviation (MAD)을 사용한다.
두 지표는 극단값 하나가 전체 결과를 지배하는 문제를 줄인다.

PoC는 표준편차를 기본 dispersion으로 사용하지 않는다.
필요하면 별도 metric version으로 추가한다.

## 이벤트 전후 window를 비교한다

이벤트 study는 다음 기본 window를 제공한다:

- D−7
- D−3
- D−1
- D
- D+1
- D+3
- D+7

원본 granularity가 일 단위면 시간 단위 값을 생성하지 않는다.
더 세밀한 source를 확보하면 별도 metric version에서 시간 단위 window를 추가한다.

비교군은 가능한 범위에서 다음 조건을 맞춘다:

- 가격대
- 포지션
- grade
- OVR
- 급여
- 당시 사용량

비교군을 사용해도 영향이 입증됐다고 표현하지 않는다.
사건 전후와 `SAMPLE_MARKET` 대비 차이가 관측됐다고 표현한다.

## 미래 정보를 replay에 사용하지 않는다

Event replay는 `analysis_cutoff`을 가진다. 다음 조건을 모두 만족한 데이터만 사용할 수 있다:

- `source_snapshot.observed_at <= analysis_cutoff`
- `usage_point.as_of <= analysis_cutoff`
- `relation_snapshot.as_of <= analysis_cutoff`
- `cohort_membership.valid_from <= analysis_cutoff`
- membership의 `valid_to`가 있으면 `analysis_cutoff < valid_to`

현재 시점의 META membership이나 가격 비율을 과거 사건에 적용하지 않는다.
이 규칙은 테스트 fixture로 검증한다.

## Shock candidate를 탐지한다

Shock는 원인을 모르는 상태에서도 탐지할 수 있는 통계적 이상 움직임이다.
PoC는 설정한 metric의 최근 30개 valid observation을 baseline으로 사용한다.

다음 robust z-score를 사용한다:

```text
robust_z(t) = 0.6745 * (x(t) - median(window)) / MAD(window)
```

기본 판정 계약은 다음과 같다:

- baseline에 최소 20개 valid observation이 있어야 한다
- `MAD = 0`이면 score를 만들지 않고 `NO_RESULT`를 반환한다
- `abs(robust_z) >= 3.5`이면 Shock candidate를 생성한다
- severity는 category로 임의 압축하지 않고 `abs(robust_z)` numeric value를 저장한다
- detector는 원인을 지정하지 않는다

후속 공지나 annotation으로 원인이 확인되면 `UNKNOWN_SHOCK`와 별도 event를 연결한다.
기존 detector 결과를 수정하지 않는다.

## Regime은 PoC에서 사람이 지정한다

Regime은 기준가 규칙처럼 가격의 생성 구조 자체가 달라진 기간이다.
초기 PoC에서는 자동 탐지하지 않고 공식 source와 수동 annotation으로 marker를 등록한다.

다음 변화가 Regime 후보가 될 수 있다:

- 기준가 계산 규칙 변경
- 거래 시스템 변경
- 광범위한 즉시판매 정책
- 급여 시스템 개편
- 장기간 지속되는 공급 구조 변경

## 결과를 네 단계로 표현한다

분석 결과는 다음 구분을 유지한다:

1. 사실: source에서 확인한 사건과 원본 observation
2. 계산: metric version이 생성한 수치
3. 해석: 수치 간 상대 관계에 대한 설명
4. 가설: 관측 차이를 설명할 수 있는 후보 요인

가설을 사실로 표현하지 않는다. 미래 가격을 단정하거나 구매 행동을 추천하지 않는다.
