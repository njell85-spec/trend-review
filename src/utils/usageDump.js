/**
 * usageDump — 이번 프로세스가 태운 토큰·비용을 타워 장부용 JSON으로 떨군다.
 *
 * LLM을 부르는 진입 스크립트마다 installUsageDump()를 한 번 부르면, 워크플로우의
 * "Append usage to tower ledger" 스텝이 그 파일을 읽어 장부에 적재한다.
 * 규칙 정본: global-config rulebook/usage-accounting.md (계약 C1).
 *
 * USAGE_OUT 미지정이면 아무 일도 하지 않으므로 로컬 실행에는 영향이 없다.
 */
import { writeFileSync } from 'fs';
import { llmTelemetry } from './LLMClient.js';

/**
 * 사용량 덤프를 설치하고, 수동 스냅샷용 dump 함수를 돌려준다.
 *
 * exit 훅에 거는 이유: 진입 스크립트들은 소프트 실패·대상 없음 등으로 중간에
 * process.exit(0) 하는 경로가 여럿이라, 정상 종료 지점에만 쓰면 "토큰만 태우고
 * 끝난 날"이 장부에서 통째로 빠진다. 그런 날이야말로 기록이 필요하다.
 *
 * 다만 exit 훅은 SIGTERM/SIGKILL에는 뜨지 않는다 — 잡 타임아웃·런 취소로 죽는 날은
 * 대개 가장 길고 비싼 날이라 그때 전부 잃는 게 제일 아프다. 그래서 오래 걸리는
 * 구간을 지날 때마다 반환된 dump()를 직접 불러 스냅샷을 남길 수 있게 했다.
 *
 * @returns {() => void} 언제든 호출 가능한 스냅샷 덤프 함수
 */
export function installUsageDump() {
  const dump = () => {
    const usageOut = process.env.USAGE_OUT;
    if (!usageOut) return;
    try {
      writeFileSync(usageOut, JSON.stringify({ records: llmTelemetry.summary() }));
    } catch { /* 장부 수집 실패가 파이프라인을 죽여서는 안 된다 */ }
  };
  process.on('exit', dump);
  return dump;
}
