import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
import { initSessionStore } from '../src/main/session/store.js';
import { createProviderManager } from '../src/main/providers/manager.js';
import { BROWSER_SITES, findBrowserSite, registerBrowserConnectors } from '../src/main/providers/browser-connectors.js';
import { browserToolCatalog, browserInstructions, executeBrowserTool, BROWSER_TRANSPORT_PREFIX } from '../src/main/providers/browser-tools.js';
import { dispatchWithKnownCaller, ok, type ToolResult } from '../src/main/mcp/kernel.js';

let base = '';

function resultText(result: ToolResult): string {
  const item = result.content.find((c): c is { type: 'text'; text: string } => c.type === 'text');
  return item?.text ?? '';
}

beforeAll(async () => {
  // Calling a real tool records it; give the recorder its own directory so the
  // repository is never written into during tests.
  base = await makeTempDir('clf-browser-');
  initSessionStore(base);
});

afterAll(async () => {
  await removeTempDir(base);
});

describe('browser connector registry (Phase 1)', () => {
  it('registers every SuperAssistant site as a disabled prompt connector', () => {
    const manager = createProviderManager();
    registerBrowserConnectors(manager);
    expect(manager.list()).toHaveLength(BROWSER_SITES.length);
    for (const site of BROWSER_SITES) {
      const descriptor = manager.get(site.id);
      expect(descriptor.transport).toBe('browser');
      expect(descriptor.toolProtocol).toBe('prompt');
      expect(descriptor.attribution).toBe('session');
      expect(descriptor.enabledByDefault).toBe(false);
      expect(descriptor.streaming).toBe(true);
      expect(descriptor.sites).toContain(site.hostname);
    }
  });

  it('finds a site by hostname and honours the path filter', () => {
    expect(findBrowserSite('gemini.google.com', '/app')?.id).toBe('browser-gemini');
    expect(findBrowserSite('x.com', '/i/grok')?.id).toBe('browser-grok-x');
    expect(findBrowserSite('x.com', '/home')).toBeNull();
    expect(findBrowserSite('twitter.com', '/i/grok')).toBeNull(); // twitter is intentionally not a Grok connector host
    expect(findBrowserSite('example.com', '/')).toBeNull();
    expect(findBrowserSite('chat.deepseek.com', '/')).toBeTruthy();
  });

  it('has per-site adapter essentials (input selector present where verified)', () => {
    for (const site of BROWSER_SITES) {
      expect(site.hostname.length).toBeGreaterThan(0);
      expect(site.id.startsWith('browser-')).toBe(true);
    }
    const gemini = BROWSER_SITES.find((s) => s.id === 'browser-gemini');
    expect(gemini?.inputSelectors.length).toBeGreaterThan(0);
    const qwen = BROWSER_SITES.find((s) => s.id === 'browser-qwen');
    expect(qwen?.codeMirror).toBe(true);
    const z = BROWSER_SITES.find((s) => s.id === 'browser-z');
    expect(z?.codeMirror).toBe(true);
  });
});

describe('browser tool catalog (Phase 1)', () => {
  it('exposes the same tool list and instructions the ChatGPT connector serves', async () => {
    const catalog = await browserToolCatalog();
    const names = catalog.tools.map((t) => t.name);
    expect(names).toContain('read');
    expect(names).toContain('apply_patch');
    expect(names).toContain('exec_command');
    expect(catalog.instructions).toContain('AVAILABLE TOOLS FOR SUPERASSISTANT');
    expect(catalog.instructions).toContain('{"type":"function_call_start"');
    for (const tool of catalog.tools) {
      expect(catalog.instructions).toContain(` - ${tool.name}`);
    }
  });

  it('builds instructions that include parameter names and required flags', async () => {
    const catalog = await browserToolCatalog();
    const read = catalog.tools.find((t) => t.name === 'read');
    expect(read).toBeTruthy();
    const single = browserInstructions([read!]);
    expect(single).toContain(' - read');
  });

  it('returns a friendly no-tools instruction', () => {
    expect(browserInstructions([])).toContain('No tools available');
  });
});

describe('browser tool execution (Phase 1)', () => {
  it('refuses an unknown tool with a useful error', async () => {
    const result = await executeBrowserTool({
      tool: 'computer',
      args: {},
      conversationId: 'browser-gemini--conv1234567',
      siteId: 'browser-gemini'
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('UNKNOWN_TOOL');
  });

  it('refuses a missing conversation identity', async () => {
    const result = await executeBrowserTool({ tool: 'read', args: {}, conversationId: '', siteId: 'browser-gemini' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('MISSING_CONVERSATION');
  });

  it('refuses a missing tool name', async () => {
    const result = await executeBrowserTool({ tool: '', args: {}, conversationId: 'browser-gemini--conv1234567', siteId: 'browser-gemini' });
    expect(result.isError).toBe(true);
  });

  it('records the browser transport key on the call context', () => {
    expect(BROWSER_TRANSPORT_PREFIX).toBe('browser:');
  });
});

describe('dispatchWithKnownCaller (kernel entry for browser calls)', () => {
  it('runs the handler and returns its result', async () => {
    const result = await dispatchWithKnownCaller('probe', {}, 'browser-gemini--conv1234567', `${BROWSER_TRANSPORT_PREFIX}browser-gemini`, 'core', async () =>
      ok('ran')
    );
    expect(result).toEqual(ok('ran'));
  });

  it('propagates a thrown handler (raw seam, like dispatch)', async () => {
    await expect(
      dispatchWithKnownCaller('probe', {}, 'browser-gemini--conv1234567', `${BROWSER_TRANSPORT_PREFIX}browser-gemini`, 'core', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('passes arguments through to the handler', async () => {
    let seen: unknown = null;
    const result = await dispatchWithKnownCaller('probe', { a: 1 }, 'browser-gemini--conv1234567', `${BROWSER_TRANSPORT_PREFIX}test`, 'core', async (args: unknown) => {
      seen = args;
      return ok('ok');
    });
    expect(result.isError).toBeFalsy();
    expect(seen).toEqual({ a: 1 });
  });

  it('runs a real tool end-to-end through the browser entry (no roots -> refused)', async () => {
    const result = await executeBrowserTool({
      tool: 'read',
      args: { paths: ['/work/file.txt'] },
      conversationId: 'browser-gemini--conv1234567',
      siteId: 'browser-gemini'
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/root|Root/i);
  });
});
