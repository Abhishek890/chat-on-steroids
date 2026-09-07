/**
 * Provider registry for the multi-provider Chat On Steroids.
 *
 * Phase 0: the registry is data-only. The ChatGPT native path is registered as
 * connector #1 and nothing else changes; deleting this module (and its wiring
 * in index.ts) restores the previous wiring byte-for-byte.
 */

import type { ConnectorDescriptor, ProviderManager } from '../../shared/providers.js';
import { logInfo } from '../logger.js';

class ProviderRegistry implements ProviderManager {
  private readonly byId = new Map<string, ConnectorDescriptor>();

  register(descriptor: ConnectorDescriptor): void {
    if (!descriptor || typeof descriptor.id !== 'string' || descriptor.id.length === 0) {
      throw new Error('Connector descriptor requires a non-empty id');
    }
    if (this.byId.has(descriptor.id)) {
      throw new Error(`Connector already registered: ${descriptor.id}`);
    }
    this.byId.set(
      descriptor.id,
      Object.freeze({ ...descriptor, sites: Object.freeze([...descriptor.sites]) })
    );
    logInfo(`connector registered: ${descriptor.id} (${descriptor.transport}/${descriptor.toolProtocol})`);
  }

  get(id: string): ConnectorDescriptor {
    const descriptor = this.byId.get(id);
    if (!descriptor) throw new Error(`Connector not registered: ${id}`);
    return descriptor;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  list(): readonly ConnectorDescriptor[] {
    return [...this.byId.values()];
  }
}

export function createProviderManager(): ProviderManager {
  return new ProviderRegistry();
}

/** The existing ChatGPT Developer-mode path, registered as connector #1. */
export function registerChatgptBrowserConnector(manager: ProviderManager): void {
  manager.register({
    id: 'chatgpt-browser',
    name: 'ChatGPT (native MCP)',
    transport: 'browser',
    toolProtocol: 'native',
    streaming: true,
    multimodal: true,
    attribution: 'request-id',
    modelCatalogHint: null,
    sites: ['chatgpt.com', 'chat.openai.com'],
    enabledByDefault: true
  });
}
