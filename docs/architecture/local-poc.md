---
meta:
  contentType: Reference
---

# 로컬 PoC를 어떻게 구성하고 재현하는가

이 문서는 상시 서버 없이 로컬에서 실행하는 PoC의 데이터 계층, 분석 실행 단위, 프로젝트 구조를 정의한다.
구현 목표는 같은 dataset과 analysis version에서 같은 결과를 다시 만드는 것이다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 데이터 흐름

PoC는 source에서 report까지 다음 흐름을 사용한다:

```text
Official sources / manual annotation
  -> Raw snapshots
  -> Normalized database
  -> dataset_snapshot
  -> relation and cohort snapshots
  -> analysis_run
  -> Derived metrics and event studies
  -> Local report or dashboard
```

초기 database는 SQLite를 사용한다.
분석량이나 병렬 query가 실제 병목이 되면 DuckDB 또는 PostgreSQL 전환을 별도 ADR로 검토한다.

## Raw를 불변으로 보존한다

Raw 계층은 source에서 받은 원문과 수집 context를 보존한다.
Normalized row를 다시 만들 수 있는 정보를 남긴다.

```text
source_snapshot
- source_snapshot_id
- source_type
- source_url
- source_timestamp
- observed_at
- raw_payload
- raw_hash
- collector_version
- policy_evidence_id
```

Raw payload를 정규화 과정에서 덮어쓰지 않는다.
source가 같은 값을 다시 반환해도 별도 observation이 필요한 경우 새로운 snapshot으로 저장한다.

## Normalized를 도메인 기준으로 저장한다

Normalized 계층은 source별 응답 구조를 분석 domain으로 변환한다.
주요 table은 다음과 같다:

- `player`
- `player_card`
- `instrument`
- `metadata_snapshot`
- `price_point`
- `usage_point`
- `team_color`
- `team_color_membership`
- `card_relation`
- `relation_snapshot`
- `event`
- `product`
- `reward`
- `exposure`
- `cohort_definition`
- `cohort_membership`
- `regime`

Normalized row는 가능한 경우 `source_snapshot_id`를 보존한다.

## dataset snapshot을 고정한다

동일한 database가 시간이 지나며 변해도 과거 분석을 재현할 수 있도록 분석 input 범위를 snapshot으로 고정한다.

```text
dataset_snapshot
- dataset_snapshot_id
- cutoff_at
- source_set_hash
- schema_version
- created_at
```

`source_set_hash`는 분석에 포함된 raw source set을 식별한다.
구현은 동일한 `dataset_snapshot_id`가 같은 input 범위를 가리키게 해야 한다.

## analysis run을 파생 결과의 root로 사용한다

모든 Derived row는 `analysis_run`을 통해 코드와 parameter를 추적한다.

```text
analysis_run
- run_id
- dataset_snapshot_id
- code_commit
- analysis_version
- params_json
- params_hash
- timezone
- started_at
- completed_at
- status
```

`analysis_version`은 metric contract의 의미가 바뀔 때 갱신한다.
threshold만 바뀌어도 `params_hash`가 달라져야 한다.

Derived table은 최소 다음 결과를 포함한다:

- `sample_market_index`
- `cohort_index`
- `relative_strength`
- `breadth`
- `dispersion`
- `event_study`
- `shock_candidate`

각 row는 `run_id`를 저장한다. Regime은 source와 annotation에 기반한 domain data이므로 analysis run에서 새로 발명하지 않는다.

## 로컬 프로젝트 구조

코드는 수집, 정규화, 관계 생성, 분석을 분리한다:

```text
fc-market-lab/
  data/
    raw/
    fixtures/
    exports/
  db/
    migrations/
  src/
    catalog/
    ingest/
    normalize/
    relations/
    cohorts/
    metrics/
    studies/
    reports/
  tests/
```

Notebook을 기준 인터페이스로 사용하지 않는다. 핵심 작업은 TypeScript CLI 또는 로컬 웹 화면에서 실행할 수 있어야 한다.

## 테스트 범위

테스트는 계산 결과보다 계약 위반을 먼저 잡는다:

- 동일 raw input의 deterministic normalization
- missing, zero, fetch failure 구분
- Regime 경계 수익률 차단
- `PLAYER` aggregation이 instrument 수에 의해 편향되지 않는지 검증
- metric sufficiency 미달 시 `NO_RESULT`
- replay의 no-lookahead 조건
- 동일 dataset, version, params의 deterministic derived result
- derived row에서 raw source까지 provenance 역추적

실제 사건 replay는 fixture test와 별도로 PoC acceptance에서 검증한다.
