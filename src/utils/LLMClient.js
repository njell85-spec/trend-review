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
      return this._callClaudeCLI(messages, tool);
    }
    if (this.provider === 'openai') {
      return this._callOpenAI(messages, tool, maxTokens);
    }
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

    const args = ['-p', fullPrompt, '--output-format', 'json'];
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
      const errMsg = result.stderr?.slice(0, 500) ?? 'unknown error';
      throw new Error(`claude CLI exited with code ${result.status}: ${errMsg}`);
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
