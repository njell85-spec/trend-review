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
