---
meta:
  contentType: Reference
---

# PoC 완료 기준 run과 검증 결과

이 문서는 FC온라인 이적시장 인텔리전스 PoC의 1차 기술 완료 기준점을 고정한다.
완료 판정은 [PoC 계획](poc-plan.md)의 `AC-001`–`AC-014`에만 적용한다.

## 완료 판정

- 판정 시각: 2026-10-01T05:35:20.278Z
- 상태: `COMPLETE`
- acceptance: 14 PASS / 0 FAIL
- analysis run: `run_97896c0081872d383f941bdab180c3aecc334e377b6752284e65ca840404925e`
- dataset snapshot: `dataset_a362707a3093caccd65c3dfde2409f8de0109a4bf63dcb00d0fa6f409bee5af5`

로컬 machine-readable report는
`data/exports/acceptance/run_97896c0081872d383f941bdab180c3aecc334e377b6752284e65ca840404925e.json`에 생성됐다.
`data/exports/`는 작업 산출물이므로 Git에 커밋하지 않는다.

## 기준 dataset

| 항목 | 개수 |
| --- | ---: |
| source snapshot | 133 |
| price point | 13,017 |
| FULL metadata snapshot | 20 |
| usage point | 20 |
| relation | 36 |
| cohort membership | 56 |
| event | 5 |
| product | 2 |
| reward | 2 |
| exposure | 6 |

Frozen `SAMPLE_MARKET`은 기존 20명 seed를 유지했다.
Acceptance coverage용 supplementary instrument는 4개다:

- `866239231:11` — 마르크 쿠쿠레야 26TOTS 11강
- `868005589:11` — 루이스 피구 26FSL 11강
- `868037576:11` — 호나우두 26FSL 11강
- `868190045:11` — 요한 크루이프 26FSL 11강

## Derived 결과

| 단계 | 결과 |
| --- | --- |
| Market metric | 13,326 rows / 6,945 OK / 6,381 NO_RESULT / 223 dates |
| Event replay | 5 anchors / 1,260 rows / 468 OK / 792 NO_RESULT |
| Shock detection | 1,338 rows / 210 OK / 1,128 NO_RESULT / 6 candidates |

Result hash:

- metric: `sha256:87700ebe16810827306361be9ee98538d276e6c1462860e2b971819f0b73a810`
- replay: `sha256:87cacc67a9e520b2e330b26e6a8786cdae5a7387a547e1b9ea101006ec41e72e`
- shock: `sha256:51e2d1bf8ff55f5eafdd0742a6a7b2f69d5a91326ecfcd72b7ad46706ccd5cfc`

Shock candidate 수는 acceptance 목표값이 아니다.
Detector가 재현 가능하게 평가되고 원인 annotation과 분리되는지가 계약이다.

## Acceptance evidence

- `AC-001`–`AC-005`: Gate 0A/0B, frozen seed, provenance, usage PASS
- `AC-006`: same-player relation 2, substitute relation 35, timed membership 56
- `AC-007`: SAMPLE_MARKET, CORE, PACK_EXPOSED, PREMIUM_SCARCE metric PASS
- `AC-008`: Locker Room Talk 11 announced-at replay PASS
- `AC-009`: SSS direct exposure 6, comparison, Shock evaluation, follow-up event PASS
- `AC-010`: 26TOTS 11강 scoped instrument 1, Regime blocked return 1
- `AC-011`: 13,326 derived rows, snapshot source 133/133 traceable
- `AC-012`: sufficiency NO_RESULT 4,288건
- `AC-013`: cutoff 이후 usage/relation/membership 참조 0
- `AC-014`: Python/생성형 인공지능 비의존 핵심 분석과 결과 계층 PASS

## 다시 검증한다

현재 로컬 Raw/DB/evidence가 보존된 환경에서 실행한다:

```bash
npm run poc:verify
```

이 명령은 test와 Gate를 먼저 검사하고 마지막에 strict acceptance를 실행한다.
Acceptance가 14/14가 아니면 완료 검증은 실패한다.

Raw payload와 로컬 DB는 저장소에서 제외되므로 clean clone만으로 이 완료 run의 원본 데이터를 자동 복원하지 않는다.
재수집하거나 별도 보존한 Raw/DB를 사용할 때는 새 dataset snapshot과 analysis run으로 구분한다.

## 완료 판정의 경계

이 완료 기록은 FC온라인 전체 시장 대표성, 인과관계, 미래 가격 예측, 공개 서비스 운영 가능성, 서비스 수요나 수익성을 증명하지 않는다.
후속 판단은 [리스크와 후속 판단](../risks/risks-and-roadmap.md)에서 별도로 관리한다.
