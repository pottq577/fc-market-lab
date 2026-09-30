---
meta:
  contentType: How-to
---

# FC온라인 시장 데이터를 어떻게 자동으로 갱신하는가

이 문서는 로컬 PoC에서 가격, 선수 상세 metadata, Open API metadata, 랭커 stats를 한 번에 갱신하는 방법을 설명한다. 브라우저 자동화는 실험 경로이며 Gate 0A의 `MANUAL_ONLY` 판정을 변경하지 않는다.

문서 계획: [문서 인덱스의 공통 계획](../00_INDEX.md#문서-계획)

## 자동화 범위를 구분한다

`sync:market`은 공개 Data Center UI와 NEXON Open API를 순서대로 처리한다. Data Center 자동화는 Playwright Chromium을 사용하고 Open API는 기존 공식 API collector를 재사용한다.

한 번의 sync는 다음 순서로 실행한다:

1. Seed 20명의 Data Center 상세 페이지를 순차 탐색한다
2. 브라우저가 관측한 365일 가격 응답 중 가장 긴 series를 Raw로 저장한다
3. 렌더링된 선수 상세 페이지와 관측 응답에서 급여, 포지션, Overall Rating (OVR), 세부 능력치, 특성, 소속, 국가, 팀컬러를 추출한다
4. 가격을 SQLite에 정규화한다
5. Open API static metadata가 오래됐으면 갱신한다
6. 상세 metadata를 `FULL` snapshot으로 적재한다
7. 최신 포지션으로 Open API ranker stats를 수집하고 usage observation을 적재한다

## 브라우저 자동화를 한 번 설정한다

Playwright 1.63.0은 별도 Chromium binary가 필요하다. 프로젝트 dependency와 Chromium을 설치한다.

```bash
npm install
npm run browser:install
```

프로젝트 루트의 `.env`에 자동화 opt-in과 NEXON Open API key를 저장한다. `.env`는 저장소에 커밋하지 않는다.

```dotenv
FC_MARKET_ENABLE_BROWSER_AUTOMATION=1
NEXON_OPEN_API_KEY=your_access_token_here
FC_MARKET_BROWSER_HEADLESS=1
FC_MARKET_BROWSER_DELAY_MS=2500
FC_MARKET_METADATA_REFRESH_DAYS=7
FC_MARKET_SYNC_INTERVAL_HOURS=24
```

## 전체 수집과 갱신을 실행한다

단일 실행은 현재 Raw snapshot과 SQLite를 갱신한다. 같은 입력은 기존 idempotency 계약을 따라 중복 row를 만들지 않는다.

```bash
npm run sync:market
```

지속 실행은 한 sync가 끝난 뒤 설정한 시간만큼 기다리고 다시 실행한다. 기본 간격은 24시간이다.

```bash
npm run sync:watch
```

`sync:watch`는 sync를 겹쳐 실행하지 않는다. `data/.sync-market.lock`이 존재하면 두 번째 실행은 실패한다.

## 접근 제어를 우회하지 않는다

브라우저 collector는 공개 UI만 사용한다. 다음 조건을 만나면 해당 sync를 실패시키고 우회하지 않는다:

- HTTP 403 또는 429
- CAPTCHA 또는 자동입력 방지 화면
- 지원하는 가격 graph를 찾지 못한 경우
- 선수 record, 20개 이상의 named stat, 국가 또는 팀컬러를 추출하지 못한 경우
- 페이지 구조가 바뀌어 player identity가 일치하지 않는 경우

Stealth plugin, CAPTCHA solving, proxy rotation, 로그인 세션 재사용은 이 workflow에 포함하지 않는다. 정책 검토 근거는 `data/evidence/datacenter-browser-automation-policy.json`에 기록한다.

## 갱신 주기를 분리한다

가격과 ranker stats는 매 sync마다 새 observation을 수집한다. Open API static metadata는 기본 7일 주기로 다시 수집하며 `FC_MARKET_METADATA_REFRESH_DAYS`로 바꿀 수 있다.

Data Center 상세 metadata는 가격 페이지를 방문할 때 함께 추출한다. Raw page와 가격 response는 `data/raw/` 아래에 보존하고 SQLite snapshot과 연결한다.
