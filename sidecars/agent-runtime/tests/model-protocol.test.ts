import { describe, expect, it } from 'vitest';
import { anthropicText, anthropicThinkingBudget, authHeaders, normalizeWireMode, openAIReasoningEffort, toAnthropicMessages } from '@apisaverwriter/model-protocol';

describe('shared model protocol', () => {
  it('normalizes wire mode and authentication consistently', () => {
    expect(normalizeWireMode('anthropic')).toBe('anthropic');
    expect(normalizeWireMode('responses')).toBe('openai');
    expect(authHeaders('key', 'openai')).toEqual({ Authorization: 'Bearer key' });
    expect(authHeaders('key', 'anthropic')).toMatchObject({ 'x-api-key': 'key', 'anthropic-version': '2023-06-01' });
  });

  it('promotes system messages and keeps thinking out of prose', () => {
    const result = toAnthropicMessages([
      { role: 'system', content: '规则一' },
      { role: 'system', content: '规则二' },
      { role: 'assistant', content: '旧回复' },
      { role: 'user', content: '继续' },
    ]);
    expect(result.system).toBe('规则一\n\n规则二');
    expect(result.turns[0].role).toBe('user');
    expect(anthropicText([{ type: 'thinking', thinking: '隐藏' }, { type: 'text', text: '正文' }])).toBe('正文');
  });

  it('owns the shared reasoning policies', () => {
    expect(openAIReasoningEffort.max).toBe('high');
    expect(anthropicThinkingBudget.max).toBe(24576);
  });
});
