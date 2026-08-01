/**
 * telegram-smoke.mjs — 텔레그램 통로 점검 (판정·리포트 없이 테스트 메시지 1건)
 *
 * 왜 있나: 시크릿(TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)은 저장 후 다시 볼 수 없어,
 * 타이핑 실수를 리포트가 실제로 안 오는 날에야 발견하게 된다. 이 스크립트로 등록 직후
 * 통로를 확인한다. 세션 컨테이너에서는 못 돌린다(프록시가 api.telegram.org 차단) —
 * Actions의 telegram-smoke.yml(workflow_dispatch)로 돌린다.
 *
 * 실패 시 종료코드 1 — 워크플로가 빨갛게 남는 것이 확인 수단이다.
 */
import { TelegramNotifier } from '../src/agents/TelegramNotifier.js';

const t = new TelegramNotifier();
if (!t.isConfigured) {
  console.error('❌ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정 — repo Secrets를 확인하세요.');
  process.exit(1);
}

try {
  await t._post('✅ trend-review 텔레그램 통로 확인 (스모크 테스트). 이 메시지가 보이면 셋업이 끝난 것입니다.');
  console.log('✅ 스모크 발송 성공 — 텔레그램에서 메시지를 확인하세요.');
} catch (err) {
  // TelegramNotifier가 에러에 URL을 넣지 않으므로 message는 로그에 남겨도 안전하다.
  console.error(`❌ 스모크 발송 실패: ${err.message}`);
  if (/chat not found/i.test(err.message)) {
    console.error('   → 봇이 이 대화를 모릅니다. 텔레그램에서 봇에게 /start를 한 번 누르거나 TELEGRAM_CHAT_ID 값을 확인하세요.');
  } else if (/401/.test(err.message)) {
    console.error('   → 토큰이 거부됐습니다. TELEGRAM_BOT_TOKEN 값을 확인하세요.');
  }
  process.exit(1);
}
