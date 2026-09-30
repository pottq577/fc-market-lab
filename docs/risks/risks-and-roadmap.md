---
meta:
  contentType: Reference
---

# 어떤 리스크와 후속 판단이 남아 있는가

이 문서는 PoC 구현 중 남아 있는 기술, 정책, 분석 리스크와 PoC 이후 판단 항목을 한곳에 관리한다.
해결된 항목은 관련 ADR이나 evidence를 링크하고 이 목록에서 상태를 갱신한다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 가격 history 접근이 가장 큰 선행 리스크다

공식 UI에 장기 시세가 존재해도 자동 수집 권한을 의미하지 않는다.
Gate 0A가 source별 이용 조건과 접근 방식을 확인하기 전에는 대규모 collector를 구현하지 않는다.

정책 문구를 한 번 확인한 뒤 영구 조건으로 취급하지 않는다.
`policy_checked_at`과 evidence를 남겨 이후 변경 여부를 확인할 수 있게 한다.

## `SAMPLE_MARKET`에는 표본 편향이 있다

20–30명 인기 실사용 선수를 선택하면 비인기 카드, 저가 카드, 신규 카드의 움직임을 충분히 대표하지 못할 수 있다.
PoC 결과는 전체 FC온라인 시장의 통계로 일반화하지 않는다.

선정 기준과 frozen seed set을 보존한다.
PoC 이후 표본 확대가 필요하면 기존 sample과 새 sample을 같은 이름으로 덮어쓰지 않는다.

## 신규 class는 긴 분석 window를 지원하지 않을 수 있다

Gate 0B는 출시 후 180일이 지나지 않은 instrument에 full-lifetime coverage를 허용한다.
이 판정은 source가 instrument의 존재 기간을 충분히 제공한다는 뜻이다.

긴 baseline과 과거 replay는 필요한 observation 수를 별도로 충족해야 한다.
데이터가 부족하면 해당 metric은 `NO_RESULT`를 반환한다.

## class 수가 많은 선수는 별도 통제가 필요하다

한 선수의 instrument가 많으면 instrument 직접 집계에서 과도한 가중치를 가진다.
`SAMPLE_MARKET`은 instrument median을 바로 사용하지 않고 player 단위 median을 거쳐 집계한다.

이 방식도 player별 동일 가중이라는 선택을 포함한다.
거래량을 확보할 수 있게 되면 가중 방식 변경을 별도 ADR로 검토한다.

## 전체 거래량과 유통량을 알 수 없다

현재 데이터로는 시가총액 가중 시장지수를 만들기 어렵다.
가격 수준을 직접 평균내거나 거래량을 임의 추정하지 않는다.

PoC는 median return, breadth, relative strength, dispersion으로 표본 내부 구조를 설명한다.

## 가격 graph와 실제 체결은 같은 개념이 아닐 수 있다

기준가가 주문과 운영 규칙에 의해 변할 수 있으므로 graph 값을 실거래 수요로 단정하지 않는다.
`price_semantics`를 보존하고 Regime 변경을 분석에 반영한다.

고강 또는 비인기 instrument에서는 동일 가격 반복이 실제 무거래인지 stale source인지 구분하기 어려울 수 있다.
`UNCHANGED_RUN`과 `STALE_SOURCE`를 별도 상태로 관리한다.

## 과거 relation과 usage를 충분히 복원하지 못할 수 있다

현재 팀컬러, 사용량, 가격 비율을 과거 사건에 적용하면 look-ahead bias가 생긴다.
과거 snapshot을 확보하지 못하면 해당 feature를 `UNAVAILABLE`로 두고 replay에서 제외한다.

미래 data로 빈칸을 메우는 것보다 분석 항목을 줄이는 쪽을 우선한다.

## 상품 판매량을 정확히 알 수 없을 수 있다

공개 popularity signal이 판매금액이나 순위만 제공되면 이를 절대 판매량으로 환산하지 않는다.
상품 공급 충격은 공개된 reward 조건과 상대 signal 수준에서 해석한다.

## 같은 공급도 모든 카드에 같은 영향을 주지 않는다

수요 흡수력은 사용량, 급여, 팀컬러, 대체재, 희소성, 동일 선수 class 구조에 따라 다를 수 있다.
이 차이는 오차로 제거할 대상이 아니라 PoC 검증 대상이다.

## 반복 calendar 패턴은 원인이 아니다

월초, 월말, 특정 요일과 가격 변화가 함께 나타나도 calendar 자체를 원인으로 고정하지 않는다.
같은 기간의 상품, 이벤트, 멤버십, BP 공급을 함께 표시한다.

## Shock threshold는 초기 가정이다

30 observation baseline과 `abs(robust_z) >= 3.5`는 첫 PoC의 재현 가능한 출발점이다.
실제 데이터에서 false positive 또는 false negative가 많으면 threshold를 조정할 수 있다.

변경할 때는 과거 결과를 조용히 덮어쓰지 않는다.
새 analysis version 또는 ADR로 남긴다.

## 구현 전에 남은 오픈 질문

Gate 0A, frozen seed catalog, Gate 0B evidence로 가격 source와 primary instrument를 확인했다.
Native granularity는 `P1D`로 확인했다.
다음 항목은 계속 evidence로 닫는다:

1. 각 player에서 추적할 grade 범위는 어디까지인가
2. 첫 팀컬러 대체관계 검증에 사용할 팀컬러는 무엇인가
3. `CORE`, `HIGH_END`, `PREMIUM_SCARCE`의 첫 rule 또는 수동 seed 기준은 무엇인가
4. 첫 365일에서 수동 등록할 주요 event 범위는 어디까지인가
5. 랭커 usage history를 과거 어느 시점까지 복원할 수 있는가

이 질문은 불확실한 값을 문서에 임의로 채우지 않고 Gate와 catalog 작업에서 결정한다.

## PoC 이후 판단할 항목

다음 질문은 acceptance에 포함하지 않는다:

- 지표가 다른 사용자에게 충분히 유용한가
- FC온라인 커뮤니티에 수요가 있는가
- 공개 서비스로 운영할 수 있는가
- 데이터 접근 방식이 장기적으로 유지 가능한가
- 서버리스 또는 다른 배포 형태가 적합한가
- 필요한 수집 주기는 어느 정도인가
- 운영 비용을 어느 수준으로 유지할 수 있는가
- 모바일과 웹 중 어떤 UI가 적합한가
- 회귀분석이나 다른 통계 모델을 추가할 가치가 있는가
- 공지 annotation에 Large Language Model (LLM)을 사용할 가치가 있는가
- 예측성 지표를 별도 제품으로 실험할 가치가 있는가

이 항목들은 `AC-001`–`AC-014` 결과를 검토한 뒤 별도 제품 결정으로 진행한다.
