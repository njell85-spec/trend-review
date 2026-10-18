// Short topic tokens are abbreviations, not word stems: ARDS must not match
// "standards" or "towards". Longer configured stems retain substring matching.
// Only explicit, clinically established combined forms bypass token boundaries.
const SHORT_TOKEN_ALIASES = { cpr: ['dnacpr'] };

export function topicTermMatches(value, term) {
  const hay = String(value ?? '').normalize('NFKC').toLowerCase();
  const needle = String(term ?? '').normalize('NFKC').toLowerCase().trim();
  if (!needle) return false;
  if (/^[a-z]{2,5}$/.test(needle)) {
    const tokens = [needle, ...(SHORT_TOKEN_ALIASES[needle] ?? [])].join('|');
    return new RegExp(`(^|[^\\p{L}\\p{N}])(?:${tokens})(?=$|[^\\p{L}\\p{N}])`, 'u').test(hay);
  }
  return hay.includes(needle);
}
