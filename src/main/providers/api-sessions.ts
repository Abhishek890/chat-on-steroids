/**
 * API session manager: owns live API conversations for the IPC/renderer
 * surface. Nothing here touches secrets — the key is resolved at creation and
 * kept inside the session.
 */

import { getSecret } from '../secrets.js';
import { apiProvider } from './api-catalog.js';
import { ApiConversationSession } from './api-transport.js';

export interface ApiSessionSummary {
  readonly sessionId: string;
  readonly providerId: string;
  readonly model: string;
  readonly status: 'idle' | 'busy' | 'closed';
}

export class ApiSessionManager {
  private readonly sessions = new Map<string, ApiConversationSession>();

  /** Creates and stores one session; returns its id, or null when unusable. */
  async create(
    providerId: string,
    model: string,
    options?: { allowWrite?: boolean }
  ): Promise<{ sessionId: string } | null> {
    const provider = apiProvider(providerId);
    if (!provider) throw new Error(`Unknown API provider: ${providerId}`);
    if (provider.toolCall !== 'openai-native') throw new Error(`Provider ${providerId} does not expose OpenAI-shaped tool calls yet.`);
    if (!provider.apiKeySecret) throw new Error(`Provider ${providerId} has no API key slot wired yet.`);
    const key = await getSecret(provider.apiKeySecret as never);
    if (!key) throw new Error(`Add an API key for ${provider.name} in Settings before creating a session.`);
    const session = new ApiConversationSession(providerId, model, key, options);
    this.sessions.set(session.sessionId, session);
    return { sessionId: session.sessionId };
  }

  get(sessionId: string): ApiConversationSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  list(): ApiSessionSummary[] {
    const summaries: ApiSessionSummary[] = [];
    for (const session of this.sessions.values()) {
      summaries.push({
        sessionId: session.sessionId,
        providerId: session.connectorId.replace('api-', ''),
        model: session.model,
        status: session.status()
      });
    }
    return summaries;
  }

  close(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.close();
    this.sessions.delete(sessionId);
    return true;
  }
}
