/**
 * LLMClient — provider-agnostic wrapper for Anthropic and OpenAI tool-use calls.
 *
 * Accepts Anthropic-style tool definitions ({ name, description, input_schema })
 * and transparently translates them to OpenAI function-calling format.
 * Returns the parsed tool-result object from either provider.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const PROVIDER_DEFAULTS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
};

export class LLMClient {
  constructor({ provider = 'anthropic', model, apiKey } = {}) {
    this.provider = provider;
    this.model = model ?? PROVIDER_DEFAULTS[provider];

    if (provider === 'anthropic') {
      this._client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
    } else if (provider === 'openai') {
      this._client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
    } else {
      throw new Error(`Unknown provider: "${provider}". Supported: "anthropic", "openai"`);
    }
  }

  get label() {
    return `${this.provider}/${this.model}`;
  }

  /**
   * Call the LLM with a single forced tool.
   *
   * @param {Array}  messages   - OpenAI/Anthropic-style message array
   * @param {object} tool       - Anthropic tool def { name, description, input_schema }
   * @param {object} opts
   * @param {number} opts.maxTokens
   * @returns {Promise<object>} - Parsed tool-result JSON
   */
  async callWithTool(messages, tool, { maxTokens = 8192 } = {}) {
    if (this.provider === 'anthropic') {
      return this._callAnthropic(messages, tool, maxTokens);
    }
    if (this.provider === 'openai') {
      return this._callOpenAI(messages, tool, maxTokens);
    }
  }

  async _callAnthropic(messages, tool, maxTokens) {
    const response = await this._client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages,
    });
    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block) throw new Error(`${this.label}: no tool_use block in response`);
    return block.input;
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
