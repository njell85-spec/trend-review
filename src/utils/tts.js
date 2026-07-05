/**
 * tts — Google Cloud Text-to-Speech REST 어댑터 (API 키 방식).
 * 키는 URL 쿼리로만 전달하고 로그·에러 메시지에 절대 노출하지 않는다.
 * 무료 티어(월 100만 자) 내 운용 — 일 4편 기준 월 ~45만 자 추정 (스펙 §5.2).
 */
const VOICES = {
  ko: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-C' },
  en: { languageCode: 'en-US', name: 'en-US-Neural2-D' },
};

export async function synthesizeMp3(text, lang) {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error('GOOGLE_TTS_API_KEY 미설정');
  const voice = VOICES[lang];
  if (!voice) throw new Error(`지원하지 않는 언어: ${lang}`);
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice,
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.06 },
    }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`); // 응답 본문은 로그 금지(키 에코 방지)
  const { audioContent } = await res.json();
  if (!audioContent) throw new Error('TTS 응답에 오디오 없음');
  return Buffer.from(audioContent, 'base64');
}
