/**
 * LLMClient — provider-agnostic wrapper for LLM calls.
 *
 * Anthropic provider uses the `claude` CLI (Claude Code subscription) — no API key needed.
 * OpenAI provider uses the openai SDK with OPENAI_API_KEY.
 *
 * Accepts Anthropic-style tool definitions ({ name, description, input_schema })
 * and translates the schema into a prompt instruction for the CLI path,
 * or into OpenAI function-calling format for the openai path.
 */
import { spawn } from 'child_process';

// 리눅스 MAX_ARG_STRLEN 은 128KB(=32 페이지). 여유를 두고 96KB 를 넘으면 stdin 으로 보낸다.
const ARGV_PROMPT_LIMIT = 96_000;   // 바이트
import OpenAI from 'openai';
import { isSessionRateLimit } from './retryPipeline.js';

export const PROVIDER_DEFAULTS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
};

// 선정·심층분석에 쓰는 정본 모델 — 에이전트별 하드코딩 대신 여기 한 곳만 수정
export const ANTHROPIC_ANALYSIS_MODEL = process.env.ANALYSIS_MODEL ?? 'claude-opus-4-8';

const API_FETCH_TIMEOUT_MS = 180_000; // API 폴백 호출당 상한 (행 방지)

// 실행 경로 집계(그날 구독 CLI로 돌았는지 / API 폴백으로 넘어갔는지).
// 프로세스 전역 카운터 — 오케스트레이터가 run() 시작 시 reset().
//
// 두 층으로 나뉜다:
//   · cli/api/apiWeb — "이번 런"의 경로 카운터. reset() 대상이고 label()이 읽는다.
//   · totals         — 토큰·비용 누적. **reset()이 건드리지 않는다.** 세션 한도(429)로
//                      파이프라인을 재시도하면 오케스트레이터가 런마다 reset()을 부르는데,
//                      totals까지 지우면 실패한 시도에서 실제로 태운 토큰이 장부에서
//                      사라진다(한도에 걸릴 만큼 쓴 판이 통째로 누락됨). 장부는 프로세스가
//                      태운 총량을 기록해야 하므로 누적만 한다.
//
// 집계 키는 (auth, 모델) 쌍이다. auth로만 묶고 모델명을 'opus+sonnet'처럼 이어붙이면
// 장부에 쓰레기 모델 행이 생기고 현황판의 모델별 롤업이 깨진다 — 게다가 장부는
// append-only라 되돌릴 수 없다. 룰북이 "장부에 원자료(모델·토큰)를 그대로 둔다"고
// 약속하는 것도 이 때문이다. CLI가 modelUsage로 모델별 정확한 수치를 주므로 그대로 쓴다.
// auth를 나누는 이유는 별개다: 장부 스키마의 auth가 subscription|api 2값뿐이라
// (rulebook/usage-accounting.md 계약 C1) 한 줄에 섞을 수 없다.
const emptyBucket = () => ({ calls: 0, in: 0, out: 0, cacheW: 0, cacheR: 0, costUsd: 0 });
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const llmTelemetry = {
  cli: 0, api: 0, apiWeb: 0,
  totals: { subscription: {}, api: {} },   // auth → 모델명 → bucket
  reset() { this.cli = 0; this.api = 0; this.apiWeb = 0; },
  resetTotals() { this.totals = { subscription: {}, api: {} }; },

  /**
   * 호출 1회의 토큰·비용을 (auth, model) 버킷에 누적한다.
   * usage 키 이름은 CLI(--output-format json)와 Messages API가 동일해 그대로 받는다.
   * @param {'subscription'|'api'} auth
   * @param {{ model?: string, usage?: object, costUsd?: number }} rec
   */
  record(auth, { model = 'unknown', usage = {}, costUsd = 0 } = {}) {
    const models = this.totals[auth];
    if (!models) return;
    const key = model || 'unknown';
    const b = (models[key] ??= emptyBucket());
    b.calls += 1;
    b.in += num(usage.input_tokens);
    b.out += num(usage.output_tokens);
    b.cacheW += num(usage.cache_creation_input_tokens);
    b.cacheR += num(usage.cache_read_input_tokens);
    b.costUsd += num(costUsd);
  },

  /**
   * claude CLI(--output-format json) 응답 1건을 적재한다.
   * modelUsage가 있으면 모델별 정확한 수치를 그대로 쓰고(키 표기가 usage와 달라 정규화),
   * 없을 때만 최상위 usage + 요청 모델로 폴백한다. 둘을 함께 세면 이중 계상이 된다
   * (실측: 최상위 usage == modelUsage 합).
   */
  recordCliResult(parsed, fallbackModel) {
    const mu = parsed?.modelUsage;
    if (mu && typeof mu === 'object' && Object.keys(mu).length) {
      for (const [model, m] of Object.entries(mu)) {
        this.record('subscription', {
          model,
          usage: {
            input_tokens: m?.inputTokens,
            output_tokens: m?.outputTokens,
            cache_creation_input_tokens: m?.cacheCreationInputTokens,
            cache_read_input_tokens: m?.cacheReadInputTokens,
          },
          costUsd: m?.costUSD,
        });
      }
      return true;
    }
    if (parsed?.usage || parsed?.total_cost_usd != null) {
      this.record('subscription', {
        model: fallbackModel,
        usage: parsed.usage,
        costUsd: parsed.total_cost_usd,
      });
      return true;
    }
    return false;
  },

  /**
   * 실패한 CLI 호출의 stdout에서 사용량만 건져 적재한다(방어적 파싱 — 절대 던지지 않는다).
   * 세션 한도로 죽을 때 CLI는 종료코드가 0이 아니면서도 결과 JSON을 stdout에 실어 보내고,
   * 거기 담긴 usage/total_cost_usd는 이미 태운 값이다. 이걸 버리면 정작 "한도에 걸릴 만큼
   * 쓴 날"의 사용량이 통째로 누락된다 — 이 기능이 존재하는 이유가 그 날을 잡는 것이다.
   */
  tryRecordCliStdout(stdout, fallbackModel) {
    try {
      return this.recordCliResult(JSON.parse(String(stdout ?? '')), fallbackModel);
    } catch {
      return false;
    }
  },

  /** 장부 append용 요약 — 호출이 있었던 (auth, 모델)마다 레코드 1줄(없으면 빈 배열). */
  summary() {
    const out = [];
    for (const [auth, models] of Object.entries(this.totals)) {
      for (const [model, b] of Object.entries(models)) {
        if (!b.calls) continue;
        out.push({
          auth,
          model,
          in: b.in, out: b.out, cache_w: b.cacheW, cache_r: b.cacheR,
          // 부동소수 잔재(0.30000000000000004)가 장부에 남지 않게 자른다.
          cost_usd: Number(b.costUsd.toFixed(6)),
          calls: b.calls,
          // 구독 CLI는 비용을 직접 보고하지만 Messages API는 주지 않는다. 토큰은 정확해도
          // 비용이 구조적으로 0이므로 exact로 위장하지 않는다 — 장부가 생긴 계기가 바로
          // API 과금 누수라, 과금된 날을 "정확히 $0"으로 남기는 게 최악의 실패다.
          accuracy: auth === 'api' ? 'approx' : 'exact',
          note: auth === 'api' ? 'cost_usd 0 — Messages API가 비용을 보고하지 않음(토큰은 정확)' : '',
        });
      }
    }
    return out;
  },

  label() {
    const parts = [];
    if (this.cli) parts.push(`구독×${this.cli}`);
    if (this.api) parts.push(`API×${this.api}`);
    return parts.join(' · ') || '—';
  },
};

export class LLMClient {
  constructor({ provider = 'anthropic', model, apiKey } = {}) {
    this.provider = provider;
    this.model = model ?? PROVIDER_DEFAULTS[provider];

    if (provider === 'openai') {
      this._client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
    } else if (provider !== 'anthropic') {
      throw new Error(`Unknown provider: "${provider}". Supported: "anthropic", "openai"`);
    }
    // anthropic: uses claude CLI (subscription) — no API key or SDK client needed
  }

  get label() {
    return `${this.provider}/${this.model}`;
  }

  /**
   * Call the LLM with a single forced tool (structured JSON output).
   *
   * @param {Array}  messages   - Message array [{ role, content }]
   * @param {object} tool       - Anthropic tool def { name, description, input_schema }
   * @param {object} opts
   * @param {number} opts.maxTokens
   * @returns {Promise<object>} - Parsed tool-result JSON
   */
  async callWithTool(messages, tool, { maxTokens = 8192, webSearch = false } = {}) {
    if (this.provider === 'anthropic') {
      // 데스크탑/로컬: claude CLI(구독). CLI가 없는 환경(GitHub Actions 등)에서는
      // ANTHROPIC_API_KEY 가 있으면 Anthropic API 로 폴백.
      try {
        // await 필수 — 없으면 비동기 rejection이 이 catch를 건너뛰어 폴백이 죽는다
        return await this._callClaudeCLI(messages, tool, { webSearch });
      } catch (err) {
        // CLI 미설치뿐 아니라 구독 세션 한도(429)·레이트리밋 등으로 실패해도
        // ANTHROPIC_API_KEY 가 있으면 API 로 폴백한다. 웹검색도 동일하게 유지.
        const cliMissing = /ENOENT|spawn error|command not found|timed out/i.test(err.message);
        const rateLimited = isSessionRateLimit(err.message) || /rate.?limit|overloaded/i.test(err.message);
        if ((cliMissing || rateLimited) && process.env.ANTHROPIC_API_KEY) {
          return this._callAnthropicAPI(messages, tool, maxTokens, { webSearch });
        }
        throw err;
      }
    }
    if (this.provider === 'openai') {
      return this._callOpenAI(messages, tool, maxTokens);
    }
  }

  // ── Anthropic Messages API (구독 CLI 실패 시 폴백) ────────────────────────
  // webSearch=true 이면 서버 web_search 툴을 함께 붙여, 구독 CLI와 동일하게
  // 웹검색 → 최종 구조화 툴 호출까지 다단계로 처리한다(품질 동일 유지).
  async _callAnthropicAPI(messages, tool, maxTokens, { webSearch = false } = {}) {
    const tools = webSearch
      ? [{ type: 'web_search_20260209', name: 'web_search' }, tool]
      : [tool];
    // 웹검색을 쓸 땐 강제(tool_choice=tool) 대신 auto 로 두어, 모델이 먼저 검색한 뒤
    // 마지막에 구조화 툴을 호출하도록 한다.
    const tool_choice = webSearch ? { type: 'auto' } : { type: 'tool', name: tool.name };

    const convo = messages.map((m) => ({ role: m.role, content: m.content }));
    const post = async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS), // TLS 행 → 러너 6시간 킬 방지
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, max_tokens: maxTokens, tools, tool_choice, messages: convo }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      // 응답 1건 = 토큰 1회분. 웹검색 경로는 pause_turn으로 여러 번 도는데, 최종 턴에서만
      // 기록하면 중간 검색 턴의 토큰이 통째로 샌다 — 그래서 여기(모든 응답)에서 누적한다.
      // Messages API는 비용을 돌려주지 않으므로 cost는 0(장부 계약: 없으면 0).
      llmTelemetry.record('api', { model: this.model, usage: data.usage });
      return data;
    };

    // 단순 경로(웹검색 없음): 강제 tool_choice 라 1회로 끝.
    if (!webSearch) {
      const data = await post();
      const toolUse = (data.content ?? []).find((c) => c.type === 'tool_use');
      if (!toolUse) throw new Error('Anthropic API: no tool_use block in response');
      llmTelemetry.api++;
      return toolUse.input;
    }

    // 웹검색 경로: 서버툴 루프(pause_turn) 처리 후 최종 구조화 툴 추출.
    for (let turn = 0; turn < 8; turn++) {
      const data = await post();
      const structured = (data.content ?? []).find((c) => c.type === 'tool_use' && c.name === tool.name);
      if (structured) { llmTelemetry.api++; llmTelemetry.apiWeb++; return structured.input; }

      const usedServerTool = (data.content ?? []).some((c) => c.type === 'server_tool_use');
      if (data.stop_reason === 'pause_turn' || usedServerTool) {
        // 서버 웹검색 진행 중 → assistant 응답을 그대로 실어 재요청(서버가 이어감).
        convo.push({ role: 'assistant', content: data.content });
        continue;
      }
      // 검색은 끝났는데 구조화 툴을 안 불렀으면 명시적으로 요구.
      convo.push({ role: 'assistant', content: data.content });
      convo.push({ role: 'user', content: `Now call the ${tool.name} tool with your final structured result.` });
    }
    throw new Error('Anthropic API: no structured tool_use produced (web-search loop exhausted)');
  }

  async _callClaudeCLI(messages, tool, { webSearch = false } = {}) {
    const userContent = messages
      .map(m => {
        if (typeof m.content === 'string') return m.content;
        if (Array.isArray(m.content)) return m.content.map(c => c.text ?? '').join('\n');
        return '';
      })
      .join('\n\n');

    const schema = JSON.stringify(tool.input_schema, null, 2);
    const fullPrompt = `${userContent}

---
IMPORTANT: ${webSearch
      ? 'You MAY first use the WebSearch/WebFetch tools to research authoritative sources. When done researching, output'
      : 'Respond'} with ONLY a valid JSON object as your FINAL message. No explanation, no markdown code fences, no extra text — just the raw JSON object that matches this schema:

${schema}`;

    // 전문 의료 맥락을 시스템 프롬프트로 명시해 임상 문헌(중독·소생 등)에 대한
    // 안전 필터 오탐(false-positive refusal)을 줄인다.
    const sys = 'You are assisting a board-certified emergency medicine and critical care physician with a routine, legitimate systematic review of peer-reviewed biomedical literature indexed in PubMed. All inputs are public scientific abstracts from medical journals. Provide objective, professional clinical appraisal and the requested structured output. This is standard medical education and research.';

    // ★ 프롬프트를 argv 로 넘기면 리눅스의 **단일 인자 상한(MAX_ARG_STRLEN = 128KB)**에
    //   걸려 `spawn E2BIG` 로 죽는다. 2026-08-14 실측: 논문 120편 rerank 프롬프트가
    //   176,670자였고 그대로 터졌다(20편 29,811자는 통과). 큰 프롬프트는 stdin 으로 넘긴다
    //   — `claude -p` 는 위치 인자가 없으면 stdin 을 읽는다.
    //   데일리(풀 20)는 상한 아래라 종전 argv 경로 그대로다.
    //   ★ 상한은 **바이트**다. `.length` 는 UTF-16 문자 수라 한글이 섞이면 7만 자가
    //   UTF-8 21만 바이트가 돼 임계를 통과해 놓고 그대로 터진다.
    const stdinPrompt = Buffer.byteLength(fullPrompt, 'utf8') > ARGV_PROMPT_LIMIT ? fullPrompt : null;
    const args = stdinPrompt
      ? ['-p', '--output-format', 'json', '--append-system-prompt', sys]
      : ['-p', fullPrompt, '--output-format', 'json', '--append-system-prompt', sys];
    // Pass the configured model through to the CLI so the pipeline actually
    // runs on the requested model (e.g. claude-opus-4-8) instead of the CLI default.
    if (this.model) args.push('--model', this.model);

    // 웹검색 보강(가이드라인 등): 서버 웹툴을 허용하고 멀티턴을 연다.
    // --allowedTools 는 가변 인자라 반드시 args 맨 끝에 둔다.
    // 기본 12턴은 데일리 PICO 폴백 기준(바이트 동일 유지). 열린 웹 탐색(트랙 비교 Arm2 등)은
    // 턴을 많이 먹으므로 LLM_WEB_MAX_TURNS 로 상향할 수 있다(미설정 시 12 그대로).
    if (webSearch) {
      const maxTurns = String(process.env.LLM_WEB_MAX_TURNS || '12');
      args.push('--max-turns', maxTurns, '--allowedTools', 'WebSearch', 'WebFetch');
    }

    // 비동기 spawn — spawnSync는 호출당 최대 8분 이벤트 루프를 얼려
    // 타이머·로그 flush·향후 병렬화를 전부 막는다
    // 웹검색 경로 타임아웃도 상향 가능(턴을 늘리면 더 오래 걸린다). 기본 480s 유지.
    const webTimeoutMs = Number(process.env.LLM_WEB_TIMEOUT_MS) || 480_000;
    const result = await this._spawnClaude(args, webSearch ? webTimeoutMs : 300_000, stdinPrompt);

    if (result.error) throw new Error(`claude CLI spawn error: ${result.error.message}`);
    if (result.timedOut) throw new Error(`claude CLI timed out after ${result.timeoutMs / 1000}s`);
    if (result.status !== 0) {
      // 실패 원인은 stderr가 비어있고 stdout(JSON)에 담기는 경우가 많아 둘 다 노출한다.
      // 그 stdout JSON에는 이미 태운 usage·total_cost_usd가 들어 있으므로, 던지기 전에
      // 먼저 장부에 적재한다(세션 한도로 죽은 날의 사용량이 여기서 새면 안 된다).
      llmTelemetry.tryRecordCliStdout(result.stdout, this.model);
      const err = (result.stderr || '').trim();
      const out = (result.stdout || '').trim();
      const detail = [err && `stderr=${err}`, out && `stdout=${out}`].filter(Boolean).join(' | ').slice(0, 800) || 'no output';
      throw new Error(`claude CLI exited with code ${result.status}: ${detail}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`claude CLI: invalid JSON in stdout: ${result.stdout.slice(0, 300)}`);
    }

    // is_error 응답도 토큰은 실제로 태운 것이므로, 던지기 전에 먼저 적재한다.
    // CLI(--output-format json)는 usage·total_cost_usd·modelUsage를 함께 뱉는다(2026-07-25 실측).
    llmTelemetry.recordCliResult(parsed, this.model);

    if (parsed.is_error) throw new Error(`claude CLI error response: ${parsed.result}`);

    llmTelemetry.cli++;
    return this._extractJSON(parsed.result ?? '');
  }

  _spawnClaude(args, timeoutMs, stdinData = null) {
    return new Promise((resolve) => {
      // 구독 CLI는 CLAUDE_CODE_OAUTH_TOKEN(구독)으로 인증해야 한다. process.env에
      // ANTHROPIC_API_KEY가 남아 있으면 CLI가 구독 대신 그 API 키를 우선 사용해버려,
      // 키가 만료·비활성화면 구독 토큰이 멀쩡해도 401로 죽는다(2026-07-20 데일리 장애).
      // → 자식 CLI 환경에서만 API 키를 제거해 구독 경로를 보장한다. Node 폴백
      // (_callAnthropicAPI)은 process.env를 직접 읽으므로 이 격리와 무관하게 동작한다.
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      const child = spawn('claude', args,
        { stdio: [stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'], env });
      if (stdinData) {
        // EPIPE 로 프로세스를 죽이지 않는다 — CLI 가 먼저 닫으면 그냥 무시하고
        // close 핸들러가 stderr 로 원인을 잡게 둔다.
        child.stdin.on('error', () => {});
        child.stdin.end(stdinData, 'utf8');
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ timedOut: true, timeoutMs, stdout, stderr });
      }, timeoutMs);
      child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
      child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
      child.on('error', (error) => finish({ error }));
      child.on('close', (status) => finish({ status, stdout, stderr }));
    });
  }

  _extractJSON(raw) {
    // Strip markdown code fences if present
    const codeMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeMatch) {
      try { return JSON.parse(codeMatch[1].trim()); } catch {}
    }
    // Try raw JSON parse
    try { return JSON.parse(raw.trim()); } catch {}
    // Find first JSON object or array in the text
    const objMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch) {
      try { return JSON.parse(objMatch[1]); } catch {}
    }
    throw new Error(`LLMClient: could not extract JSON from claude CLI output:\n${raw.slice(0, 400)}`);
  }

  async _callOpenAI(messages, tool, maxTokens) {
    const openaiTool = {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        // Anthropic input_schema is standard JSON Schema — compatible as-is
        parameters: tool.input_schema,
      },
    };

    const response = await this._client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      tools: [openaiTool],
      tool_choice: { type: 'function', function: { name: tool.name } },
      messages,
    });

    const call = response.choices[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error(`${this.label}: no tool_call in response`);
    return JSON.parse(call.function.arguments);
  }
}
