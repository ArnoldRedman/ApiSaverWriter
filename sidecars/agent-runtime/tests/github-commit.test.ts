import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerContentHandlers } from '../src/rpc/content-handlers.js';
import { RpcRegistry } from '../src/rpc/registry.js';

afterEach(() => vi.restoreAllMocks());

describe('GitHub commit description', () => {
  it('summarizes only the program-computed backup changes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      model: 'gpt-test',
      choices: [{ message: { content: JSON.stringify({ title: '新增第三章并修订第一章', body: '新增 1 章，修订 1 章。' }) } }],
    }), { status: 200 }));
    const registry = registerContentHandlers(new RpcRegistry(async request => ({ id: request.id, result: {} })));
    const result = await registry.dispatch({
      id: 1,
      method: 'github.commit.describe',
      params: {
        apiKey: 'key', model: 'gpt-test', projectTitle: '测试小说',
        changes: { addedChapterCount: 1, addedChapters: ['第三章'], modifiedChapterCount: 1, modifiedChapters: ['第一章'] },
        fallbackTitle: '新增 1 章并更新《测试小说》', fallbackBody: '新增章节：第三章\n修改章节：第一章',
      },
    });
    expect(result.result).toEqual({ title: '新增第三章并修订第一章', body: '新增 1 章，修订 1 章。' });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toContain('第三章');
    expect(body.messages[0].content).toContain('第一章');
  });
});
