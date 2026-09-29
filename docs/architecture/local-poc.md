# 로컬 PoC 아키텍처

PoC는 상시 서버 없이 로컬에서 실행한다.

```text
Official sources
      v
Importer / manual annotation
      v
Raw snapshots
      v
Normalized DB
      |
      +--> relationship builder
      +--> cohort builder
      +--> event study
      +--> market metrics
      +--> shock detector
      |
      v
Local report / dashboard
```

초기 저장소는 SQLite로 충분하다.
분석량이 커지면 DuckDB 또는 PostgreSQL로 변경할 수 있다.

## 권장 프로젝트 구성

```text
fc-market-lab/
  data/
    raw/
    fixtures/
    exports/
  src/
    ingest/
    normalize/
    relations/
    metrics/
    studies/
  db/
    migrations/
  reports/
  tests/
```

Python notebook을 프로젝트의 기준 인터페이스로 만들지 않는다.
필요한 분석은 CLI 실행이나 로컬 웹 화면으로 확인한다.
