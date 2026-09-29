# 유료 상품 데이터 모델

상품 자체와 보상 구성은 분리한다.

## 상품

```text
product_id
name
sale_start
sale_end
price
currency
purchase_limit
channel
source
```

## 보상 구성

```text
reward_id
product_id
reward_type
quantity
probability
class_filter
grade_min
grade_max
ovr_min
top_price_n
```

`reward_type`은 최소 다음을 지원한다.

- BP
- FC
- MC
- 선수팩
- 선택팩
- 교환 토큰
- 기타 아이템

상품의 "효율"과 "시장 공급 효과"를 같은 값으로 취급하지 않는다.
유저 입장에서 효율이 높은 상품도 시장 전체에서는 BP 공급형인지 선수 공급형인지에 따라 영향이 다르다.
