/**
 * VideoAgent — Phase 3: 리포트 → 영상 4편(중간폼·숏폼 × ko·en) 제작·비공개 업로드.
 *
 * B1 스크립트(LLM 1회) → B2 슬라이드 렌더 → B3 TTS → B4 자막 → B5 ffmpeg 번인 합성
 * → B6 YouTube 업로드(privacyStatus: private 고정) → B7 output/video_log.json 기록.
 * 편별 독립 소프트 실패. 재실행 시 video_log로 중복 업로드 방지.
 * 상태 파일 지속은 워크플로우 "Commit daily state" 스텝이 담당(로컬 쓰기만).
 */
import path from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { google } from 'googleapis';
import { Logger } from '../utils/Logger.js';
import { LLMClient } from '../utils/LLMClient.js';
import { getGoogleAuth } from '../utils/googleAuth.js';
import { VIDEO_SCRIPT_TOOL, buildScriptMessages, validateScripts } from '../utils/videoScript.js';
import { chartFromAnalysis } from '../utils/ChartRenderer.js';
import {
  renderSlidePngs, cuesFromNarration, buildSrt, assembleVideo, probeDurationSec,
} from '../utils/videoRender.js';
import { synthesizeMp3 } from '../utils/tts.js';
import { cardsFromScript, renderCards } from '../utils/cardNews.js';

const LOG_PATH = path.join(process.cwd(), 'output', 'video_log.json');
const FORMS = [
  { form: 'midform', orientation: 'landscape' },
  { form: 'short', orientation: 'portrait' },
];
// 발신 언어 — 영어 우선 전략(PeterJ 확정, 2026-07-06). 한국어판 추가는 코드 수정 없이
// VIDEO_LANGS=en,ko 로 확장한다 (대본은 스키마상 항상 ko·en 둘 다 생성됨).
const LANGS = (process.env.VIDEO_LANGS || 'en').split(',').map((s) => s.trim()).filter(Boolean);

export class VideoAgent {
  constructor() {
    this.logger = new Logger('VideoAgent', { logFile: 'video_agent.jsonl' });
  }

  /** upload=false면 파일 생성까지만 (샘플 승인 게이트용 — scripts/video-sample.mjs) */
  async run({ analysis, todayKST, pagesUrl, upload = true }) {
    // 재실행 안전: 이미 업로드된 편은 제작(LLM·TTS·ffmpeg) 전에 건너뛴다 —
    // 업로드 직전 체크만으로는 재실행마다 TTS 쿼터·LLM 호출을 다시 지출한다.
    const pmid = analysis.pmid ?? analysis.paper?.pmid;
    const log = upload ? await this._loadLog() : {};
    const done = [];
    const pending = [];
    for (const { form, orientation } of FORMS) {
      for (const lang of LANGS) {
        const key = `${pmid}_${form}_${lang}`;
        if (upload && log[key]) done.push({ form, lang, videoId: log[key] });
        else pending.push({ form, lang, orientation });
      }
    }
    if (!pending.length) {
      this.logger.info(`전 편 이미 업로드됨(재실행 안전): ${done.map((d) => `${d.form}/${d.lang}`).join(', ')}`);
      return { ok: true, videos: done, cards: [] };
    }

    const llm = new LLMClient({});
    const raw = await llm.callWithTool(buildScriptMessages(analysis), VIDEO_SCRIPT_TOOL, { maxTokens: 8192 });
    const scripts = validateScripts(raw, LANGS);
    const enriched = { ...analysis, chartData: scripts.chartData };

    const results = [...done];
    for (const { form, lang, orientation } of pending) {
      try {
        const file = await this._produce({ enriched, script: scripts[form][lang], form, lang, orientation, todayKST });
        const videoId = upload
          ? await this._upload({ file, analysis: enriched, form, lang, todayKST, pagesUrl })
          : null;
        results.push({ form, lang, videoId, file });
      } catch (e) {
        this.logger.warn(`${form}/${lang} 실패(계속): ${e.message}`);
        results.push({ form, lang, error: e.message });
      }
    }

    // 카드뉴스 — 숏폼 스크립트(첫 언어) 재사용, 이미지 파일만 생성(발신은 Phase 4)
    const cards = [];
    for (const lang of LANGS) {
      try {
        const files = await this._produceCards({ enriched, script: scripts.short[lang], lang, todayKST });
        cards.push({ lang, files });
      } catch (e) {
        this.logger.warn(`카드뉴스/${lang} 실패(계속): ${e.message}`);
        cards.push({ lang, error: e.message });
      }
    }

    return { ok: results.some((r) => !r.error), videos: results, cards };
  }

  async _produce({ enriched, script, form, lang, orientation, todayKST }) {
    const work = path.join(process.cwd(), 'output', 'video', `${todayKST}-${form}-${lang}`);
    await mkdir(work, { recursive: true });
    const chart = chartFromAnalysis(enriched, lang);
    const pngs = await renderSlidePngs(script.slides, {
      orientation, chartSvg: chart?.svg ?? null, outDir: work,
    });
    const mp3s = [];
    const durations = [];
    for (let i = 0; i < script.narration.length; i++) {
      const f = path.join(work, `n-${i}.mp3`);
      await writeFile(f, await synthesizeMp3(script.narration[i], lang));
      mp3s.push(f);
      durations.push(await probeDurationSec(f));
    }
    if (form === 'short') {
      const total = durations.reduce((a, b) => a + b, 0);
      if (total > 60) throw new Error(`숏폼 ${total.toFixed(1)}s > 60s — 대본 축약 필요`);
    }
    const srtPath = path.join(work, 'subs.srt');
    await writeFile(srtPath, buildSrt(cuesFromNarration(script.narration, durations)));
    const outPath = path.join(work, 'video.mp4');
    await assembleVideo({ pngs, mp3s, durations, srtPath, outPath });
    this.logger.info(`${form}/${lang} 합성 완료 (${durations.reduce((a, b) => a + b, 0).toFixed(1)}s)`);
    return outPath;
  }

  async _produceCards({ enriched, script, lang, todayKST }) {
    const work = path.join(process.cwd(), 'output', 'cards', `${todayKST}-${lang}`);
    const chart = chartFromAnalysis(enriched, lang);
    const p = enriched.paper ?? {};
    const title = (lang === 'ko' && enriched.title_ko) ? enriched.title_ko : p.title;
    const cards = cardsFromScript(script, { title, pmid: p.pmid, lang });
    const files = await renderCards(cards, { outDir: work, chartSvg: chart?.svg ?? null });
    this.logger.info(`카드뉴스/${lang} ${files.length}장 생성`);
    return files;
  }

  async _upload({ file, analysis, form, lang, todayKST, pagesUrl }) {
    const p = analysis.paper ?? {};
    const key = `${analysis.pmid ?? p.pmid}_${form}_${lang}`;
    const log = await this._loadLog();
    if (log[key]) {
      this.logger.info(`이미 업로드됨(재실행 안전): ${key}`);
      return log[key];
    }
    const auth = await getGoogleAuth({ logger: this.logger });
    if (!auth) throw new Error('google-auth-unset');
    const yt = google.youtube({ version: 'v3', auth });
    const base = lang === 'ko'
      ? `[EM/CCM ${form === 'short' ? 'Shorts' : '리뷰'}] ${analysis.title_ko || p.title}`
      : `[EM/CCM ${form === 'short' ? 'Shorts' : 'Review'}] ${p.title}`;
    const suffix = ` (${todayKST})`;
    const title = base.slice(0, 100 - suffix.length) + suffix; // YouTube 제목 하드 리밋 100자
    const description = [
      lang === 'ko' ? '오늘의 논문 리뷰 — 검증된 수치만 사용합니다.' : 'Daily paper review — verified figures only.',
      `PubMed: https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`,
      p.doi ? `DOI: https://doi.org/${p.doi}` : null,
      `Dashboard: ${pagesUrl}`,
    ].filter(Boolean).join('\n');
    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description, categoryId: '27' }, // 27 = Education
        status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
      },
      media: { body: createReadStream(file) },
    });
    log[key] = res.data.id;
    await this._saveLog(log);
    this.logger.info(`업로드 완료: ${form}/${lang}`);
    return res.data.id;
  }

  async _loadLog() {
    try {
      return JSON.parse(await readFile(LOG_PATH, 'utf8'));
    } catch {
      return {};
    }
  }

  async _saveLog(log) {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    await writeFile(LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  }
}
