#!/usr/bin/env node
/**
 * spec-lint.mjs — REPORT_SPEC.md 정합성 결정적 검사 (LLM 불사용)
 *
 * "또 반영이 안 됐다"(채널 간 스펙 드리프트)를 기계적으로 차단한다.
 * 검사는 채널 산출 경로에 좁게 건다 — "Top 3"(프롬프트의 정당 용례),
 * "최근 30일"(MetadataScorer 최신성 라벨) 같은 정당한 표현을 오탐하지 않기 위함.
 * 코드 파일은 문자열 리터럴만 검사해 식별자·주석 오탐을 배제한다.
 *
 * 사용: npm run spec-lint   (실패 시 exit 1 — CI 앞단에서 파이프라인 중단)
 */
import { readFileSync, readdirSync, statSync } from 'fs';

const errors = [];
const warns = [];
const read = (p) => readFileSync(p, 'utf8');

// 코드에서 문자열 리터럴('…' "…" `…`)만 이어붙여 반환 — 주석·식별자 오탐 방지.
const stringLiterals = (src) =>
  (src.match(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g) ?? []).join('\n');

const pub = read('src/utils/GitHubPublisher.js');
const noti = read('src/agents/NotificationAgent.js');
const kakao = read('src/agents/KakaoNotifier.js');
const idx = read('index.html');
const kakaoStr = stringLiterals(kakao);

// ── 1) 정본 표기 존재 (REPORT_SPEC §1·§3·§4: 180일·300편·1편) ────────────────
// index.html 포함 — 배포 산출물은 증분 패치되므로 헤더가 독자 드리프트 가능.
for (const [name, src] of [
  ['src/utils/GitHubPublisher.js', pub],
  ['src/agents/NotificationAgent.js', noti],
  ['index.html', idx],
]) {
  for (const token of ['180일', '300편', '1편']) {
    if (!src.includes(token)) errors.push(`${name}: 정본 표기 "${token}" 누락 (REPORT_SPEC §1/§3/§4)`);
  }
}

// ── 2) 옛 스펙 표현 금지 — 전 채널 (REPORT_SPEC §1) ─────────────────────────
// 카톡 채널 포함(문자열 리터럴만). 패턴은 스크리닝 설명 맥락 한정(오탐 방지).
const oldSpec = [
  [/Top ?3\s*(논문|papers|선정)/i, '"Top 3 논문/선정"'],
  [/최근 ?30일[^\n]{0,12}(스크리닝|논문을|윈도우)/, '"최근 30일 …스크리닝/논문"'],
  [/(?<!\d)30일[^\n]{0,8}(?:\d{2,3}\s*편|스크리닝)/, '"30일 … N편/스크리닝"'],
  [/40\s*[~∼-]\s*50\s*편/, '"40~50편"'],
  [/(?<![\d/])3\s*편\s*\/\s*일/, '"3편/일"'],
];
for (const [name, src] of [
  ['src/utils/GitHubPublisher.js', pub],
  ['src/agents/NotificationAgent.js', noti],
  ['index.html', idx],
  ['src/agents/KakaoNotifier.js(문자열)', kakaoStr],
]) {
  for (const [re, label] of oldSpec) {
    const m = src.match(re);
    if (m) errors.push(`${name}: 옛 표현 ${label} 발견 → "${m[0]}" (REPORT_SPEC §1 금지)`);
  }
}

// ── 3) 카톡: 검사 앵커 + 대시보드 링크 폴백 (REPORT_SPEC §2) ─────────────────
// 앵커(빌더 메서드)가 사라지면 "무검사 통과"가 아니라 lint 실패로 처리한다.
if (!/static\s+buildReportMessages\s*\(/.test(kakao)) {
  errors.push('src/agents/KakaoNotifier.js: buildReportMessages 메서드 앵커 소실 — 개명/삭제 시 spec-lint도 함께 갱신할 것');
}
if (!kakaoStr.includes('github.io/trend-review')) {
  errors.push('src/agents/KakaoNotifier.js: 대시보드 링크 폴백(github.io/trend-review) 없음 (REPORT_SPEC §2)');
}

// ── 4) 카톡: 금지 장식 없음 — 파일 내 모든 문자열 리터럴 (REPORT_SPEC §2) ────
// 빌더 본문만 보면 send() 등 발송 경로에서 붙는 장식을 놓친다(리뷰 확정 결함).
for (const [re, label] of [
  [/🥇/u, '메달(🥇)'],
  [/LLM ?경로|llmRoute/i, 'LLM 경로 표기'],
  [/evidenceLevel|스크리닝 ?점수|종합점수/i, '점수/등급 표기'],
]) {
  const m = kakaoStr.match(re);
  if (m) errors.push(`src/agents/KakaoNotifier.js: 발송 문자열에 금지 장식 ${label} 포함 → "${m[0]}" (REPORT_SPEC §2 — 핵심 5줄만)`);
}

// ── 5) 상태파일 gitignore 예외 유지 (PR #11 회귀 방지 — 중복 선정 차단) ──────
// 줄 단위 앵커 — 주석 처리(#!output/…)도 소실로 판정한다.
const gi = read('.gitignore');
for (const f of ['selected_papers', 'selected_guidelines']) {
  const re = new RegExp(String.raw`^!output/${f}\.json\s*$`, 'm');
  if (!re.test(gi)) errors.push(`.gitignore: 상태파일 예외 "!output/${f}.json" 소실/비활성 — 주간 게이트·중복 방지 무력화 (PR #11 회귀)`);
}

// ── 6) (경고) 로그에 시크릿 보간 휴리스틱 ────────────────────────────────────
const jsFiles = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) jsFiles.push(p);
  }
})('src');
const secretLog = /console\.(log|error|warn)\([^)]*\$\{[^}]*(TOKEN|API_KEY|SECRET|REFRESH)[^}]*\}/i;
for (const p of jsFiles) {
  const m = read(p).match(secretLog);
  if (m) warns.push(`${p}: 로그에 시크릿 보간 의심 → ${m[0].slice(0, 70)}…`);
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
if (warns.length) {
  console.log('⚠ 경고:');
  for (const w of warns) console.log(`  - ${w}`);
}
if (errors.length) {
  console.error('✖ spec-lint 실패:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ spec-lint 통과 (검사 6그룹 · 대상 ${4 + jsFiles.length}파일 · 경고 ${warns.length}건)`);
