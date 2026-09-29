---
meta:
  contentType: Reference
---

# 시장 데이터를 어떤 도메인으로 표현하는가

이 문서는 선수, 시장 instrument, 가격, 관계, 이벤트, 상품, cohort를 저장하는 도메인 경계를 정의한다.
과거 replay에서 미래 정보를 참조하지 않도록 시간 유효성을 first-class data로 취급한다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 선수와 시장 instrument를 분리한다

실존 선수, 클래스 카드, 강화단계 시장 자산을 서로 다른 identity로 관리한다.

```text
player
- player_id
- name

player_card
- spid
- player_id
- season

instrument
- instrument_id
- spid
- grade
```

분석의 최소 시장 단위는 `spid + grade`다.
같은 클래스라도 grade가 다르면 가격과 공급 조건이 다를 수 있다.

## metadata를 시점 단위로 저장한다

급여, 포지션, OVR, 세부 능력치, 특성, 팀컬러 정보는 게임 업데이트로 달라질 수 있다.
replay가 현재 metadata를 과거에 적용하지 않도록 snapshot 또는 유효 기간을 저장한다.

```text
metadata_snapshot
- metadata_snapshot_id
- spid
- observed_at
- valid_from
- valid_to
- salary
- positions
- ovr
- stats
- traits
- source_snapshot_id
```

팀컬러 membership도 유효 기간을 가진다:

```text
team_color_membership
- team_color_id
- spid
- valid_from
- valid_to
- source_snapshot_id
```

## 가격과 사용량을 observation으로 저장한다

가격과 랭커 사용 데이터는 관측값과 관측 시점을 분리한다.

```text
price_point
- instrument_id
- source_timestamp
- observed_at
- value
- price_semantics
- source_snapshot_id
- quality_status

usage_point
- instrument_id
- as_of
- appearances
- usage_share
- performance_metrics
- source_snapshot_id
```

`usage_point.as_of` 이후의 replay에는 해당 row를 사용할 수 있다.
그 이전 replay에는 사용할 수 없다.

## 관계를 정적 feature와 시점 feature로 분리한다

카드 관계는 그래프로 해석할 수 있지만 PoC 저장소는 관계형 table을 사용한다.
동일 선수 여부처럼 안정적인 feature와 가격 비율처럼 시간에 따라 바뀌는 feature를 분리한다.

```text
card_relation
- relation_id
- source_instrument
- target_instrument
- same_player
- same_position
- relation_source
- valid_from
- valid_to

relation_snapshot
- relation_id
- as_of
- shared_team_colors
- salary_diff
- ovr_diff
- stat_distance
- price_ratio
- usage_distance
- movement_similarity
- definition_version
```

과거 replay는 `as_of <= analysis_cutoff`인 최신 snapshot만 선택한다.
`price_ratio`, `usage_distance`, `movement_similarity`를 현재 값으로 과거에 소급하지 않는다.

PoC는 관계 feature를 `SubstitutionScore` 같은 단일 점수로 합치지 않는다.

## 이벤트 시간을 분리한다

한 공지가 여러 사건을 포함하면 사건을 분리해 저장한다.
공지 시점과 실제 적용 시점을 합치지 않는다.

```text
event
- event_id
- event_type
- title
- announced_at
- effective_at
- ended_at
- first_observed_at
- source_snapshot_id
- confidence
- notes
```

초기 `event_type`은 다음 범위를 지원한다:

- `MAINTENANCE_NOTICE`
- `MAINTENANCE`
- `UPDATE_NOTICE`
- `GAMEPLAY_PATCH`
- `TRAIT_CHANGE`
- `NEW_CLASS`
- `EVENT_START`
- `EVENT_END`
- `BURNING`
- `PAID_PRODUCT_START`
- `PAID_PRODUCT_END`
- `MEMBERSHIP_RESET`
- `BP_SUPPLY`
- `PLAYER_SUPPLY`
- `FEE_CHANGE`
- `MARKET_RULE_CHANGE`
- `INCIDENT`
- `COMPENSATION`
- `UNKNOWN_SHOCK`

Shock detection 결과와 원인 사건은 별도 row로 유지한다.
원인이 나중에 확인되면 link를 추가하고 기존 관측을 덮어쓰지 않는다.

## 상품과 reward를 분리한다

상품 판매 정보와 reward 조건을 분리하면 BP 공급형과 선수 공급형을 구별할 수 있다.

```text
product
- product_id
- name
- sale_start
- sale_end
- price
- currency
- purchase_limit
- channel
- source_snapshot_id

reward
- reward_id
- product_id
- reward_type
- quantity
- probability
- class_filter
- grade_min
- grade_max
- ovr_min
- top_price_n
```

`reward_type`은 최소 BP, FC, MC, 선수팩, 선택팩, 교환 토큰, 기타 아이템을 지원한다.
상품 효율과 시장 공급 효과를 같은 값으로 저장하지 않는다.

## exposure를 사건과 시간에 연결한다

직접 공급과 간접 영향 후보를 이벤트 또는 상품에 연결한다.

```text
exposure
- exposure_id
- event_id
- product_id
- instrument_id
- exposure_type
- valid_from
- valid_to
- source
- confidence
```

`exposure_type`은 `DIRECT`와 `INDIRECT`를 우선 지원한다.
`INDIRECT`는 관계 rule과 snapshot을 통해 생성했는지 사람이 annotation했는지 source에 남긴다.

## cohort definition과 membership을 분리한다

Cohort 이름은 규칙이고 실제 구성원은 시간에 따라 달라질 수 있다.
definition과 membership을 분리해 과거 구성원을 재현한다.

```text
cohort_definition
- cohort_id
- name
- aggregation_level
- rule_version
- rule_params

cohort_membership
- cohort_id
- instrument_id
- valid_from
- valid_to
- membership_source
- confidence
```

초기 cohort는 다음과 같다:

| Cohort                  | 의미                                                    | 기본 aggregation |
| ----------------------- | ------------------------------------------------------- | ---------------- |
| `SAMPLE_MARKET`         | 고정한 20–30명 seed player 표본                         | `PLAYER`         |
| `CORE`                  | 장기간 실사용 수요가 높은 수동 seed 또는 rule 기반 집합 | `PLAYER`         |
| `HIGH_END`              | 표본 내 상위 가격대 rule에 포함된 집합                  | `PLAYER`         |
| `PREMIUM_SCARCE`        | 희소성과 고가 수요 근거를 수동 annotation한 집합        | `PLAYER`         |
| `PACK_EXPOSED`          | 특정 상품 또는 이벤트의 직접 공급 instrument            | `PLAYER`         |
| `INDIRECT_EXPOSED`      | 직접 공급 instrument의 당시 대체 후보                   | `PLAYER`         |
| `META`                  | 당시 랭커 사용량 rule을 충족한 집합                     | `PLAYER`         |
| `FODDER`                | 강화 재료 성격 rule에 포함된 집합                       | `PLAYER`         |
| `SAME_PLAYER`           | 한 실존 선수의 여러 instrument                          | `INSTRUMENT`     |
| `TEAM_COLOR_SUBSTITUTE` | 당시 팀컬러와 포지션 조건을 공유한 대체 후보            | `PLAYER`         |

`SAMPLE_MARKET`이라는 이름으로 표본 범위를 명시한다.
PoC 결과에서 이를 FC온라인 전체 시장과 같은 의미로 표현하지 않는다.

## Regime을 가격 의미와 연결한다

Regime은 가격 형성 구조 자체가 달라지는 기간이다.
기준가 계산 규칙, 거래 시스템, 급여 체계처럼 해석의 전제를 바꾸는 사건을 marker로 저장한다.

```text
regime
- regime_id
- regime_type
- valid_from
- valid_to
- event_id
- notes
```

Regime 이전 데이터를 삭제하지 않는다. 분석은 경계를 넘는 비교를 기본적으로 차단하고 필요할 때 명시적 option으로 허용한다.
