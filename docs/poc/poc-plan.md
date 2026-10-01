---
meta:
  contentType: Reference
---

# PoC에서 무엇을 검증하고 언제 완료하는가

이 문서는 Proof of Concept (PoC)의 표본 범위, 검증 시나리오, acceptance criteria를 한곳에 정의한다.
PoC 완료는 서비스 가치 판정이 아니라 데이터와 분석 구조의 재현 가능성 판정이다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 표본 범위를 고정한다

첫 PoC는 전체 FC온라인 카드를 수집하지 않는다.
장기 실사용과 시장 대표성을 고려한 20–30명 seed player를 선정하고, 각 선수의 주요 class와 grade를 추적한다.

선수 수보다 동일 선수의 여러 class가 존재해 관계 분석을 할 수 있는지를 중요하게 본다.
`SAMPLE_MARKET` 구성은 dataset snapshot과 함께 고정해 replay 중 임의로 바꾸지 않는다.

Seed 선정 근거는 최소 다음 정보를 남긴다:

- player identity
- 선정 시점
- 랭커 사용 근거
- 주요 팀컬러 또는 포지션
- 추적할 primary instrument
- 포함 또는 제외 이유

## PoC-01: 동일 선수 class 간 관계를 검증한다

한 선수의 특정 class 가격이 크게 변할 때 다른 class에서도 상대 변화가 나타나는지 확인한다.

관측값은 다음과 같다:

- 가격 차이와 비율
- 급여 차이
- OVR 차이
- 주요 stat 차이
- 당시 사용량
- `SAMPLE_MARKET` 대비 relative strength

여러 고가 class와 실제 사용 기록을 가진 선수를 우선 사용한다.

## PoC-02: 팀컬러 내 대체관계를 검증한다

특정 instrument의 가치가 변할 때 같은 팀컬러와 포지션의 당시 대체 후보가 어떻게 움직이는지 확인한다.
예를 들어 특정 팀컬러의 스트라이커 집합을 작은 시장으로 비교할 수 있다.

Replay는 사건 당시 유효한 팀컬러 membership과 relation snapshot만 사용한다.

## PoC-03: 급여 차이와 실제 채택을 비교한다

성능이 비슷한 카드에서 급여 차이가 가격과 사용량 차이와 함께 나타나는지 확인한다.
급여에 임의 가중치를 부여한 효율 점수는 만들지 않는다.

## PoC-04: 선수팩 직접 공급 반응을 검증한다

특정 class와 grade를 직접 공급한 상품 전후로 `PACK_EXPOSED` cohort가 `SAMPLE_MARKET`과 다른 움직임을 보였는지 확인한다.
비교군은 가격대, 포지션, grade, OVR, 급여, 당시 사용량이 가능한 범위에서 비슷한 비노출 카드로 구성한다.

## PoC-05: 같은 공급 안의 반응 차이를 검증한다

같은 선수팩 조건에 포함된 카드라도 실사용성, 급여, 팀컬러, 대체재, 동일 선수의 다른 class에 따라 반응이 달랐는지 확인한다.
이 시나리오는 동일 OVR이 동일 공급 충격을 뜻하는지 검토한다.

## PoC-06: 월초와 월말 반복 패턴을 검증한다

월초와 월말이라는 calendar label 자체를 원인으로 사용하지 않는다.
같은 기간의 멤버십, 상품, 이벤트, BP 공급을 함께 표시해 반복 가능한 차이가 있는지 확인한다.

## PoC-07: 공지와 적용 시점 반응을 분리한다

화요일 전후 공지와 목요일 적용처럼 정보 공개와 실제 적용이 분리된 사건을 사용한다.
`announced_at`과 `effective_at` 주변 window를 따로 계산한다.

## PoC-08: 라커룸 토크 11화를 replay한다

2026년 9월 28일 공개된 라커룸 토크 11화를 known event로 등록한다.
실제 가격 데이터가 확보되면 다음 항목을 검증한다:

- 관련 특성 또는 gameplay change에 노출된 선수
- 비관련 비교군
- 동일 선수의 다른 class
- 발표 전후 변화
- `SAMPLE_MARKET` 변화
- cohort relative strength

사전에 관찰한 시장 반응은 결과로 고정하지 않고 검증 가설로만 저장한다.

## PoC-09: SSS 20코인 사건을 replay한다

2026년 9월의 SSS 20코인 사건은 비정기 공급 Shock 사례로 사용한다.
Timeline은 확인 가능한 source를 기준으로 세분화한다:

1. 상품 공개
2. 비정상 공급 관측 구간
3. 판매 임시 중단
4. 구매 제한 수정
5. 상품 조기 종료
6. 대응 공지
7. 보상 발표
8. 실제 보상 지급

검증 cohort는 직접 공급 대상군, 비노출 고가군, `PREMIUM_SCARCE`, `CORE`, 동일 선수 class를 포함한다.
목표는 가격 배수를 예측하는 것이 아니라 공급 충격 이후 표본 내부 상대강도와 dispersion이 재배분됐는지 확인하는 것이다.

## PoC-10: 시장 규칙 변경을 Regime으로 검증한다

2026년 9월의 기준가 규칙 변경 사례를 Regime marker로 등록한다.
변경 전후 가격을 같은 의미로 연속 계산했을 때와 경계를 분리했을 때의 차이를 확인한다.

## 완료 조건

PoC는 다음 acceptance criteria를 모두 충족하면 1차 완료로 본다.
완료 조건은 다음과 같다:

- `AC-001` — Gate 0A evidence에 source, policy URL, 검토 시각, access method, price semantics, automation decision이 기록돼 있다
- `AC-002` — seed player가 20–30명이며 각 player에 primary instrument와 선정 근거가 있다
- `AC-003` — primary instrument가 source-native expected observation 기준 90% 이상 coverage를 가진다. 출시 후 180일 이상 지난 instrument는 최소 180일 history를 요구하고, 더 새로운 instrument는 공식 출시일부터 최신 observation까지의 full-lifetime coverage를 요구한다. 365개 observation은 목표값으로 별도 표시한다
- `AC-004` — 가격과 metadata가 `spid`와 instrument identity를 통해 연결되고 source snapshot까지 역추적된다
- `AC-005` — 사용 데이터가 확보 가능한 경우 최소 5명 seed player와 10개 card 또는 instrument에 usage observation이 연결된다. Source가 grade를 제공하지 않으면 card 단위로 저장한다. 과거 usage를 제공하지 않으면 `UNAVAILABLE_SOURCE` evidence로 대체한다
- `AC-006` — 동일 선수 relation, 팀컬러 대체 relation, cohort membership이 시간 유효성과 함께 조회된다
- `AC-007` — `SAMPLE_MARKET`, `CORE`, `PACK_EXPOSED`, `PREMIUM_SCARCE`에 대해 데이터 충분성 기준을 적용한 index와 relative strength를 계산할 수 있다
- `AC-008` — 라커룸 토크 11화 replay가 `announced_at` 기준 window와 비교군 결과를 생성한다
- `AC-009` — SSS 사건 replay가 direct exposure, comparison cohort, Shock candidate, 후속 event를 한 timeline에서 재생한다
- `AC-010` — 기준가 규칙 변경 Regime을 등록하고 기본 return 계산이 경계를 넘지 않는 것을 검증한다
- `AC-011` — Derived 결과에서 `analysis_run -> dataset_snapshot -> source_snapshot` 경로로 원본까지 추적된다
- `AC-012` — metric sufficiency 기준 미달 fixture에서 0 대신 `NO_RESULT`를 반환한다
- `AC-013` — replay test가 cutoff 이후 usage, relation snapshot, cohort membership을 참조하지 않는 것을 검증한다
- `AC-014` — 핵심 분석이 Python과 생성형 인공지능 호출 없이 재현되고 결과가 사실, 계산, 해석, 가설로 구분된다

## 완료 판정에서 제외하는 항목

다음 항목은 PoC 완료 여부를 결정하지 않는다:

- 커뮤니티 사용자 수요
- 서비스 수익성
- 공개 배포 가능성
- 서버리스 운영 비용
- 모바일 또는 웹 UI 선택
- 예측 모델의 정확도

이 항목들은 PoC 결과를 검토한 뒤 별도 제품 판단으로 진행한다.
