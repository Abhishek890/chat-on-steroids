import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
import { initSessionStore, findSessionByConversation } from '../src/main/session/store.js';
import { flushRecorder } from '../src/main/session/recorder.js';
import { browserEnablement, browserHealthProbe } from '../src/main/providers/browser-connectors.js';
import { executeBrowserTool } from '../src/main/providers/browser-tools.js';
import { defaultConfig, updateConfig, getConfig, initConfigPath } from '../src/main/config.js';

let base = '';

beforeAll(async () => {
  base = await makeTempDir('clf-phase2-');
  initSessionStore(base);
  initConfigPath(base);
});

afterAll(async () => {
  await removeTempDir(base);
});

describe('app-owned browser-connector enablement (Phase 2)', () => {
  it('defaults every site to disabled', () => {
    const enablement = browserEnablement(defaultConfig());
    expect(Object.values(enablement.enabled).every((value) => value === false)).toBe(true);
    expect(enablement.autoExecute).toBe(false);
    expect(enablement.autoSubmit).toBe(false);
    expect(enablement.sites).toContain('browser-gemini');
    expect(enablement.sites).toContain('browser-deepseek');
  });

  it('round-trips through updateConfig', async () => {
    await updateConfig((previous) => ({
      ...previous,
      browserConnectors: {
        enabled: { 'browser-gemini': true, 'browser-kimi': true },
        autoExecute: true,
        autoSubmit: false
      }
    }));
    const live = browserEnablement(getConfig());
    expect(live.enabled['browser-gemini']).toBe(true);
    expect(live.enabled['browser-kimi']).toBe(true);
    expect(live.enabled['browser-z']).toBe(false);
    expect(live.autoExecute).toBe(true);
    expect(live.autoSubmit).toBe(false);
    // The projection is config-shaped: unknown site ids never enter the map.
    const projection = browserEnablement({
      browserConnectors: { enabled: { 'browser-gemini': true, nope: true }, autoExecute: false, autoSubmit: false }
    });
    expect(projection.enabled['nope']).toBeUndefined();
    expect(Object.keys(projection.enabled)).not.toContain('nope');
  });
});

describe('browser connector health probe (Phase 2)', () => {
  it('reports every site with selector counts and roots/readOnly state', () => {
    const probe = browserHealthProbe({
      browserConnectors: defaultConfig().browserConnectors,
      roots: [{ name: 'work', path: '/tmp/work' }],
      readOnly: false
    });
    expect(probe.rootsApproved).toBe(1);
    expect(probe.readOnly).toBe(false);
    const gemini = probe.sites.find((site) => site.id === 'browser-gemini');
    expect(gemini?.enabled).toBe(false);
    expect(gemini?.inputSelectors ?? 0).toBeGreaterThan(0);
    const qwen = probe.sites.find((site) => site.id === 'browser-qwen');
    expect(qwen?.codeMirror).toBe(true);
    const z = probe.sites.find((site) => site.id === 'browser-z');
    expect(z?.codeMirror).toBe(true);
  });
});

describe('browser tool calls record into connector-scoped sessions (Phase 2)', () => {
  it('files a browser tool call under its session when recording is on', async () => {
    const conversationId = 'browser-gemini--conv1234567';
    await executeBrowserTool({
      tool: 'read',
      args: { paths: ['/unapproved/file.txt'] },
      conversationId,
      siteId: 'browser-gemini'
    });
    await flushRecorder();
    const session = await findSessionByConversation(conversationId);
    expect(session).toBeTruthy();
  });

  it('does not record when the conversation key is malformed', async () => {
    const conversationId = 'browser-gemini:bad/key!';
    await executeBrowserTool({
      tool: 'read',
      args: { paths: ['/x'] },
      conversationId,
      siteId: 'browser-gemini'
    });
    const session = await findSessionByConversation(conversationId);
    expect(session).toBeNull();
  });
});
