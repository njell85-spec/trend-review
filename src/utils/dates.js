/**
 * KST(Asia/Seoul) 기준 날짜 유틸 — 파이프라인의 모든 날짜는 여기서 뽑는다.
 *
 * CI는 UTC 러너에서 21:30 UTC(= 익일 06:30 KST)에 돌기 때문에
 * toISOString()·로컬 getter 로 날짜를 뽑으면 발행 날짜와 하루 어긋난다.
 */
const TZ = 'Asia/Seoul';

// 'YYYY-MM-DD'
export function kstDateStr(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

// 'YYYY/MM/DD' — PubMed eutils mindate/maxdate 형식
export function kstDateSlash(d = new Date()) {
  return kstDateStr(d).replace(/-/g, '/');
}

// 세션 ID·파일명용 'YYYYMMDD_HHMMSS'
export function kstStamp(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}${g('month')}${g('day')}_${g('hour')}${g('minute')}${g('second')}`;
}

/**
 * 날짜 문자열을 달력상의 연속 일수로 바꾼다.
 *
 * Date 를 쓰면 실행 환경의 타임존에 따라 자정이 전날로 밀릴 수 있어, 발행 경계는
 * 'YYYY-MM-DD' 의 정수 연산만 쓴다.
 *
 * ★ 원래 `TrendReviewOrchestrator` 안의 사설 함수였다. 순차진행(하루 한 트랙) 이
 *   생기면서 **게이트와 예고가 같은 날짜 산술을 봐야** 해서 공용으로 올렸다 —
 *   따로 두면 화면과 실제가 어긋난다(2026-08-16 결함 B2 와 같은 부류).
 */
export function calendarDay(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? '');
  if (!match) return null;
  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // ★ 형식만 보면 `2026-02-31` 도 통과한다. 그러면 게이트는 그 날을 계산해 내고
  //   예고 쪽 `addDays` 는 Date.UTC 로 `2026-03-03` 으로 정규화해서 **둘이 다른 날을
  //   본다**(코드리뷰 실측). 연도 0000~0099 는 JS 의 1900년 보정까지 겹친다.
  //   실재하는 날짜가 아니면 null 을 돌려 "판정 불가" 로 일치시킨다.
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const dim = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > dim) return null;
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear;
}
