import { readFileSync } from 'fs';
import { fileURLToPath, URL } from 'url';

function _defaultProfile() {
  try {
    const url = new URL('../../config/interests.json', import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8'));
  } catch { return { topicGroups: {} }; }
}

// interests.json → Arm2 프롬프트용 한 줄 관심 힌트.
// 그룹별로 "라벨: term1, term2, term3(대표 3개)" 를 '; '로 잇는다.
export function extractInterestKeywords(profile = _defaultProfile()) {
  const groups = Object.values(profile.topicGroups ?? {});
  const parts = groups.map((g) => {
    const terms = (g.terms ?? []).slice(0, 3).join(', ');
    return `${g.label ?? ''}: ${terms}`.trim();
  }).filter((s) => s.length > 1);
  return parts.join('; ');
}
