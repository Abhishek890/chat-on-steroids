import { afterEach, describe, expect, it } from 'vitest';
import {
  anyChatBlocked,
  isChatBlocked,
  resetBlockedChatsForTests,
  setConnectorChatBlocked
} from '../src/main/session/blocked-chats.js';

describe('connector-scoped blocked chats (Phase 2)', () => {
  afterEach(() => resetBlockedChatsForTests());

  it('blocks and releases a connector-scoped conversation', () => {
    const key = 'browser-gemini--conv1234';
    setConnectorChatBlocked(key, true);
    expect(isChatBlocked(key)).toBe(true);
    expect(anyChatBlocked()).toBe(true);
    setConnectorChatBlocked(key, false);
    expect(isChatBlocked(key)).toBe(false);
  });

  it('is idempotent in both directions', () => {
    const key = 'browser-kimi--abc12345';
    setConnectorChatBlocked(key, true);
    setConnectorChatBlocked(key, true);
    expect(isChatBlocked(key)).toBe(true);
    setConnectorChatBlocked(key, false);
    setConnectorChatBlocked(key, false);
    expect(isChatBlocked(key)).toBe(false);
  });

  it('rejects malformed keys and never blocks through a wrong-shaped key', () => {
    expect(() => setConnectorChatBlocked('no-separator', true)).toThrow();
    expect(() => setConnectorChatBlocked('bad key:seg!', true)).toThrow();
    expect(() => setConnectorChatBlocked('site:ab', true)).toThrow(); // segment too short
    expect(isChatBlocked('no-separator')).toBe(false);
  });

  it('keeps ChatGPT ids and connector keys in one store without collision', () => {
    setConnectorChatBlocked('browser-z--conv1234', true);
    expect(isChatBlocked('browser-z--conv1234')).toBe(true);
    expect(isChatBlocked('conv1234')).toBe(false);
  });
});
