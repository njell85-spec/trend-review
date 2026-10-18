# 검증 근거 — 2026-10-18

기준: `f816ce2ab3f1f12f302bc2c48e9648fa8867c351`. Windows / Node v24.16.0.
원본 main은 유지하고 분리 브랜치에서 시험했다. CI의 Node 20 / Linux와 환경이 다르다.

| 검사 | 실제 결과 |
|---|---|
| 신규 회귀 | 약어 매칭, 소진 전 제한, 빈 리필, 큐 저장 목록, 종합 링크, 지침 fit 게이트 |
| 전체 단위시험 | 통과: 956/956, 실패 0, 취소/skip 0, 89.046초 |
| `npm run spec-lint` | 통과: 6그룹, 대상 80파일, 경고 0 |
| `git diff --check` | 통과 |
| 같은 후보풀 비교 | 5,282건; 진단 4,273 / holdout 1,009; 네트워크·LLM 0 |
| 링크·새 진입점 | 통과: 로컬 상대 링크 18개 존재, 필수 상태 필드/코드 SHA 확인, 기존 본문 보존 |
| 모바일 실물 | 미완료: Windows Chromium sandbox 실행 파일 접근 오류(원래/작업 폴더 모두) |
| 별도 lint/타입/build | package.json에 별도 스크립트 없음. spec-lint/Node 구문/단위시험으로 검증 |
| 외부 운영·배포 | 미실행: push, PR, merge, 배포, 서버 재시작, 유료 LLM 호출 없음 |

실행 명령:

```sh
npm run spec-lint
node --import ./output/offline-test-guard.mjs --test --test-reporter=tap test/*.test.mjs
node scripts/audit-selection.mjs f816ce2
git diff --check
```

검증용 preload는 외부 fetch와 claude/codex CLI 호출을 거절하며 시험별 명시적 mock은
유지했다. 별도 테스트 임시 디렉터리를 사용했다. preload와 원시 TAP 로그는 로컬
`output/`에만 남는다. 공개 근거에는 호스트 경로·인증 정보·원시 대화를 복사하지 않는다.

최초 전체 시험은 955개 중 950통과/5실패였다. 새 변경이 만든 빈 제외 목록의 배열 참조
회귀 2건을 고쳤고, 기존 Windows CRLF workflow 파서 실패 3건을 고쳤다. 이후 955/955
통과를 확인했다. 후속 지침 keep:false 보호 조건을 추가한 최종 결과는 위 표에 기록한다.
초기 sandbox 임시 디렉터리의 rename 실패는 작업 폴더 안의 테스트 전용 임시 경로로
해소했다. 네트워크 의존 리뷰 테스트의 기본 수집기를 stub으로 바꿨다.

의존성은 기존 설치본을 복사해 사용했다. `npm ci --offline`은 캐시 누락으로 실패했다.
미리보기용 Playwright 설치는 캐시 누락 및 DNS 실패로 완료되지 않았고 패키지 계약은
변경하지 않았다. 기존 Chromium 직접 실행도 sandbox 접근 오류로 이미지가 생성되지
않았다. sandbox 해제/권한 변경/네트워크 설정 변경은 하지 않았다. 이번에 실행한
임시 브라우저 프로세스는 정리했다. 스크린샷 승인이나 모바일 무오버플로를 주장하지 않는다.

새 컨텍스트 검증은 새 Node 프로세스가 진입 문서 링크, 코드 SHA, 필수 현재 상태 필드를
읽어 핵심 상태를 추출하는 수준이다. 독립 모델 독해나 모든 도구의 자동 로딩 실증은 아니다.
기존 CLAUDE/HANDOFF 본문은 새 안내 접두 외에 보존되었는지 기준 커밋과 대조한다.
실측 결과: 두 원본문 모두 접두 외 보존 확인. [검증 요약](validation.json)과
[새 프로세스의 현재 상태 재독 결과](handoff-readback.json)를 함께 남긴다.
