import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
const secretStore = vi.hoisted(() => new Map<string, string | null>([['openRouterApiKey', 'test-openrouter-key']]));
vi.mock('../src/main/secrets.js', () => ({
  getSecret: async (key: string) => secretStore.get(key) ?? null
}));
import { initSessionStore } from '../src/main/session/store.js';
import { initConfigPath } from '../src/main/config.js';
import { API_PROVIDERS, apiProvider, toolAllowlistAllows, apiConnectorInfo } from '../src/main/providers/api-catalog.js';
import { ApiConversationSession, executeApiTool } from '../src/main/providers/api-transport.js';
import { ApiSessionManager } from '../src/main/providers/api-sessions.js';

let base = '';

function sseResponse(...payloads: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      controller.close();
    }
  });
  return new Response(body, { status: 200 });
}

function deltaRecord(content?: string): string {
  return JSON.stringify({ choices: [{ delta: { content: content ?? undefined } }] });
}

function usageRecord(): string {
  return JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
}

beforeAll(async () => {
  base = await makeTempDir('clf-api3-');
  initSessionStore(base);
  initConfigPath(base);

});

afterAll(async () => {
  await removeTempDir(base);
});

describe('API provider catalog (Phase 3)', () => {
  it('covers the OpenAI-compatible family plus Gemini, with honest tool-call flags', () => {
    const ids = API_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('openrouter');
    expect(ids).toContain('deepseek');
    expect(ids).toContain('moonshot');
    expect(ids).toContain('zhipu');
    expect(ids).toContain('qwen');
    expect(ids).toContain('gemini');
    expect(apiProvider('openrouter')?.toolCall).toBe('openai-native');
    expect(apiProvider('gemini')?.toolCall).toBe('unsupported-shape');
    expect(apiProvider('gemini')?.openaiCompatible).toBe(false);
  });

  it('only OpenRouter has a wired key slot today', async () => {
    const infos = await apiConnectorInfo();
    const openrouter = infos.find((i) => i.id === 'openrouter');
    expect(openrouter?.hasKey).toBe(true);
    for (const info of infos) {
      if (info.id !== 'openrouter') expect(info.hasKey).toBe(false);
    }
  });

  it('applies the tool-model allowlist and write-tools default', () => {
    const openrouter = apiProvider('openrouter')!;
    expect(toolAllowlistAllows(openrouter, 'any-model')).toBe(true); // empty allowlist = all
    // The design: API connectors ship read-only; write access is a
    // per-session opt-in, so the catalog default is false for every provider.
    expect(openrouter.writeToolsDefault).toBe(false);
    for (const provider of API_PROVIDERS) expect(provider.writeToolsDefault).toBe(false);
    const gated = { ...openrouter, toolModels: ['gpt-5.6-sol'] };
    expect(toolAllowlistAllows(gated, 'gpt-5.6-sol')).toBe(true);
    expect(toolAllowlistAllows(gated, 'other')).toBe(false);
  });
});

describe('API transport guardrails (Phase 3)', () => {
  it('refuses write tools before the kernel when not opted in', async () => {
    const result = await executeApiTool('apply_patch', {}, 'conv1234567', 'api-openrouter', false);
    expect(result.isError).toBe(true);
    const text = result.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ?? '';
    expect(text).toContain('WRITE_TOOLS_DISABLED');
  });

  it('allows write tools when opted in (kernel still enforces permissions)', async () => {
    const result = await executeApiTool('apply_patch', {}, 'conv1234567', 'api-openrouter', true);
    // No roots -> the kernel refuses, but not with WRITE_TOOLS_DISABLED.
    const text = result.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ?? '';
    expect(text).not.toContain('WRITE_TOOLS_DISABLED');
  });

  it('omits tool definitions when the model is outside the allowlist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(deltaRecord('hi'), '[DONE]'));
    vi.stubGlobal('fetch', fetchMock);
    const session = new ApiConversationSession('openrouter', 'other-model', 'key', {
      allowWrite: false,
      toolModelsAllowlist: ['gpt-5.6-sol']
    });
    await session.sendUserTurn({ text: 'hi' });
    const init = fetchMock.mock.calls[0]?.[1] as { body: string } | undefined;
    const body = JSON.parse(init?.body ?? '{}');
    expect(body.tools).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('captures usage from the final chunk', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(deltaRecord('done'), usageRecord(), '[DONE]'));
    vi.stubGlobal('fetch', fetchMock);
    const session = new ApiConversationSession('openrouter', 'model', 'key');
    await session.sendUserTurn({ text: 'hi' });
    expect(session.usage()).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    vi.unstubAllGlobals();
  });
});

describe('API session manager (Phase 3)', () => {
  it('creates, lists and closes a session using the configured key', async () => {
    const manager = new ApiSessionManager();
    const created = await manager.create('openrouter', 'test-model');
    expect(created).not.toBeNull();
    const sessionId = created!.sessionId;
    expect(manager.get(sessionId)).not.toBeNull();
    expect(manager.list().some((s) => s.sessionId === sessionId)).toBe(true);
    expect(manager.close(sessionId)).toBe(true);
    expect(manager.get(sessionId)).toBeNull();
  });

  it('refuses a provider without a wired key slot', async () => {
    const manager = new ApiSessionManager();
    await expect(manager.create('deepseek', 'deepseek-chat')).rejects.toThrow(/no API key slot/);
  });
});
