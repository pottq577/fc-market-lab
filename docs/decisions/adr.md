---
meta:
  contentType: Reference
---

# 왜 이 설계 결정을 선택했는가

이 문서는 FC온라인 이적시장 인텔리전스 PoC의 주요 ADR를 보존한다.
구현은 Accepted 상태의 결정을 기본값으로 사용하고, 의미가 바뀌면 기존 항목을 덮어쓰지 않고 새 ADR을 추가한다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## ADR-001: 가격 예측보다 시장 설명을 우선한다

이 결정은 제품의 출력 경계를 고정한다.

- 상태: Accepted
- 결정: 미래 가격 산출과 구매 추천을 제품 계약에서 제외한다
- 근거: 현재 확보 가능한 데이터는 시장 상태와 외부 사건을 설명하는 데 적합하다. 가격 예측은 별도 모델 위험과 검증 비용을 추가한다
- 결과: 화면과 report는 관측, 상대 비교, 과거 replay에 집중한다

## ADR-002: 20–30명 seed player로 PoC를 시작한다

전체 카드 수집 전에 데이터 접근성과 분석 구조를 검증한다.

- 상태: Accepted
- 결정: 장기 실사용과 시장 대표성을 고려한 20–30명 seed player를 선정한다
- 근거: 동일 선수의 여러 class와 grade만 포함해도 수백 instrument를 만들 수 있다
- 결과: PoC 결과는 전체 FC온라인 시장이 아니라 고정 표본을 설명한다

## ADR-003: `spid + grade`를 시장 instrument로 사용한다

같은 클래스라도 grade에 따라 가격과 공급 조건이 달라질 수 있다.

- 상태: Accepted
- 결정: `player`, `player_card`, `instrument` identity를 분리한다
- 근거: 실존 선수와 시장 거래 단위를 같은 entity로 두면 가격과 관계 분석이 섞인다
- 결과: 가격, exposure, cohort membership은 instrument를 기준으로 연결한다

## ADR-004: 대체관계를 first-class data로 저장한다

공급 충격은 직접 공급 카드 밖으로 전달될 수 있다.

- 상태: Accepted
- 결정: 동일 선수, 포지션, 팀컬러, 급여, 능력치, 가격, 사용량 관계를 별도 데이터로 저장한다
- 근거: 대체관계를 계산 시점에만 임시 생성하면 replay와 provenance가 어려워진다
- 결과: 정적 relation과 시점별 relation snapshot을 분리한다

## ADR-005: 설명 가능한 통계를 우선한다

PoC의 목적은 분석 구조를 검증하는 것이다.

- 상태: Accepted
- 결정: median, relative strength, breadth, Interquartile Range (IQR), Median Absolute Deviation (MAD)을 기본 통계로 사용한다
- 근거: 결과를 원본까지 역추적하고 사람이 계산 의미를 설명할 수 있어야 한다
- 결과: 회귀분석과 머신러닝은 PoC 필수요건에 포함하지 않는다

## ADR-006: 전체 시장 대신 `SAMPLE_MARKET`과 계층 median을 사용한다

표본과 전체 시장을 같은 이름으로 부르지 않고, class 수가 많은 선수가 지수를 과도하게 지배하지 않게 한다.

- 상태: Accepted
- 결정: 기존 `MARKET` 이름을 `SAMPLE_MARKET`으로 바꾸고 `instrument -> player -> sample` 순서로 median return을 집계한다
- 근거: instrument를 직접 동일 가중하면 class와 grade가 많은 선수가 더 큰 가중치를 가진다
- 결과: cross-player cohort의 기본 aggregation level은 `PLAYER`다

## ADR-007: 실사용성은 행동 데이터로 보조한다

세부 능력치만으로 실제 채택을 설명하지 않는다.

- 상태: Accepted
- 결정: 가능한 범위에서 랭커 사용량과 경기 기록을 사용한다
- 근거: 체감, 움직임, 팀컬러 적합성을 임의 능력치 가중합 하나로 표현하기 어렵다
- 결과: PoC는 별도의 실성능 종합점수를 만들지 않는다

## ADR-008: 공지와 적용 시간을 분리한다

시장은 실제 적용 전에 공개 정보를 반영할 수 있다.

- 상태: Accepted
- 결정: `announced_at`, `effective_at`, `ended_at`, `first_observed_at`을 분리한다
- 근거: 하나의 event timestamp만 저장하면 정보 선반영을 분석할 수 없다
- 결과: replay는 공지 반응과 적용 반응을 별도 window로 비교할 수 있다

## ADR-009: Shock detection과 원인 annotation을 분리한다

알려지지 않은 사건도 가격 분포 이탈로 먼저 관측할 수 있어야 한다.

- 상태: Accepted
- 결정: robust z-score 기반 Shock candidate를 생성하고 원인은 나중에 별도 event로 연결한다
- 근거: 운영 사고처럼 사전 taxonomy에 없는 사건이 발생할 수 있다
- 결과: detector 결과를 후속 설명에 맞춰 덮어쓰지 않는다

## ADR-010: 가격 형성 규칙 변경을 Regime으로 저장한다

가격 series가 이어져도 생성 메커니즘은 바뀔 수 있다.

- 상태: Accepted
- 결정: 기준가 규칙, 거래 시스템, 급여 체계처럼 해석 전제를 바꾸는 사건을 Regime marker로 저장한다
- 근거: 서로 다른 Regime을 연속된 동일 의미의 가격으로 계산하면 잘못된 수익률을 만들 수 있다
- 결과: 기본 metric은 Regime 경계를 넘는 return을 계산하지 않는다

## ADR-011: 데이터 이용 가능성을 자동 수집 구현보다 먼저 검증한다

기술적으로 endpoint에 접근할 수 있다는 사실만으로 자동 수집을 허용하지 않는다.

- 상태: Accepted
- 결정: source별 현행 이용 조건과 허용 범위를 Gate에서 확인한 뒤 collector를 구현한다
- 근거: Open API 약관과 데이터센터 자동 접근 조건은 같은 규칙이라고 가정할 수 없다
- 결과: `UNKNOWN` 또는 `REJECTED` source에는 자동 collector를 만들지 않는다

## ADR-012: Raw, Normalized, Derived 계층을 분리한다

분석 로직이 바뀌어도 원본을 다시 수집하지 않고 계산을 재생할 수 있어야 한다.

- 상태: Accepted
- 결정: Raw snapshot을 불변으로 보존하고 Normalized와 Derived를 재생성 가능하게 만든다
- 근거: source parser와 metric algorithm은 PoC 중 변경될 가능성이 높다
- 결과: Normalized row는 가능한 경우 `source_snapshot_id`를 보존한다

## ADR-013: 이벤트 annotation은 초기에는 사람이 한다

핵심 사건 수가 제한된 PoC에서는 수동 annotation이 검증 가능성이 높다.

- 상태: Accepted
- 결정: 공지 자동 자연어 분류를 PoC에서 제외한다
- 근거: 잘못된 자동 분류를 교정하는 비용보다 핵심 사건을 직접 입력하는 비용이 낮다
- 결과: source, confidence, notes를 사람이 기록한다

## ADR-014: cohort와 관계에 시간 유효성을 저장한다

현재 시장 구조를 과거 replay에 소급하면 look-ahead bias가 생긴다.

- 상태: Accepted
- 결정: cohort membership은 `valid_from/valid_to`, 관계와 사용량은 `as_of` 또는 유효 기간을 가진다
- 근거: `META`, `PACK_EXPOSED`, 가격 비율, 사용량은 시간에 따라 달라진다
- 결과: replay는 `analysis_cutoff` 이후 observation을 참조하지 않는다

## ADR-015: Python과 생성형 AI를 핵심 런타임 의존성에서 제외한다

PoC의 핵심 계산은 결정론적으로 실행할 수 있어야 한다.

- 상태: Accepted
- 결정: SQL과 TypeScript로 수집, 정규화, metric, replay를 구현할 수 있게 설계한다
- 근거: 현재 분석 계약에는 Python 전용 기능이나 생성형 인공지능 판단이 필요하지 않다
- 결과: Python은 후속 통계 실험에 선택적으로 추가하고 Large Language Model (LLM)은 annotation 보조에만 검토한다

## ADR-016: `analysis_run`으로 계산 version을 추적한다

Raw provenance만으로는 어떤 코드와 parameter가 결과를 만들었는지 알 수 없다.

- 상태: Accepted
- 결정: 모든 Derived row를 `analysis_run`에 연결한다
- 근거: metric algorithm, threshold, cohort rule이 바뀌면 같은 raw data에서도 결과가 달라진다
- 결과: `dataset_snapshot_id`, `code_commit`, `analysis_version`, `params_hash`를 저장한다

## ADR-017: 단일 종합점수 대신 독립 신호를 유지한다

PoC 단계에서 서로 다른 의미의 변수를 하나의 숫자로 압축하지 않는다.

- 상태: Accepted
- 결정: relative strength, breadth, dispersion, exposure, usage를 별도 signal로 제공한다
- 근거: 가중치 선택이 분석자의 임의 판단을 숨길 수 있다
- 결과: `MarketScore`와 `SubstitutionScore`를 PoC 범위에서 만들지 않는다

## ADR-018: Gate 0을 source viability와 coverage viability로 분리한다

정책과 endpoint 검증을 표본 전체 수집과 같은 단계에서 수행할 필요가 없다.

- 상태: Accepted
- 결정: Gate 0A에서 source의 접근성과 이용 조건을 확인하고 Gate 0B에서 20–30명 표본의 coverage를 확인한다
- 근거: source가 사용할 수 없는 경우 catalog 전체 수집 작업을 시작할 이유가 없다
- 결과: 구현은 Gate 0A, catalog, Gate 0B 순서로 진행한다

## ADR-019: 제품 가치와 공개 서비스 운영은 PoC 이후 판단한다

현재 목표는 로컬 분석 구조의 기술적 검증이다.

- 상태: Accepted
- 결정: 사용자 수요, 수익화, 배포 인프라, 운영비를 PoC acceptance에서 제외한다
- 근거: 데이터 접근과 분석 유효성을 확인하기 전에 운영 설계를 고정하면 범위가 불필요하게 커진다
- 결과: 공개 서비스 전환 여부는 PoC 결과를 검토한 뒤 결정한다

## ADR-020: 신규 instrument는 full-lifetime coverage로 Gate 0B를 판정한다

Gate 0B는 source coverage를 검증하며 instrument의 출시 시점 자체를 실패 사유로 만들지 않는다.

- 상태: Accepted
- 결정: 출시 후 180일 이상 지난 instrument에는 기존 180일 기준을 적용한다. 더 새로운 instrument는 공식 출시일부터 최신 observation까지 90% 이상 coverage를 요구한다
- 근거: 2026-09-30 캡처에서 PTG seed 18개는 125개 일별 observation을 제공했다. 26FSL seed는 62개를 제공했다. 두 구간의 시작일은 각 클래스의 공식 출시일과 일치한다. 고정 180일 조건은 source coverage와 instrument age를 혼동한다
- 결과: 현재 실사용 primary instrument를 오래된 class로 교체하지 않는다. 365개 observation은 목표값으로 유지한다. 각 metric과 replay는 별도 충분성 기준을 적용하고, 부족하면 `NO_RESULT`를 반환한다

## ADR-021: usage는 source가 제공하는 identity 단위에 연결한다

Usage source가 강화단계를 제공하지 않으면 grade별 사용량을 만들지 않는다.

- 상태: Accepted
- 결정: Daily Chart와 Open API ranker stats처럼 `spid`까지만 식별하는 source는 `PLAYER_CARD` usage로 저장한다. Grade를 명시하는 source에서만 `INSTRUMENT` usage를 저장한다
- 근거: `spid + grade`는 시장 가격 단위지만 현재 공식 usage source는 grade를 구분하지 않는다. Card 사용량을 1강 instrument 사용량으로 저장하면 source가 제공하지 않은 정밀도를 만든다
- 결과: `usage_point`는 `PLAYER_CARD`와 `INSTRUMENT` subject를 구분한다. Replay와 cohort rule은 observation의 subject granularity를 보존한다

## ADR-022: 브라우저 자동화는 operator opt-in 실험 경로로 분리한다

Data Center의 정식 Gate 0A 판정과 로컬 PoC의 반복 작업 자동화를 같은 상태로 표현하지 않는다.

- 상태: Accepted
- 결정: Gate 0A의 `MANUAL_ONLY` 판정을 유지하면서 `FC_MARKET_ENABLE_BROWSER_AUTOMATION=1`이 설정된 로컬 환경에서만 Playwright 기반 공개 UI 수집을 허용한다
- 근거: 현재 검토한 이용약관은 서비스에서 얻은 정보의 무단 복제, 유통, 상업적 이용을 제한하며 반복 자동 추출을 명시적으로 허용하지 않는다. 반면 로컬 PoC에서 20개 seed의 동일 공개 화면을 매번 사람이 저장하는 작업은 분석 로직과 무관한 반복 작업이다
- 결과: 브라우저 수집은 `OFFICIAL_WEB_UI_PLAYWRIGHT`로 provenance를 분리한다. 로그인, CAPTCHA 우회, stealth, proxy rotation, 비공개 endpoint 직접 호출은 지원하지 않고 HTTP 403 또는 429와 접근 제한 신호에서 중단한다

## ADR-023: frozen PoC sample과 확장 benchmark를 분리한다

Canonical PoC의 재현성과 시장 대표성 확장을 같은 identity에서 처리하지 않는다.

- 상태: Accepted
- 결정: 기존 `SAMPLE_MARKET` catalog와 canonical run을 유지하고 확장 시장은 versioned universe와 `benchmark_panel`로 새 identity를 만든다
- 근거: 기존 seed를 교체하면 과거 acceptance와 replay 결과가 표본 변경의 영향을 받아 같은 입력으로 재현되지 않는다
- 결과: 새 benchmark는 `panel_id`, `universe_snapshot_id`, `analysis_version`을 명시하며 기존 결과를 덮어쓰지 않는다

## ADR-024: 전체 catalog와 장기 가격 수집 범위를 분리한다

시장 구조를 파악하기 위해 모든 instrument의 장기 가격 history를 먼저 수집할 필요는 없다.

- 상태: Accepted
- 결정: 공식 metadata로 catalog universe를 최대한 넓게 고정하고 가격 history는 price-eligible universe에서 선택한 benchmark panel을 우선 수집한다
- 근거: metadata inventory는 모집단 구조를 설명하지만 가격 source의 정책과 수집 비용은 별도 제약이다. 두 범위를 묶으면 source viability 확인 전에 수집량이 커진다
- 결과: player card만 존재하는 grade를 synthetic instrument로 생성하지 않는다. Price source observation 또는 별도 evidence가 있는 `spid + grade`만 instrument universe에 포함한다

## ADR-025: player 단위 층화 표본과 population weight를 사용한다

Class 수가 많은 player와 인기 player 위주의 편의표본이 시장 benchmark를 지배하지 않게 sampling contract를 고정한다.

- 상태: Accepted
- 결정: player를 1차 sampling unit으로 사용하고 `usage_band × price_band`에서 deterministic nested panel을 추출한다. `BROAD_MARKET`은 stratum population weight로 집계한다
- 근거: 단순히 seed 수를 늘리면 현재 usage 상위 표본의 편향이 남는다. 층화와 inclusion probability를 저장하면 표본 설계와 결과의 관계를 재현할 수 있다
- 결과: weighted metric, player-level stratified bootstrap, nested panel convergence를 새 analysis version에 추가한다. Supplemental instrument 수는 player weight를 늘리지 않는다

## ADR-026: panel 생성 이전 history는 contemporaneous market으로 해석하지 않는다

현재 시점의 universe와 panel selection을 과거 날짜의 시장 구성으로 소급하지 않는다.

- 상태: Accepted
- 결정: panel의 `effective_from` 이전 가격 series는 `FIXED_PANEL_BACKCAST`로 표시하고 contemporaneous `BROAD_MARKET`과 분리한다
- 근거: 현재 metadata, usage, price eligibility로 선택한 player set을 과거 시장 membership으로 사용하면 look-ahead와 survivorship bias가 생긴다
- 결과: 새 panel version은 `effective_from` 이후 metric에만 적용한다. 과거 metric row는 다시 쓰지 않고 panel rebalance 시 index level만 연결한다
