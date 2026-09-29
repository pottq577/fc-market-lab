# Shock와 regime

비정기 사건을 기존 계절성 모델에 억지로 포함하지 않는다.

## Shock

Shock는 기존 분포를 크게 벗어난 단기 변화다.

예:

```text
HIGH_END             -22%
PACK_EXPOSED         -41%
PREMIUM_SCARCE       +16%

시장 dispersion
최근 30일 범위 초과
```

원인을 알지 못해도 `UNKNOWN_SHOCK`로 기록할 수 있다.

## Regime

Regime은 시장 가격이 형성되는 구조 자체가 달라진 기간이다.
다음 변화가 regime marker가 될 수 있다.

- 기준가 계산 규칙 변경
- 대규모 자산 재분배
- 신규 거래 시스템
- 광범위한 즉시판매 정책
- 급여 시스템 개편
- 시장에 구조적인 공급 변화가 발생한 사건

Regime 경계 이전 데이터를 삭제하지 않는다.
분석 시 현재 regime과 과거 regime을 구분한다.
