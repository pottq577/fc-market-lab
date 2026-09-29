# 선수 관계 모델

선수 관계는 그래프로 해석하되 PoC 저장소는 관계형 데이터베이스로 충분하다.

## 선수 identity

`player`는 실존 선수 자체를 표현한다.

```text
player_id
name
```

## 클래스 카드

`player_card`는 클래스 단위 상품을 표현한다.

```text
spid
player_id
season
salary
position
ovr
stats
traits
```

## 시장 자산

강화단계별 가격을 구분하기 위해 실제 분석 단위는 `spid + grade`로 잡는다.

```text
instrument_id
spid
grade
```

## 카드 관계

```text
source_instrument
target_instrument

same_player
same_position
shared_team_colors
salary_diff
ovr_diff
stat_distance
price_ratio
usage_distance
relation_source
```

초기 PoC는 "대체 가능성 92점" 같은 합성값을 만들지 않는다.
원본 feature를 보여주는 것이 우선이다.
