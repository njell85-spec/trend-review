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
import { spawnSync } from 'child_process';
import OpenAI from 'openai';

export const PROVIDER_DEFAULTS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
};

// 실행 경로 집계(그날 구독 CLI로 돌았는지 / API 폴백으로 넘어갔는지).
// 프로세스 전역 카운터 — 오케스트레이터가 run() 시작 시 reset().
export const llmTelemetry = {
  cli: 0, api: 0, apiWeb: 0,
  reset() { this.cli = 0; this.api = 0; this.apiWeb = 0; },
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
        return this._callClaudeCLI(messages, tool, { webSearch });
      } catch (err) {
        // CLI 미설치뿐 아니라 구독 세션 한도(429)·레이트리밋 등으로 실패해도
        // ANTHROPIC_API_KEY 가 있으면 API 로 폴백한다. 웹검색도 동일하게 유지.
        const cliMissing = /ENOENT|spawn error|command not found/i.test(err.message);
        const rateLimited = /session limit|"?api_error_status"?\s*[:=]\s*429|(?:^|[^\d])429(?:[^\d]|$)|rate.?limit|overloaded/i.test(err.message);
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
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, max_tokens: maxTokens, tools, tool_choice, messages: convo }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res.json();
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

  _callClaudeCLI(messages, tool, { webSearch = false } = {}) {
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

    const args = ['-p', fullPrompt, '--output-format', 'json', '--append-system-prompt', sys];
    // Pass the configured model through to the CLI so the pipeline actually
    // runs on the requested model (e.g. claude-opus-4-8) instead of the CLI default.
    if (this.model) args.push('--model', this.model);

    // 웹검색 보강(가이드라인 등): 서버 웹툴을 허용하고 멀티턴을 연다.
    // --allowedTools 는 가변 인자라 반드시 args 맨 끝에 둔다.
    if (webSearch) {
      args.push('--max-turns', '12', '--allowedTools', 'WebSearch', 'WebFetch');
    }

    const result = spawnSync('claude', args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: webSearch ? 480_000 : 300_000,
    });

    if (result.error) throw new Error(`claude CLI spawn error: ${result.error.message}`);
    if (result.status !== 0) {
      // 실패 원인은 stderr가 비어있고 stdout(JSON)에 담기는 경우가 많아 둘 다 노출한다.
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

    if (parsed.is_error) throw new Error(`claude CLI error response: ${parsed.result}`);

    llmTelemetry.cli++;
    return this._extractJSON(parsed.result ?? '');
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
