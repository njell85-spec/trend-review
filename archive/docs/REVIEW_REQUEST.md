# Trend Review — 코드 검토 요청서

다른 LLM(또는 Claude 웹)에 붙여넣을 요약 + 질문 프롬프트입니다.
전체 소스는 같은 폴더의 `REVIEW_BUNDLE.md` 파일을 함께 첨부하세요.

---

## 1. 프로젝트 한 줄 요약
응급의학/중환자(EM/CCM) 분야 PubMed 신규 논문을 매일 자동 수집·필터링·분석해
HTML 대시보드와 이메일로 발행하는 **Node.js 멀티에이전트 파이프라인**.

## 2. 아키텍처
```
TrendReviewOrchestrator (src/orchestrator)
  ├─ DataCollectorAgent     PubMed E-utilities로 논문 수집
  ├─ ValidationAgent        2-pass 품질 검증(메타데이터/연구설계 점수)
  ├─ FilterAnalyzerAgent    Claude tool use로 점수화·PICO 구조화 분석
  ├─ FullTextAgent          전문(full-text) 보강
  ├─ ReportGeneratorAgent   HTML 대시보드 + JSON 아카이브 생성
  └─ NotificationAgent      Google Drive 업로드 + 이메일 발송

공통 유틸 (src/utils)
  · LLMClient       Claude API 래퍼
  · Cache           결과 캐싱(output/cache)
  · CircuitBreaker  연속 실패 시 차단
  · RetryHelper     지수 백오프 재시도
  · Logger          JSONL 구조화 로깅
  · GitHubPublisher GitHub Pages로 대시보드 발행
```

## 3. 핵심 설계 결정
- **실행 방식**: 로컬 API 키 대신 Claude 구독/클라우드 루틴으로 분석 수행 (`ANTHROPIC_API_KEY` 비활성화가 의도된 기본값).
- **구조화 출력**: Claude tool use(`submit_paper_scores`, `submit_pico_analysis`)로 JSON 강제.
- **복원력**: 체크포인트 기반 `--resume`, CircuitBreaker, RetryHelper.
- **캐싱**: 단계별 결과를 해시 키로 캐싱해 재실행 비용 절감.
- **자동화**: `fetch_papers_action.yml`(GitHub Actions) / `fetch_papers_task.ps1`(Windows 작업 스케줄러).

## 4. 기술 스택
Node.js (ESM), PubMed E-utilities, Anthropic Claude API, Google Drive/Gmail API, GitHub Pages.

---

## 5. 검토 요청 프롬프트 (그대로 복사해서 사용)

> 첨부한 `REVIEW_BUNDLE.md`는 Node.js 멀티에이전트 PubMed 문헌 리뷰 파이프라인의 전체 소스입니다.
> 아래 관점으로 코드 리뷰를 해 주세요. 각 지적은 **파일명:줄번호 → 문제 → 구체적 수정안** 형식으로요.
>
> 1. **정확성/버그**: 비동기 처리, 에러 핸들링, 엣지 케이스, race condition.
> 2. **견고성**: API 실패·레이트리밋·부분 실패 시 복원(재시도/체크포인트/서킷브레이커) 설계의 허점.
> 3. **보안**: 비밀키·토큰 노출, 외부 입력(논문 메타데이터) 처리, 인젝션 가능성.
> 4. **구조/유지보수성**: 에이전트 간 결합도, 중복, 책임 분리, 네이밍.
> 5. **LLM 사용**: 프롬프트 설계, tool use 스키마, 비용/토큰 효율, 캐싱 전략.
>
> 우선순위가 높은 상위 10개 이슈부터 정리하고, 그다음 사소한 개선점을 나열해 주세요.

---

## ⚠️ 보안 주의
이 묶음에는 비밀 정보가 **들어있지 않습니다**. 다음 파일은 절대 외부에 공유하지 마세요:
- `.env` (API 키)
- `credentials.json` / `output/google_token.json` (Google OAuth)
