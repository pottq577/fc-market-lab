# 이벤트 모델

모든 이벤트는 시간 정보를 분리한다.

```text
event_id
event_type
title
announced_at
effective_at
ended_at
first_observed_at
source
confidence
notes
```

- `announced_at`은 시장이 정보를 처음 접할 수 있었던 시각이다.
- `effective_at`은 게임 안에서 실제 변화가 적용된 시각이다.
- 둘을 합치면 정보 선반영을 분석할 수 없다.

## 이벤트 유형

초기 taxonomy는 다음 값을 사용한다.

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

한 공지가 여러 사건을 포함하면 이벤트를 분리한다.
