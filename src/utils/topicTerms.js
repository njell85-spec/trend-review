// Short topic tokens are abbreviations, not word stems: ARDS must not match
// "standards" or "towards". Longer configured stems retain substring matching.
export function topicTermMatches(value, term) {
  const hay = String(value ?? '').normalize('NFKC').toLowerCase();
  const needle = String(term ?? '').normalize('NFKC').toLowerCase().trim();
  if (!needle) return false;
  if (/^[a-z]{2,5}$/.test(needle)) {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${needle}(?=$|[^\\p{L}\\p{N}])`, 'u').test(hay);
  }
  return hay.includes(needle);
}
