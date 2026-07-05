# Archive — 운영 경로에서 제외된 파일들

여기 파일들은 **데일리 파이프라인이 참조하지 않는** 일회성 스크립트·과거 산출물이다.
운영 경로는 `.github/workflows/daily-review.yml` → `github-actions-daily.mjs` → `src/`
와 배포 검증용 `scripts/verify-pages-deploy.mjs`(+ `scripts/spec-lint.mjs` 등 루트
`scripts/`의 CI 스크립트) 뿐이다. (루트 `scripts/` ≠ 여기 `archive/scripts/`.)

| 폴더 | 내용 | 주의 |
|------|------|------|
| `scripts/` | 일회성 리빌드·시드·디자인 생성 스크립트 (2026-06 날짜 고정 다수) | **실행 금지** — 상대 경로가 루트 기준이라 여기서는 깨지며, `run-today.mjs`/`rebuild-github.mjs`/`seed_today.mjs`는 실행 시 사이트·상태 파일을 과거(2026-06) 상태로 되돌린다. `run_today.bat`은 스펙(300/1/180)과 다른 옛 인자를 쓴다. |
| `design-mockups/` | 디자인 시안 HTML (Sky 파스텔 확정 전 비교용) | 참고용 |
| `designs/` | 디자인 갤러리(시안 + 스크린샷) | 참고용 |
| `docs/` | 과거 코드 리뷰 요청 문서(2026-06-20 시점 아키텍처 설명 — 현재와 다름) | 최신 스펙은 루트 `REPORT_SPEC.md` |

복원이 필요하면 git 히스토리(`git log --follow`)로 원래 위치를 확인할 수 있다.
