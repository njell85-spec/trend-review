# 종합 실행 계획 v2 — 전역 하네스 진화 + trend-review 보완

- 작성: 2026-07-04, Fable 5 세션 · 상태: **PeterJ 승인 대기 (미적용)**
- 분석 근거: `2026-07-04-global-claude-md-harness-design.md` (v1.1) + 아래 추가 분석
- 목표: ① 전역 — Sonnet/Opus/Haiku에서도 Fable5 수준 산출물 (모든 프로젝트 공통) ② 개별 — trend-review 한정 보완

---

## 0. 이번 턴 추가 분석 결과 (풀파워 재검토)

| 항목 | 결과 |
|---|---|
| 원격 재확인 | 다른 세션의 push = `ee88ae6` 훅·부트스트랩 체인. **세션 시작 이후 신규 커밋 없음** — 기존 분석에 이미 포함 [사실] |
| 미머지 브랜치 7개 전수 조사 | 고유 미머지 커밋 **0건**(전부 main에 머지됐거나 초기 스냅샷). 유실 작업 없음 → 정리(삭제) 후보 [사실] |
| spec-lint 오탐 위험 발견 | "Top 3"(FilterAnalyzer 프롬프트의 정당 용례), "최근 30일"(MetadataScorer 최신성 라벨·카드 칩)이 **정당하게 존재** → 금지어 검사를 전 저장소가 아니라 **채널 설명 문구에 좁게** 설계해야 함 [사실] |
| 3채널 정본 문자열 위치 확정 | GitHubPublisher.js 444·462행("180일 · 300편 … 1편/일"), NotificationAgent.js 263·267행("최근 6개월(180일)…300편…1편"). Kakao는 스펙상 설명 문구 없음(핵심 5줄만) [사실] |
| 상태파일 gitignore | `!output/selected_papers.json`·`!output/selected_guidelines.json` 예외가 현재 존재(#11 수정 결과) → lint는 **회귀 방지** 역할 [사실] |
| 데이터 소스 포화 | 전역 설정·하네스 6종·커밋 69(모델 서명 포함)·PR 19·브랜치 9·스펙/백로그/메모리/리뷰번들·플러그인 카탈로그·MCP 인벤토리까지 전수 완료. **남은 미접근 소스는 과거 세션 대화 원문뿐**(컨테이너 소멸로 물리적 불가) [사실] |

---

# 1부 — 전역 (모든 클로드 코드 사용에 공통)

## G1. 글로벌 CLAUDE.md 전면 개정 — 아래 전문으로 교체

적용 파일: `.claude/global-CLAUDE.md` (원본) → `apply-global-md.sh`/env-bootstrap이 `~/.claude/CLAUDE.md`로 전파.

```markdown
# 전역 지침 (PeterJ) — Global CLAUDE.md

> 이 파일이 원본입니다. 세션 시작 시 apply-global-md.sh(또는 env-bootstrap)가
> ~/.claude/CLAUDE.md 로 복사해, 모든 프로젝트에 전역 적용합니다.
> 개정 근거: docs/superpowers/specs/2026-07-04-global-claude-md-harness-design.md

## 대화 규칙
- 사용자 호칭은 항상 **PeterJ**, 답변은 항상 **존댓말**.
- 결론부터 말하고 근거는 뒤에. **확인한 사실과 추측을 구분**해 표기한다.

## 작업 프로토콜 (모든 모델 공통 — 경량 모델일수록 더 엄격히)
1. **SSOT 우선**: 프로젝트에 스펙 문서(REPORT_SPEC.md 등)가 있으면 산출물을
   만들기 전에 반드시 읽는다. 요청이 스펙과 다르면 확인 후 진행.
2. **계획 먼저**: 3단계 이상 작업은 착수 전 2~5줄 계획을 제시한다.
3. **영향 범위 전수 반영**: 값·문구·정책을 바꾸면 등장하는 모든 위치를
   grep으로 찾아 함께 바꾸고, 바꾼 위치 목록을 보고한다(다채널 산출물 특히).
4. **설정은 실행 지점까지 추적**: 모델명·플래그·환경변수를 바꿨으면 그 값이
   실제 실행 코드까지 전달되는 경로를 확인한다.

## 완료 기준 — 증거 없는 "됐습니다" 금지
- 완료 주장 전 실행/테스트/렌더를 실제로 확인하고 증거(명령·출력 요지)를
  함께 보고한다. verify / superpowers verification-before-completion 을 따른다.
- 실패·미완·건너뜀은 숨기지 않고 그대로 보고한다.
- 커밋 전 셀프 리뷰 체크리스트:
  ① 시크릿/토큰이 로그·에러 메시지·argv에 노출되는가
  ② 외부 입력·LLM 출력이 HTML/셸에 이스케이프 없이 들어가는가
  ③ 상태 파일이 .gitignore에 막혀 있지 않은가
  ④ 실패 경로(재시도·resume·부분 실패)가 데이터를 망치지 않는가
  ⑤ 날짜·시간은 KST 기준인가
- 규모 있는 변경은 커밋 전 /code-review 로 검토한다. 경량 모델(Haiku/Sonnet)
  세션에서는 가능하면 리뷰를 상위 모델(Opus 이상) 서브에이전트에 위임한다.
- PR 머지 전에는 리뷰 결과 요지를 PR 본문에 한 줄이라도 남긴다.

## 디버깅 규칙
- 원인을 재현·관찰로 확정한 뒤 고친다(가설만으로 수정 직행 금지).
  superpowers systematic-debugging 을 따른다.
- 에러가 안 보이면 관측성(로그·출력 노출) 확보를 먼저 한다.

## UI·산출물 변경 (PeterJ는 모바일 사용자)
- 대시보드·HTML·메시지 포맷 변경은 push 전에 스크린샷(모바일 390px·
  태블릿 800px)이나 실제 메시지 미리보기를 보여주고 승인받는다.
  (프로젝트에 /preview 스킬이 있으면 그것을 사용.)
- 요청받지 않은 배지·표기·장식을 임의로 추가하지 않는다. 필요하면 먼저 제안.

## git 습관
- 세션 시작 시 pull(훅 자동), 마무리 시 commit + push(허브=GitHub).
- 커밋은 작게, 메시지에는 "왜"가 보이게.

## 환경 유지
- superpowers 플러그인 항상 설치·활성 (SessionStart 훅 담당).
```

- 근거 매핑: 설계 보고서 §5 변경 주석 표 + v1.1 보완 1·4 (verify 명시, PR 리뷰 기록, 상위 모델 위임).
- 검증: 교체 후 `apply-global-md.sh` 실행 → `~/.claude/CLAUDE.md` diff 확인. 다음 세션에서 자동 로드.
- 롤백: `git revert` 한 번.

## G2. env-bootstrap v2 — 지침 이중화 제거 (단일 원본)

문제 [사실]: 현 `env-bootstrap.sh`는 전역 지침 사본을 heredoc으로 내장 → **이미 저장소 원본과 내용 불일치**. G1을 적용해도 부트스트랩이 구버전을 덮어쓸 수 있음(적용 순서에 따라 지침이 세션마다 왔다갔다).

수정: 스크립트의 "(3) 전역 지침 적용" 블록을 아래로 교체 —

```bash
# 3) 전역 지침 적용 — 저장소 원본(단일 소스)에서 다운로드.
#    실패 시 기존 파일 유지(없을 때만 최소본 생성). 프로젝트를 열면
#    apply-global-md.sh 가 어차피 원본으로 덮어쓴다.
RAW_URL="https://raw.githubusercontent.com/njell85-spec/trend-review/main/.claude/global-CLAUDE.md"
TMP="$HOME/.claude/CLAUDE.md.download"
if curl -fsSL --max-time 10 "$RAW_URL" -o "$TMP" 2>/dev/null && [ -s "$TMP" ]; then
  mv "$TMP" "$HOME/.claude/CLAUDE.md"
else
  rm -f "$TMP"
  [ -f "$HOME/.claude/CLAUDE.md" ] || cat > "$HOME/.claude/CLAUDE.md" <<'MD'
# 전역 지침 (PeterJ) — 최소본 (네트워크 실패 폴백)
- 사용자 호칭은 항상 **PeterJ**, 답변은 항상 **존댓말**.
- 완료 주장 전 실행/테스트로 확인하고 증거와 함께 보고한다.
MD
fi
```

- **PeterJ 수동 작업 1회**: 반영 후 클라우드 [환경 설정 > 셋업 스크립트]에 갱신된 env-bootstrap.sh 내용을 교체 붙여넣기 (제가 접근 불가).
- 전제 확인됨: 저장소 public → raw 접근 가능. 새 환경 네트워크 정책이 막으면 폴백이 기존 파일 보존.
- 검증: 스크립트 문법 `bash -n` + 로컬 모의 실행(HOME을 임시 디렉터리로).

## G3. 전역 리뷰 위임 규칙 (G1에 포함, 별도 파일 없음)

경량 모델 세션에서 커밋 전 리뷰를 상위 모델 서브에이전트로 — PeterJ가 수동 운영하던 REVIEW_REQUEST.md 공정의 자동화. 지시 기반으로 시작하고, 효과 확인 후 훅 강제(G4)로 승격.

## G4. 전역 실험 트랙 (이번 미적용 — 관찰 후 채택)

| 항목 | 방법 | 판단 기준 |
|---|---|---|
| episodic-memory 플러그인 | **데스크탑 CLI**에 설치(리모트는 컨테이너 소멸로 인덱스 안 쌓임) | 과거 결정 재질문 빈도 감소 |
| double-shot-latte 플러그인 | 리모트/데스크탑 설치 | "계속할까요?" 중단 빈도 |
| Stop 훅에 spec-lint 연결 | 프로젝트별 | 오탐·노이즈율 |
| UserPromptSubmit 스펙 리마인더 | 프로젝트별 | 주입 피로도 |
| 상위모델 리뷰 훅 강제 | PreToolUse(git commit 매처) | G3 지시 준수율 부족 시 |

## G5. 보류

개인 스킬 마켓플레이스(`peterj-skills`) — 프로젝트가 2~3개로 늘어 전역 스킬 배포가 실익이 생기는 시점에.

---

# 2부 — trend-review 한정

## T1. `/preview` 스킬 + `scripts/preview.mjs` — push 전 모바일 미리보기

- `.claude/skills/preview/SKILL.md`: 트리거 "대시보드·index.html·카톡/이메일 포맷을 수정한 뒤, push 전 반드시".
- `scripts/preview.mjs`: ① `index.html`을 폰(390px)·태블릿(800px) 뷰포트로 풀페이지 스크린샷 → `output/preview-*.png` ② `output/selected_papers.json`이 있으면 `KakaoNotifier.buildReportMessages()` 실제 출력 텍스트 프린트. 스킬은 이 산출물을 PeterJ께 전송하고 승인 후 push.
- 구현 코드(요지):

```js
import { chromium } from 'playwright';
const exec = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: exec }).catch(() => chromium.launch());
for (const [name, width] of [['phone', 390], ['tablet', 800]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `output/preview-${name}.png`, fullPage: true });
}
await browser.close();
// + try { KakaoNotifier.buildReportMessages(...) 출력 } catch { 건너뜀 }
```

- 검증(적용 시 실제 수행): 스크립트 실행 → PNG 2장 생성 확인 → PeterJ께 전송해 실물 확인.
- 겨냥 실패: 하루 8개 UI 왕복 PR(B4).

## T2. `scripts/spec-lint.mjs` + CI 앞단 — 좁게 설계된 결정적 검사

오탐 방지를 위해 **채널 템플릿 문자열에만** 검사 (0절 발견 반영):

| # | 검사 | 대상 |
|---|---|---|
| 1 | "180일"·"300편"·"1편" 표기가 모두 존재 | GitHubPublisher.js, NotificationAgent.js |
| 2 | 스크리닝 설명 맥락의 옛 표현 금지: `/Top ?3 (논문|papers|선정)/`, `/최근 ?30일.{0,10}(스크리닝|논문을|윈도우)/`, `/40\s*[~-]\s*50\s*편/` | 위 2파일 + index.html 헤더/푸터 |
| 3 | 카톡 빌더에 대시보드 링크 보장(`github.io` 폴백 존재) | KakaoNotifier.js |
| 4 | 카톡 메시지에 금지 장식 없음(점수·LLM경로·🥇) | KakaoNotifier.buildReportMessages |
| 5 | 상태파일 gitignore 예외 유지(`!output/selected_papers.json`, `!output/selected_guidelines.json`) | .gitignore |
| 6 | (경고만) `console.*`/에러 문자열에 TOKEN류 변수 직접 보간 휴리스틱 | src/**.js |

- 연결: `package.json`에 `"spec-lint": "node scripts/spec-lint.mjs"` + `daily-review.yml`의 파이프라인 실행 **전** 스텝(실패 시 잡 중단 — 무인 실행 보호).
- 검증(적용 시): 현 코드로 실행해 **전부 통과** 확인(오탐 0) → 일부러 금지어 넣어 **실패 재현** 확인 → 원복.
- 겨냥 실패: 채널 드리프트(B1) 회귀 방지.

## T3. 프로젝트 CLAUDE.md 보강 (3줄)

"작업 습관" 아래 추가:
```markdown
## 품질 게이트 (이 프로젝트 전용)
- 리포트·발송·대시보드 관련 작업 전 **REPORT_SPEC.md 필독** (단일 기준).
- 대시보드·메시지 포맷 변경 시 push 전 **/preview 로 미리보기 승인**.
- 커밋 전 **npm run spec-lint** 통과 확인.
```

## T4. 원격 브랜치 청소 [별도 승인 — 삭제라서]

미머지 고유 커밋 0건 확인된 원격 브랜치 6개(`code-review-optimization-foai3i/-v49rv5`, `git-desktop-workflow`, `github-pages-update-failure`, `mobile-functionality-check`, `trend-review-paper-analysis`, `github-api-access-fix`) 삭제. 작업 이력은 main에 모두 보존됨. 현 작업 브랜치는 제외.

## T5. 별도 과제로 남김 (이번 미적용)

- `index.html`↔`GitHubPublisher` 이중 관리 해소(재작업 배증 원인 — 규모 커서 독립 리팩터링 과제).
- GitHub Actions 실패 감시 Routine(예약 세션 — 계정 설정 필요, 원하시면 다음에 등록).
- `/fewer-permission-prompts`는 **데스크탑에서** 실행(리모트 컨테이너엔 과거 트랜스크립트가 없어 효과 미미).

---

# 3. 적용 순서 · 검증 · 롤백

1. G1(전역 지침) → 2. G2(부트스트랩) → 3. T1(실행 검증 포함) → 4. T2(통과+실패재현 검증) → 5. T3 → 6. (승인 시) T4 → 7. 설계 문서 상태 갱신 → 8. 커밋·푸시(현 브랜치, PR은 요청 시).
- 모든 항목 git revert로 롤백 가능. G2는 PeterJ의 환경설정 붙여넣기 전까지는 저장소에만 존재(위험 0).
- 완료 보고 시 각 항목의 실행 증거(스크린샷·lint 출력) 첨부.

# 4. 승인 체크리스트

- [ ] **G1** 글로벌 CLAUDE.md 개정 (전문 위 §G1)
- [ ] **G2** env-bootstrap v2 (+ PeterJ 환경설정 붙여넣기 1회)
- [ ] **T1** /preview 스킬 + 스크립트
- [ ] **T2** spec-lint + CI 앞단
- [ ] **T3** 프로젝트 CLAUDE.md 품질 게이트 3줄
- [ ] **T4** 원격 브랜치 6개 삭제 (선택)
- [ ] G4 실험 트랙 중 착수할 항목 (선택: episodic-memory는 데스크탑 설치 안내만 가능)
