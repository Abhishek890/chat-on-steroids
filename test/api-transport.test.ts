import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
import { initSessionStore } from '../src/main/session/store.js';
import { initConfigPath } from '../src/main/config.js';
import { createProviderManager } from '../src/main/providers/manager.js';
import { ApiConversationSession, executeApiTool, registerApiConnectors } from '../src/main/providers/api-transport.js';

let base = '';

/** Builds an SSE Response from a list of `data:` payloads (each JSON or '[DONE]'). */
function sseResponse(...payloads: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    }
  });
  return new Response(body, { status: 200 });
}

function deltaRecord(content?: string): string {
  return JSON.stringify({ choices: [{ delta: { content: content ?? undefined } }] });
}

function toolCallRecord(name: string, args: string): string {
  return JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: args } }] } }]
  });
}

beforeAll(async () => {
  base = await makeTempDir('clf-api-');
  initSessionStore(base);
  initConfigPath(base);
});

afterAll(async () => {
  await removeTempDir(base);
});

describe('OpenRouter API connector registration (Phase 3)', () => {
  it('registers api-openrouter as a disabled native-tool api connector', () => {
    const manager = createProviderManager();
    registerApiConnectors(manager);
    const descriptor = manager.get('api-openrouter');
    expect(descriptor.transport).toBe('api');
    expect(descriptor.toolProtocol).toBe('native');
    expect(descriptor.attribution).toBe('session');
    expect(descriptor.streaming).toBe(true);
    expect(descriptor.multimodal).toBe(true);
    expect(descriptor.enabledByDefault).toBe(false);
    expect(descriptor.modelCatalogHint).toBe('openrouter');
  });
});

describe('ApiConversationSession (Phase 3)', () => {
  it('streams a plain text completion and closes the turn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(deltaRecord('Hello'), deltaRecord(' world'), '[DONE]'));
    vi.stubGlobal('fetch', fetchMock);

    const session = new ApiConversationSession('openrouter', 'test-model', 'test-key');
    const events: Array<[string, unknown]> = [];
    session.stream((event) => events.push([event.kind, event]));
    const receipt = await session.sendUserTurn({ text: 'Hi' });

    expect(receipt.state).toBe('sent');
    const tokens = events.filter(([kind]) => kind === 'token').map(([, event]) => (event as { text: string }).text);
    expect(tokens.join('')).toBe('Hello world');
    expect(events.some(([kind]) => kind === 'boundary')).toBe(true);
    expect(session.status()).toBe('idle');
    // The request carried the tool list.
    const init = fetchMock.mock.calls[0]?.[1] as { body: string } | undefined;
    const body = JSON.parse(init?.body ?? '{}');
    expect(body.model).toBe('test-model');
    expect(body.stream).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'read')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('runs a native tool call through the kernel and continues the turn', async () => {
    let calls = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          // First request: the model emits a tool call for read (no roots -> refused cleanly).
          return sseResponse(toolCallRecord('read', JSON.stringify({ paths: ['/nonexistent/x.txt'] })), '[DONE]');
        }
        return sseResponse(deltaRecord('Done after tool.'), '[DONE]');
      });
    vi.stubGlobal('fetch', fetchMock);

    const session = new ApiConversationSession('openrouter', 'test-model', 'test-key');
    const events: Array<[string, unknown]> = [];
    session.stream((event) => events.push([event.kind, event]));
    const receipt = await session.sendUserTurn({ text: 'Read a file, then tell me.' });

    expect(receipt.state).toBe('sent');
    expect(events.some(([kind, event]) => kind === 'tool-call' && (event as { name: string }).name === 'read')).toBe(true);
    expect(events.some(([kind]) => kind === 'tool-result')).toBe(true);
    const tokens = events.filter(([kind]) => kind === 'token').map(([, event]) => (event as { text: string }).text);
    expect(tokens.join('')).toBe('Done after tool.');
    // Two API requests: the initial one and the continuation after the tool result.
    expect(fetchMock.mock.calls.length).toBe(2);
    vi.unstubAllGlobals();
  });

  it('fails cleanly when there is no API key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const session = new ApiConversationSession('openrouter', 'test-model', null);
    const receipt = await session.sendUserTurn({ text: 'Hi' });
    expect(receipt.state).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('executeApiTool (Phase 3)', () => {
  it('refuses an unknown tool with a useful error', async () => {
    const result = await executeApiTool('computer', {}, 'conv1234567', 'openrouter', true);
    expect(result.isError).toBe(true);
  });

  it('runs a known tool through the kernel (no roots -> refused cleanly)', async () => {
    const result = await executeApiTool('read', { paths: ['/nonexistent/x.txt'] }, 'conv1234567', 'openrouter', true);
    expect(result.isError).toBe(true);
  });
});
