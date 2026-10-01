---
meta:
  contentType: Reference
---

# PoC 다음 단계에서 시장 대표성을 어떻게 높이는가

이 문서는 고정된 20명 `SAMPLE_MARKET`을 보존하면서 더 넓은 FC온라인 이적시장을 설명할 benchmark를 설계한다. 다음 단계는 전체 카드의 장기 가격을 전수 수집하는 대신 모집단 구조를 먼저 고정하고, 층화 표본과 가중치, 불확실성, 패널 수렴 검증으로 시장 대표성을 높인다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 이번 단계의 목표와 완료 조건

`MARKET_BENCHMARK_V1`은 PoC에서 확인한 분석 구조를 실제 시장 benchmark로 확장한다. 이 단계는 표본 수 자체보다 표본이 어떤 모집단을 대표하며 결과가 얼마나 안정적인지 설명할 수 있어야 완료된다.

완료 판정은 다음 결과를 요구한다:

- 공식 metadata 기준의 versioned universe snapshot을 재현할 수 있다
- 고정 PoC sample과 확장 benchmark panel을 서로 다른 identity로 보존한다
- 확장 panel의 각 member에 stratum, inclusion probability, population weight를 연결한다
- `BROAD_MARKET`의 return, index, breadth, dispersion을 가중 집계한다
- player 단위 bootstrap으로 95% confidence interval을 계산한다
- 100, 200, 400, 800 player 중첩 panel에서 수렴 여부를 계산한다
- 수렴하지 않은 benchmark를 `STABLE`로 표시하지 않는다
- Viewer가 표본 크기, 모집단 크기, coverage, confidence interval, panel version을 함께 표시한다

현재 PoC의 `AC-001`–`AC-014`는 변경하지 않는다. 이 문서의 acceptance는 PoC 완료 기록 위에 추가되는 별도 제품 단계다.

## 기존 `SAMPLE_MARKET`은 회귀 기준으로 유지한다

현재 `SAMPLE_MARKET`은 2026년 9월 29일 Daily Chart를 근거로 선택한 frozen seed다. 이 sample은 이미 canonical acceptance와 replay의 입력이므로 구성원을 바꾸거나 같은 catalog ID로 재생성하지 않는다.

확장 단계는 다음 역할을 분리한다:

| 범위 | 역할 | membership 정책 | 기본 집계 |
| --- | --- | --- | --- |
| `SAMPLE_MARKET` | PoC 회귀와 canonical replay | 기존 frozen catalog 유지 | 기존 metric version 유지 |
| `BROAD_MARKET` | 가격 관측이 가능한 시장의 대표 benchmark | versioned panel | population-weighted player aggregation |
| `META_MARKET` | usage가 관측된 실사용 시장 비교 | 시점별 cohort | player aggregation |
| `PREMIUM_MARKET` | 고가와 희소 구간 비교 | 시점별 cohort | player aggregation |

새 benchmark가 준비돼도 과거 `SAMPLE_MARKET` 결과를 다시 계산해 덮어쓰지 않는다. `analysis_version`과 `panel_id`가 어떤 benchmark를 사용했는지 명시한다.

## 모집단을 세 단계로 나눈다

전체 공식 catalog와 실제 분석 가능한 시장을 같은 집합으로 취급하지 않는다. Universe snapshot은 다음 세 범위를 구분한다:

| universe | 포함 조건 | 사용 목적 |
| --- | --- | --- |
| `CATALOG_UNIVERSE` | 공식 metadata에 존재하는 player card | 전체 catalog 구조와 identity 파악 |
| `PRICE_ELIGIBLE_UNIVERSE` | 현재 가격 semantics가 확인되고 유효 가격 observation이 존재 | benchmark panel 추출 모집단 |
| `ANALYSIS_ELIGIBLE_UNIVERSE` | 요청한 metric의 history와 품질 기준을 충족 | 해당 analysis run의 실제 계산 모집단 |

`player_card`가 존재한다는 이유로 가능한 grade를 기계적으로 생성하지 않는다. `instrument`는 가격 source에서 실제로 관측했거나 별도 source evidence로 존재를 확인한 `spid + grade`만 universe에 포함한다.

Universe snapshot은 `as_of` 시점에 고정한다. 이후 신규 class나 metadata 변경이 생기면 기존 snapshot을 수정하지 않고 새 snapshot을 만든다.

## player를 시장 표본의 기본 단위로 사용한다

한 선수가 많은 class와 grade를 가진다는 이유로 시장 benchmark에서 더 큰 가중치를 받지 않게 player를 1차 sampling unit으로 사용한다. 각 sampled player는 시장 benchmark에 사용할 anchor instrument 하나를 가진다.

동일 선수의 다른 class와 grade는 relation, substitution, event exposure 분석을 위한 supplemental instrument로 추적한다. Supplemental instrument 수는 해당 player의 시장 가중치를 늘리지 않는다.

Anchor instrument는 panel 생성 시점의 결정 규칙으로 선택한다. 초기 규칙은 현재 사용 근거, 가격 유효성, history coverage를 순서대로 적용하며 선택 근거를 panel member에 저장한다.

## 가격과 usage를 기준으로 층화한다

첫 benchmark는 과도한 cell 분할을 피하기 위해 `usage_band × price_band`를 primary stratum으로 사용한다. 포지션과 class age는 표본 균형을 확인하는 diagnostic으로 먼저 사용하고 primary stratum에는 넣지 않는다.

`usage_band`는 source가 제공하는 관측 범위를 보존한다:

- `HIGH_OBSERVED`: usage observation이 있는 player 중 상위 구간
- `MID_OBSERVED`: usage observation이 있는 player 중 중간 구간
- `LOW_OBSERVED`: usage observation이 있는 player 중 하위 구간
- `UNOBSERVED`: source에서 usage observation을 확인하지 못한 player

`UNOBSERVED`를 사용량 0으로 해석하지 않는다. Usage source의 노출 범위가 바뀌면 band rule version을 새로 만든다.

`price_band`는 `PRICE_ELIGIBLE_UNIVERSE`의 anchor price 분포로 계산한다:

- `P00_50`: 0–50 percentile
- `P50_80`: 50–80 percentile
- `P80_95`: 80–95 percentile
- `P95_100`: 95–100 percentile

Percentile 경계는 universe snapshot에 저장한다. 절대 가격 기준을 코드에 고정하지 않는다.

## 작은 층을 의도적으로 더 관측한다

표본은 단순 비례 추출만 사용하지 않는다. 작은 고가층과 usage tail이 사라지지 않게 non-empty stratum에 최소 quota를 먼저 배정하고, 남은 quota는 `sqrt(population_count)`에 비례해 배정한다.

각 stratum `h`는 다음 값을 저장한다:

```text
N_h = universe의 player 수
n_h = panel의 sampled player 수
base_weight_h = N_h / n_h
```

결측 player의 weight를 다른 player에게 이월하지 않는다. 각 날짜는 다음 weighted coverage를 계산하고 0.80 미만이면 benchmark metric을 `NO_RESULT`로 처리한다.

```text
weighted_coverage(t)
  = sum(weight_p where player_return_p(t) is valid)
    / sum(weight_p for panel members)
```

## panel selection을 결정론적으로 만든다

같은 universe snapshot, panel version, sampling seed는 항상 같은 player를 선택해야 한다. 각 stratum 안에서 stable hash rank를 만들고 rank가 낮은 player부터 선택한다.

중첩 panel은 같은 rank를 공유한다:

```text
P100 ⊂ P200 ⊂ P400 ⊂ P800
```

이 구조는 panel 크기만 달라졌을 때 metric이 얼마나 변하는지 직접 비교할 수 있게 한다. 결과를 보고 sample member를 수동 교체하지 않는다.

## 현재 panel의 과거 가격은 fixed-panel history로 표시한다

현재 universe snapshot에서 뽑은 panel에 과거 가격 history가 존재해도 과거 시점의 시장 구성까지 복원한 것은 아니다. Panel selection에 현재 metadata, usage, price eligibility가 들어가므로 panel 생성 이전 구간은 `FIXED_PANEL_BACKCAST`로 표시한다.

`FIXED_PANEL_BACKCAST`는 현재 선정된 player 집합이 과거에 어떻게 움직였는지 보여주는 참고 series다. 해당 날짜의 전체 FC온라인 시장을 대표했다고 표현하지 않는다.

Contemporaneous `BROAD_MARKET`은 panel의 `effective_from` 이후 구간에서만 사용한다. 이후 universe를 갱신할 때는 새 `panel_id`와 `effective_from`을 만들고 과거 metric row를 다시 쓰지 않는다.

Panel rebalance는 기존 [데이터 계약](../data/data-contract.md)의 metadata 갱신 주기를 따르는 별도 version으로 처리한다. 새 panel이 시작되는 날의 index level은 이전 stable panel의 마지막 index를 이어받고 이후 return만 새 panel로 계산한다.

## `BROAD_MARKET`은 population weight를 사용한다

`BROAD_MARKET`은 sampled player를 동일 가중으로 취급하지 않는다. 각 player는 자신이 속한 stratum의 `base_weight_h`를 사용한다.

시장 return은 weighted median을 사용한다:

```text
broad_market_return(t)
  = weighted_median(player_return_p(t), player_weight_p)
```

Breadth는 가중 상승 비율을 사용한다:

```text
broad_market_breadth(t)
  = sum(weight_p where player_return_p(t) > 0)
    / sum(weight_p where player_return_p(t) is valid)
```

Dispersion은 weighted quantile과 weighted median absolute deviation을 사용한다. Index는 현재와 같이 기준값 100에서 return을 누적한다.

`META_MARKET`은 usage source의 모집단 coverage 의미가 확정되기 전까지 usage count를 population weight로 사용하지 않는다. Usage count를 가중치로 도입하려면 별도 analysis version과 Architecture Decision Record (ADR)를 추가한다.

## player 단위로 불확실성을 계산한다

확장 benchmark는 점 추정치만 표시하지 않는다. 각 metric은 stratified player bootstrap으로 95% confidence interval을 계산한다.

Bootstrap은 다음 계약을 따른다:

1. 각 stratum 안에서 player를 replacement 방식으로 다시 뽑는다
2. 한 player의 전체 시계열과 supplemental instrument 묶음을 같은 replicate에 유지한다
3. replicate마다 동일 metric pipeline을 실행한다
4. 기본 replicate 수는 1,000회로 시작한다
5. deterministic pseudo-random seed를 `analysis_run` parameter에 저장한다

날짜마다 player를 독립적으로 다시 뽑지 않는다. Player의 시계열 의존성을 유지해야 event window와 index path를 같은 replicate 안에서 비교할 수 있다.

Stratum 내부 player 수가 bootstrap을 지원하지 못하면 confidence interval을 만들지 않고 `INSUFFICIENT_UNCERTAINTY_SAMPLE`을 반환한다.

## 중첩 panel로 표본 수렴을 검증한다

표본 크기는 고정 숫자를 먼저 정하고 끝내지 않는다. `P100`, `P200`, `P400`, `P800`의 동일 기간 결과를 비교해 작은 panel과 다음 큰 panel의 차이를 계산한다.

인접 panel pair는 최소 60개 공통 valid 분석일에서 다음 초기 기준을 모두 만족해야 `PASS`다:

- daily return의 median absolute difference가 0.25 percentage point 이하
- daily return의 95th percentile absolute difference가 1.00 percentage point 이하
- 0이 아닌 daily return의 방향 일치율이 90% 이상
- breadth의 median absolute difference가 0.05 이하

초기 production panel은 양쪽 인접 pair가 모두 `PASS`인 가장 작은 중간 크기를 선택한다. 예를 들어 `P100↔P200`과 `P200↔P400`이 모두 통과하면 `P200`을 선택한다.

`P400↔P800`까지 통과하지 못하면 benchmark를 `UNSTABLE`로 표시한다. 이 상태에서는 표본 수를 더 늘리거나 stratum rule을 수정한 새 panel version을 만든다.

수렴 threshold는 첫 실데이터 검증 후 조정할 수 있다. 변경할 때는 기존 결과를 수정하지 않고 parameter version과 ADR을 새로 남긴다.

## 대규모 가격 수집 전에 수집 가능성을 다시 확인한다

Metadata universe 확대와 가격 history 확대는 다른 작업이다. 공식 metadata로 `CATALOG_UNIVERSE`를 만들 수 있어도 수백 player의 가격 history를 같은 방식으로 수집할 수 있다는 뜻은 아니다.

`Gate 1A`는 `P100` 수집 전에 다음 항목을 다시 확인한다:

- 현재 price source의 policy evidence와 automation decision이 유효하다
- 선택한 수집 방식이 기존 Gate 0A 경계를 위반하지 않는다
- pilot instrument에서 동일한 price semantics를 유지한다
- HTTP 403, HTTP 429, CAPTCHA 또는 접근 제한 신호에서 collector가 중단한다
- 수집 실패와 stale source를 가격 0으로 변환하지 않는다
- operator가 panel 확장 batch를 명시적으로 시작한다

현재 `MANUAL_ONLY` 판단을 panel 확장만으로 `ALLOWED`로 바꾸지 않는다. 정책 근거가 달라지면 새 Gate evidence로 판정을 갱신한다.

## target data model을 추가한다

구현은 기존 `dataset_snapshot`과 `analysis_run` provenance를 유지하면서 다음 identity를 추가한다:

| entity | 핵심 필드 | 책임 |
| --- | --- | --- |
| `market_universe_snapshot` | `universe_snapshot_id`, `as_of`, `rule_version`, `source_hash` | 모집단 시점과 생성 규칙 고정 |
| `market_universe_member` | `universe_snapshot_id`, `player_id`, `anchor_instrument_id`, eligibility fields | player별 universe 상태 저장 |
| `benchmark_stratum` | `panel_id`, `stratum_id`, `population_count`, band boundaries | 층 정의와 모집단 크기 저장 |
| `benchmark_panel` | `panel_id`, `universe_snapshot_id`, `panel_version`, `sample_seed`, `target_size`, `status` | versioned panel identity 고정 |
| `benchmark_panel_member` | `panel_id`, `player_id`, `anchor_instrument_id`, `stratum_id`, `inclusion_probability`, `population_weight` | 표본 member와 weight 저장 |
| `metric_uncertainty` | `analysis_run_id`, `scope_id`, `metric_date`, `metric_name`, `lower`, `upper`, `method`, `replicates` | confidence interval provenance 저장 |
| `panel_convergence` | `analysis_run_id`, `smaller_panel_id`, `larger_panel_id`, comparison metrics, `status` | 표본 수렴 판정 저장 |

`dataset_snapshot`은 analysis run에 실제로 사용한 universe, panel, price point를 freeze해야 한다. Panel definition만 저장하고 당시 입력 row를 나중에 다시 조회하지 않는다.

## Viewer는 숫자와 신뢰도를 같이 보여준다

시장 요약 화면은 `BROAD_MARKET`, `META_MARKET`, `PREMIUM_MARKET`을 분리한다. `BROAD_MARKET`을 전체 시장의 확정값처럼 표시하지 않고 sampled benchmark임을 함께 보여준다.

각 market card는 최소 다음 값을 표시한다:

- 1일 return과 index
- breadth와 dispersion
- 95% confidence interval
- valid player 수와 panel target size
- price-eligible universe player 수
- panel version과 universe snapshot date
- convergence status

`UNSTABLE`, `INSUFFICIENT`, `PARTIAL_COVERAGE` 상태에서는 해석 문구의 강도를 낮추고 원인을 같이 표시한다. Confidence interval과 coverage를 숨긴 채 점 추정치만 강조하지 않는다.

## 구현은 일곱 단계로 진행한다

제품 확장은 현재 12단계 PoC 구현 뒤에 이어서 진행한다:

1. `13. Universe snapshot`: 공식 metadata와 현재 price eligibility로 universe를 생성한다
2. `14. Panel builder`: stratum과 deterministic nested panel을 생성한다
3. `15. Panel collection`: `Gate 1A`를 통과한 방식으로 `P100`부터 순차 수집한다
4. `16. Weighted metrics`: population-weighted return, breadth, dispersion, index를 구현한다
5. `17. Uncertainty`: stratified player bootstrap과 confidence interval을 구현한다
6. `18. Convergence`: nested panel pair를 비교하고 `STABLE` 또는 `UNSTABLE`을 판정한다
7. `19. Viewer and acceptance`: benchmark 정보와 안정성을 화면에 노출하고 확장 acceptance를 실행한다

각 단계는 이전 단계의 identity와 provenance를 입력으로 사용한다. Panel 수렴을 확인하기 전에 기존 `SAMPLE_MARKET`을 새 benchmark로 대체하지 않는다.

## 확장 acceptance를 별도로 운영한다

`MARKET_BENCHMARK_V1`은 다음 acceptance를 모두 통과해야 완료된다:

- `MB-001`: 같은 source와 cutoff에서 universe snapshot ID와 member set이 재현된다
- `MB-002`: evidence가 없는 grade를 cartesian product로 생성하지 않는다
- `MB-003`: 같은 universe, rule version, sample seed에서 panel member set이 재현된다
- `MB-004`: 기존 frozen `SAMPLE_MARKET` catalog와 canonical run hash가 변경되지 않는다
- `MB-005`: 모든 benchmark member에 stratum과 population weight가 존재한다
- `MB-006`: weighted return, breadth, dispersion fixture가 expected value와 일치한다
- `MB-007`: bootstrap 결과가 같은 seed와 input에서 재현된다
- `MB-008`: confidence interval을 만들 수 없는 입력은 숫자 대신 명시적 상태를 반환한다
- `MB-009`: nested panel convergence가 versioned threshold로 판정된다
- `MB-010`: `P400↔P800`까지 안정화되지 않으면 benchmark status가 `UNSTABLE`이다
- `MB-011`: Viewer가 point estimate와 confidence interval, coverage, panel version을 함께 표시한다
- `MB-012`: `analysis_run -> dataset_snapshot -> panel -> universe -> source_snapshot` 추적 경로가 유지된다
- `MB-013`: panel 생성 이전 series는 `FIXED_PANEL_BACKCAST`로 표시되고 contemporaneous market으로 노출되지 않는다
- `MB-014`: 새 panel version의 `effective_from` 이후 metric만 새 membership을 사용하며 과거 row를 덮어쓰지 않는다

`MB-001`–`MB-014`가 모두 통과해도 가격 예측 정확도나 공개 서비스 사업성을 검증한 것으로 해석하지 않는다.

## 이번 단계에서 하지 않는 일

이번 확장은 다음 항목을 구현 목표로 두지 않는다:

- 모든 FC온라인 instrument의 365일 가격 history 전수 수집
- 거래량이나 유통량을 추정한 시가총액 가중 index
- 사용량 source가 제공하지 않는 grade별 usage 생성
- benchmark 결과를 이용한 구매 또는 매도 추천
- 사건과 가격 변화의 인과관계 단정
- Python을 필수 런타임으로 추가
- 생성형 인공지능을 핵심 metric 계산에 사용

남은 source 정책, 운영비, 장기 usage history, 공개 배포 질문은 [리스크와 후속 판단](../risks/risks-and-roadmap.md)에서 관리한다.
