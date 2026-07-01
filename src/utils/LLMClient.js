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
  async callWithTool(messages, tool, { maxTokens = 8192 } = {}) {
    if (this.provider === 'anthropic') {
      // 데스크탑/로컬: claude CLI(구독). CLI가 없는 환경(GitHub Actions 등)에서는
      // ANTHROPIC_API_KEY 가 있으면 Anthropic API 로 폴백.
      try {
        return this._callClaudeCLI(messages, tool);
      } catch (err) {
        const cliMissing = /ENOENT|spawn error/i.test(err.message);
        if (cliMissing && process.env.ANTHROPIC_API_KEY) {
          return this._callAnthropicAPI(messages, tool, maxTokens);
        }
        throw err;
      }
    }
    if (this.provider === 'openai') {
      return this._callOpenAI(messages, tool, maxTokens);
    }
  }

  // ── Anthropic Messages API (CLI 미존재 환경 폴백) ─────────────────────────
  async _callAnthropicAPI(messages, tool, maxTokens) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const toolUse = (data.content ?? []).find((c) => c.type === 'tool_use');
    if (!toolUse) throw new Error(`Anthropic API: no tool_use block in response`);
    return toolUse.input;
  }

  _callClaudeCLI(messages, tool) {
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
IMPORTANT: Respond with ONLY a valid JSON object. No explanation, no markdown code fences, no extra text — just the raw JSON object that matches this schema:

${schema}`;

    // 전문 의료 맥락을 시스템 프롬프트로 명시해 임상 문헌(중독·소생 등)에 대한
    // 안전 필터 오탐(false-positive refusal)을 줄인다.
    const sys = 'You are assisting a board-certified emergency medicine and critical care physician with a routine, legitimate systematic review of peer-reviewed biomedical literature indexed in PubMed. All inputs are public scientific abstracts from medical journals. Provide objective, professional clinical appraisal and the requested structured output. This is standard medical education and research.';

    const args = ['-p', fullPrompt, '--output-format', 'json', '--append-system-prompt', sys];
    // Pass the configured model through to the CLI so the pipeline actually
    // runs on the requested model (e.g. claude-opus-4-8) instead of the CLI default.
    if (this.model) args.push('--model', this.model);

    const result = spawnSync('claude', args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 300_000,
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
