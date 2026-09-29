---
meta:
  contentType: Reference
---

# 구현이 충족해야 할 요구사항은 무엇인가

이 문서는 구현과 검증에 사용하는 요구사항 식별자를 정의한다. 각 요구사항은 Architecture Decision Record (ADR)와 PoC acceptance criterion에 연결한다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 기능 요구사항

기능 요구사항은 데이터 수집에서 replay까지의 필수 동작을 정의한다.

| ID       | 요구사항                                                                                    |
| -------- | ------------------------------------------------------------------------------------------- |
| `FR-001` | 20–30명의 seed player identity와 선정 근거를 관리한다                                       |
| `FR-002` | 실존 선수, 클래스 카드, `spid + grade` instrument를 분리해 관리한다                         |
| `FR-003` | 가격 원본 timestamp, 관측 시각, 원본 값, source를 수정 없이 보존한다                        |
| `FR-004` | OVR, 급여, 포지션, 세부 능력치, 특성, 소속팀, 국가, 팀컬러 metadata를 저장한다              |
| `FR-005` | 가능한 범위에서 랭커 사용량과 경기 기록을 시점 정보와 함께 저장한다                         |
| `FR-006` | 동일 선수와 대체재 관계를 조회하고, 시간 의존 feature에는 `as_of` 또는 유효 기간을 저장한다 |
| `FR-007` | 공지, 업데이트, 이벤트, 상품, 멤버십, 시장 정책 변경을 시간축에 기록한다                    |
| `FR-008` | 이벤트의 `announced_at`, `effective_at`, `ended_at`, `first_observed_at`을 분리한다         |
| `FR-009` | 유료상품의 판매 기간, 가격, 구매 제한, 구성품, 선수팩 조건을 구조화한다                     |
| `FR-010` | BP 공급과 선수 공급을 구분하고 direct, indirect exposure를 시간 범위와 함께 저장한다        |
| `FR-011` | cohort definition과 membership을 버전 또는 유효 기간 단위로 관리한다                        |
| `FR-012` | `SAMPLE_MARKET`과 cohort return, index, relative strength, breadth, dispersion을 계산한다   |
| `FR-013` | 정상 분포를 벗어난 변화는 Shock candidate로 기록하고 원인 annotation과 분리한다             |
| `FR-014` | 가격 형성 규칙이 달라지는 시점을 Regime marker로 기록한다                                   |
| `FR-015` | 과거 이벤트를 당시 cutoff 이전 데이터만 사용해 replay한다                                   |
| `FR-016` | 모든 derived row에서 `analysis_run`과 사용한 dataset snapshot까지 추적한다                  |
| `FR-017` | 이벤트와 분류에 사람이 source, 메모, confidence를 추가할 수 있다                            |
| `FR-018` | metric별 데이터 충분성 기준을 충족하지 못하면 `NO_RESULT`를 반환한다                        |

## 비기능 요구사항

비기능 요구사항은 재현성, 데이터 의미, 실행 환경을 고정한다.

| ID        | 요구사항                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------ |
| `NFR-001` | 동일 dataset snapshot, analysis version, parameter로 실행하면 같은 결과가 나와야 한다            |
| `NFR-002` | Raw snapshot은 불변으로 보존하고 Normalized, Derived 데이터와 분리한다                           |
| `NFR-003` | 원본 timezone을 보존하고 분석 기준 시각은 Korean Standard Time (KST)으로 통일한다                |
| `NFR-004` | 수집 실패, 누락, 실제 0, 동일 값 반복을 서로 다른 상태로 표현한다                                |
| `NFR-005` | source별 이용 조건을 우회하지 않고 검토 시점과 근거 URL을 기록한다                               |
| `NFR-006` | 출처와 라이선스를 확인하지 않은 제3자 데이터를 핵심 기준값으로 사용하지 않는다                   |
| `NFR-007` | Python을 필수 런타임으로 만들지 않고 SQL과 TypeScript로 핵심 분석을 실행할 수 있게 한다          |
| `NFR-008` | 생성형 인공지능 호출이 없어도 수집, 정규화, 분석, replay를 수행할 수 있어야 한다                 |
| `NFR-009` | 상관관계나 사건 전후 차이를 인과관계로 표현하지 않는다                                           |
| `NFR-010` | 기준가 성격의 데이터를 실제 체결가로 표시하지 않는다                                             |
| `NFR-011` | replay는 분석 cutoff 뒤에 생성된 membership, relation snapshot, usage snapshot을 참조하지 않는다 |

## 추적 관계

이 표는 요구사항 그룹을 설계 결정과 완료 조건에 연결한다. 세부 acceptance criterion은 `poc/poc-plan.md`에서 정의한다.

| 요구사항                                | 주요 ADR                        | PoC 완료 조건                |
| --------------------------------------- | ------------------------------- | ---------------------------- |
| `FR-001`–`FR-005`                       | `ADR-002`, `ADR-003`, `ADR-007` | `AC-002`–`AC-005`            |
| `FR-006`, `FR-011`, `FR-015`, `NFR-011` | `ADR-004`, `ADR-014`            | `AC-006`, `AC-013`           |
| `FR-007`–`FR-010`, `FR-017`             | `ADR-008`, `ADR-013`            | `AC-006`, `AC-008`, `AC-009` |
| `FR-012`, `FR-018`                      | `ADR-005`, `ADR-006`            | `AC-007`, `AC-012`           |
| `FR-013`, `FR-014`                      | `ADR-009`, `ADR-010`            | `AC-009`, `AC-010`           |
| `FR-016`, `NFR-001`, `NFR-002`          | `ADR-012`, `ADR-016`            | `AC-011`                     |
| `NFR-003`–`NFR-006`, `NFR-010`          | `ADR-011`, `ADR-018`            | `AC-001`, `AC-003`           |
| `NFR-007`, `NFR-008`                    | `ADR-015`                       | `AC-014`                     |
| `NFR-009`                               | `ADR-001`, `ADR-005`            | `AC-014`                     |
