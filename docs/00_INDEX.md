# FC온라인 이적시장 인텔리전스 문서 인덱스

`meta.contentType: Reference`

이 디렉터리는 원본 `fconline.md`를 문서 성격별로 재조립한 구조다. 각 문서는 원문의 연속 구간을 그대로 보존한다. `manifest.tsv` 순서대로 모든 분할 문서를 이어 붙이면 원문과 바이트 단위로 동일하다.

## 문서 구조

```text
docs/
├── 00_INDEX.md
├── product/
│   ├── product-definition.md
│   └── user-workflows.md
├── requirements/
│   └── requirements.md
├── market/
│   ├── external-factors.md
│   ├── player-factors.md
│   └── cohorts.md
├── domain/
│   ├── event-model.md
│   ├── paid-product-model.md
│   └── player-relation-model.md
├── data/
│   ├── source-strategy.md
│   ├── price-history-gate.md
│   ├── price-semantics.md
│   └── quality-rules.md
├── analysis/
│   ├── market-metrics.md
│   ├── shock-and-regime.md
│   ├── methodology.md
│   └── output-rules.md
├── architecture/
│   └── local-poc.md
├── storage/
│   └── data-layers.md
├── poc/
│   ├── scope.md
│   ├── validation-scenarios.md
│   └── acceptance.md
├── decisions/
│   ├── product-decisions.md
│   └── adr.md
├── risks/
│   └── risks-and-notes.md
├── roadmap/
│   ├── post-poc.md
│   └── open-questions.md
├── implementation/
│   └── implementation-plan.md
├── source/
│   └── fconline.md
└── manifest.tsv
```

## 읽는 순서

1. `product/product-definition.md`: 제품의 목적과 경계
2. `requirements/requirements.md`: 구현이 충족해야 할 요구사항
3. `product/user-workflows.md`: 실제 사용자 작업과 출력 계약
4. `market/`: 시장을 설명하는 외부·내부 변수와 cohort
5. `domain/`: 이벤트, 상품, 선수 관계 데이터 모델
6. `data/`: 데이터 출처, 가격 수집 Gate, 가격 의미와 품질 규칙
7. `analysis/`: 시장 지표, Shock/Regime, 이벤트 분석과 결과 표현
8. `poc/`: 대상 범위, 검증 시나리오, 완료 조건
9. `decisions/`: 제품 결정과 Architecture Decision Record (ADR)
10. `architecture/`와 `storage/`: 로컬 구현 구조와 데이터 계층
11. `risks/`와 `roadmap/`: 리스크, PoC 이후 판단, 오픈 질문
12. `implementation/implementation-plan.md`: 실제 구현 순서

## 무결성

- 원본 줄 수: 1543
- 원본 바이트: 48384
- 분할 문서 수: 28
- SHA-256: `dde1b3f95818d3b8ba62c4f3859573688811bb35f75d310e179018a46717cf59`
- 재조립 SHA-256: `dde1b3f95818d3b8ba62c4f3859573688811bb35f75d310e179018a46717cf59`
- 결과: 원본과 분할 문서 재조립 결과가 동일함

`source/fconline.md`는 원본 보존용이다. 실제 탐색과 구현에서는 위의 성격별 문서를 기준으로 사용한다.
