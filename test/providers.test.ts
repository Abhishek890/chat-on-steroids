import { describe, expect, it } from 'vitest';
import type { ConnectorDescriptor } from '../src/shared/providers.js';
import { createProviderManager, registerChatgptBrowserConnector } from '../src/main/providers/manager.js';

describe('provider manager (Phase 0 registry)', () => {
  it('starts empty', () => {
    const manager = createProviderManager();
    expect(manager.list()).toEqual([]);
    expect(manager.has('chatgpt-browser')).toBe(false);
  });

  it('registers the ChatGPT native connector as number 1', () => {
    const manager = createProviderManager();
    registerChatgptBrowserConnector(manager);
    const chatgpt = manager.get('chatgpt-browser');
    expect(chatgpt.transport).toBe('browser');
    expect(chatgpt.toolProtocol).toBe('native');
    expect(chatgpt.attribution).toBe('request-id');
    expect(chatgpt.streaming).toBe(true);
    expect(chatgpt.multimodal).toBe(true);
    expect(chatgpt.enabledByDefault).toBe(true);
    expect(chatgpt.sites).toContain('chatgpt.com');
    expect(manager.list()).toHaveLength(1);
  });

  it('rejects duplicate registration', () => {
    const manager = createProviderManager();
    registerChatgptBrowserConnector(manager);
    expect(() => registerChatgptBrowserConnector(manager)).toThrow(/already registered/);
  });

  it('rejects an invalid descriptor', () => {
    const manager = createProviderManager();
    expect(() => manager.register({ id: '' } as unknown as ConnectorDescriptor)).toThrow(/non-empty id/);
  });

  it('returns immutable snapshots', () => {
    const manager = createProviderManager();
    registerChatgptBrowserConnector(manager);
    const listed = manager.list();
    (listed as ConnectorDescriptor[]).push({} as ConnectorDescriptor);
    expect(manager.list()).toHaveLength(1);
    const chatgpt = manager.get('chatgpt-browser');
    expect(() => {
      (chatgpt as { name: string }).name = 'changed';
    }).toThrow();
  });

  it('throws for an unknown connector', () => {
    const manager = createProviderManager();
    expect(() => manager.get('nope')).toThrow(/not registered/);
  });
});
