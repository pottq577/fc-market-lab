# 데이터 계층

데이터는 세 계층으로 나눈다.

## Raw

소스에서 받은 원문이다.
가능한 경우 다음 metadata를 함께 저장한다.

```text
source_type
source_url
observed_at
raw_payload
raw_hash
collector_version
```

## Normalized

분석 가능한 domain table이다.

예:

- `player`
- `player_card`
- `instrument`
- `price_point`
- `usage_point`
- `team_color`
- `card_relation`
- `event`
- `product`
- `reward`
- `exposure`

## Derived

계산으로 만든 결과다.

예:

- `cohort_membership`
- `market_index`
- `cohort_index`
- `relative_strength`
- `breadth`
- `dispersion`
- `event_study`
- `shock`
- `regime`

Derived 데이터는 언제든 재생성할 수 있어야 한다.
