---
meta:
  contentType: Landing
---

# FC온라인 이적시장 인텔리전스 문서를 어떻게 읽는가

이 문서는 FC온라인 이적시장 인텔리전스 Proof of Concept (PoC)의 문서 구조와 읽는 순서를 정의한다.
각 문서는 하나의 책임만 가지며, 제품 계약에서 구현과 검증까지 추적할 수 있게 연결한다.

## 문서 계획

모든 하위 문서는 이 표를 공통 content plan으로 참조한다.
오픈 질문은 `risks/risks-and-roadmap.md`에서 한곳에 관리한다.

| 문서                                    | content type | 목표                                          | 대상                | 포함 내용                                     |
| --------------------------------------- | ------------ | --------------------------------------------- | ------------------- | --------------------------------------------- |
| `product/prd.md`                        | Conceptual   | 제품이 해결할 문제와 사용자 작업을 설명한다   | 개발자              | 제품 경계, 사용자 작업, 출력 계약, 비목표     |
| `requirements/requirements.md`          | Reference    | 구현 요구사항과 추적 관계를 고정한다          | 개발자, 리뷰어      | 기능 요구사항, 비기능 요구사항, 추적표        |
| `data/data-contract.md`                 | Reference    | 사용할 데이터와 품질 기준을 고정한다          | 개발자              | 출처, Gate 0A/0B, 가격 의미, 품질 규칙        |
| `design/domain-model.md`                | Reference    | 시간축을 포함한 도메인 모델을 정의한다        | 개발자              | 선수, 가격, 관계, 이벤트, 상품, cohort        |
| `design/analysis-model.md`              | Reference    | 시장 상태를 계산하고 해석하는 방법을 정의한다 | 개발자, 분석 리뷰어 | 수익률, 지수, 상대강도, Shock, Regime         |
| `architecture/local-poc.md`             | Reference    | 로컬 실행과 재현 구조를 정의한다              | 개발자              | 데이터 계층, `analysis_run`, 프로젝트 구조    |
| `decisions/adr.md`                      | Reference    | 주요 설계 결정과 근거를 보존한다              | 개발자, 리뷰어      | Architecture Decision Record (ADR)            |
| `poc/poc-plan.md`                       | Reference    | PoC 범위와 검증 완료 조건을 고정한다          | 개발자              | 대상 표본, 검증 시나리오, acceptance criteria |
| `implementation/implementation-plan.md` | How-to       | 구현 순서를 실행 가능한 단계로 정한다         | 개발자              | Gate부터 replay까지의 작업 순서               |
| `risks/risks-and-roadmap.md`            | Reference    | 남은 위험과 후속 판단을 한곳에 관리한다       | 개발자              | 리스크, 오픈 질문, PoC 이후 판단              |

## 문서 구조

```text
docs/
├── 00_INDEX.md
├── product/
│   └── prd.md
├── requirements/
│   └── requirements.md
├── data/
│   └── data-contract.md
├── design/
│   ├── domain-model.md
│   └── analysis-model.md
├── architecture/
│   └── local-poc.md
├── decisions/
│   └── adr.md
├── poc/
│   └── poc-plan.md
├── implementation/
│   └── implementation-plan.md
└── risks/
    └── risks-and-roadmap.md
```

## 읽는 순서

제품 의도에서 구현 순서까지 다음 순서로 읽는다:

1. `product/prd.md`
2. `requirements/requirements.md`
3. `data/data-contract.md`
4. `design/domain-model.md`
5. `design/analysis-model.md`
6. `architecture/local-poc.md`
7. `decisions/adr.md`
8. `poc/poc-plan.md`
9. `implementation/implementation-plan.md`
10. `risks/risks-and-roadmap.md`
