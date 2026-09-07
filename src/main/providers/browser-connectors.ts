/**
 * Browser-connector sites: the AI websites MCP-SuperAssistant already supports,
 * ported into Chat On Steroids as prompt-protocol connectors.
 *
 * Selectors below are taken from the MCP-SuperAssistant audit
 * (pages/content/src/plugins/adapters/*.adapter.ts and
 * render_prescript/src/core/config.ts WEBSITE_CONFIGS) and are the known-good
 * starting points for each site. They rot with site redesigns; the Phase 1
 * health probe is what is supposed to catch that.
 */

import type { ConnectorDescriptor, ProviderManager } from '../../shared/providers.js';

export interface BrowserSiteConfig {
  /** Connector id, e.g. "browser-gemini". */
  readonly id: string;
  /** Display name, e.g. "Gemini (browser)". */
  readonly name: string;
  /** Substring matched against window.location.hostname. */
  readonly hostname: string;
  /** Optional path filter; when present the connector only activates on it. */
  readonly pathPattern?: RegExp;
  readonly inputSelectors: readonly string[];
  readonly submitSelectors: readonly string[];
  /** Result anchor for the site's user messages; null while unverified. */
  readonly resultAnchor: string | null;
  /** Whether the site needs the CodeMirror content accessor. */
  readonly codeMirror: boolean;
}

/**
 * selectors[].input and selectors[].submit may both be empty: the runtime falls
 * back to a generic contenteditable/textarea picker and any send button, so a
 * site with unverified selectors still functions, just less precisely.
 */
export const BROWSER_SITES: readonly BrowserSiteConfig[] = [
  {
    id: 'browser-gemini',
    name: 'Gemini (browser)',
    hostname: 'gemini.google.com',
    inputSelectors: ['div.ql-editor.textarea.new-input-ui p', '.ql-editor p', 'div[contenteditable="true"]'],
    submitSelectors: ['button.mat-mdc-icon-button.send-button', 'button[aria-label*="Send"]'],
    resultAnchor: 'div.query-content',
    codeMirror: false
  },
  {
    id: 'browser-perplexity',
    name: 'Perplexity (browser)',
    hostname: 'perplexity.ai',
    inputSelectors: ['#ask-input[contenteditable="true"]', '#ask-input[role="textbox"]', 'div[contenteditable="true"][data-lexical-editor="true"]'],
    submitSelectors: ['button[aria-label="Submit"]', 'button[aria-label="Send"]'],
    resultAnchor: 'div.group\\/query',
    codeMirror: false
  },
  {
    id: 'browser-grok',
    name: 'Grok (browser)',
    hostname: 'grok.com',
    pathPattern: /^[^?]*/,
    inputSelectors: ['textarea', 'div[contenteditable="true"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'button.send-button', 'svg.send-icon'],
    resultAnchor: 'div.relative.items-end',
    codeMirror: false
  },
  {
    id: 'browser-grok-x',
    name: 'Grok on X (browser)',
    hostname: 'x.com',
    pathPattern: /\/i\/grok/,
    inputSelectors: ['textarea', 'div[contenteditable="true"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'button.send-button', 'svg.send-icon'],
    resultAnchor: 'div.relative.items-end',
    codeMirror: false
  },
  {
    id: 'browser-aistudio',
    name: 'Google AI Studio (browser)',
    hostname: 'aistudio.google.com',
    inputSelectors: ['textarea', 'div[contenteditable="true"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'button[aria-label*="Run"]'],
    resultAnchor: 'ms-text-chunk.ng-star-inserted',
    codeMirror: false
  },
  {
    id: 'browser-openrouter',
    name: 'OpenRouter Chat (browser)',
    hostname: 'openrouter.ai',
    inputSelectors: ['textarea[data-testid="composer-input"]', 'textarea[placeholder="Start a new message..."]', 'div[contenteditable="true"]'],
    submitSelectors: ['button[data-testid="send-button"]', 'button[aria-label="Send message"]'],
    resultAnchor: 'div[data-testid="user-message"]',
    codeMirror: false
  },
  {
    id: 'browser-deepseek',
    name: 'DeepSeek (browser)',
    hostname: 'chat.deepseek.com',
    inputSelectors: ['textarea[spellcheck="false"]', 'textarea.chat-input', 'div[contenteditable="true"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'button[data-testid="send-button"]', 'button.send-button'],
    resultAnchor: 'div._9663006',
    codeMirror: false
  },
  {
    id: 'browser-t3chat',
    name: 'T3 Chat (browser)',
    hostname: 't3.chat',
    inputSelectors: ['textarea', 'input[type="text"]', 'div[contenteditable="true"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'button[type="submit"]'],
    resultAnchor: 'div[aria-label="Your message"]',
    codeMirror: false
  },
  {
    id: 'browser-copilot',
    name: 'GitHub Copilot (browser)',
    hostname: 'github.com',
    pathPattern: /\/(copilot|settings\/copilot)/,
    inputSelectors: ['textarea', 'div[contenteditable="true"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'button[type="submit"]'],
    resultAnchor: '.UserMessage-module__container--cAvvK',
    codeMirror: false
  },
  {
    id: 'browser-mistral',
    name: 'Mistral (browser)',
    hostname: 'chat.mistral.ai',
    inputSelectors: ['textarea', 'div[contenteditable="true"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'svg.send-icon'],
    resultAnchor: 'div[data-message-part-type="answer"]',
    codeMirror: false
  },
  {
    id: 'browser-kimi',
    name: 'Kimi (browser)',
    hostname: 'kimi.com',
    inputSelectors: ['.chat-input-editor[contenteditable="true"]', 'div[contenteditable="true"][data-lexical-editor="true"]', '.chat-input-editor'],
    submitSelectors: ['.send-button', 'button[aria-label*="Send"]', 'svg.send-icon'],
    resultAnchor: 'div[class*="user-content"]',
    codeMirror: false
  },
  {
    id: 'browser-qwen',
    name: 'Qwen Chat (browser)',
    hostname: 'chat.qwen.ai',
    inputSelectors: ['textarea.message-input-textarea', '#chat-input', 'textarea.chat-input'],
    submitSelectors: ['button.omni-button-content-btn', 'button.send-button', 'div.chat-prompt-send-button button'],
    resultAnchor: '.user-message-text-content',
    codeMirror: true
  },
  {
    id: 'browser-z',
    name: 'Z Chat / GLM (browser)',
    hostname: 'chat.z.ai',
    inputSelectors: ['#chat-input'],
    submitSelectors: ['#send-message-button', '#send-message-button[type="submit"]'],
    resultAnchor: 'div.chat-user',
    codeMirror: true
  }
];

/**
 * Browser connectors ship disabled: they rely on the SA-style prompt protocol,
 * which ties them to page parsing. The ChatGPT native path is unaffected.
 */
export function registerBrowserConnectors(manager: ProviderManager): void {
  for (const site of BROWSER_SITES) {
    const descriptor: ConnectorDescriptor = {
      id: site.id,
      name: site.name,
      transport: 'browser',
      toolProtocol: 'prompt',
      streaming: true,
      multimodal: false,
      attribution: 'session',
      modelCatalogHint: null,
      sites: [site.hostname],
      enabledByDefault: false
    };
    manager.register(descriptor);
  }
}

/**
 * App-owned enablement for the browser connectors.
 *
 * Reads the config section; sites default to disabled. The extension
 * background forwards these to /browser/settings on the bridge, so the app
 * is the single owner of the switches (the content script still consults its
 * own storage only as an offline fallback when the app is unreachable).
 */
export function browserEnablement(config: {
  browserConnectors?: { enabled?: Record<string, boolean>; autoExecute?: boolean; autoSubmit?: boolean };
}): { enabled: Record<string, boolean>; autoExecute: boolean; autoSubmit: boolean; sites: string[] } {
  const section = config.browserConnectors ?? {};
  const enabled: Record<string, boolean> = {};
  for (const site of BROWSER_SITES) enabled[site.id] = section.enabled?.[site.id] === true;
  return {
    enabled,
    autoExecute: section.autoExecute === true,
    autoSubmit: section.autoSubmit === true,
    sites: BROWSER_SITES.map((site) => site.id)
  };
}

/**
 * Setup/health picture for the browser connectors: what each site expects,
 * whether the app is ready to serve it, and whether the connector is on.
 */
export function browserHealthProbe(config: {
  browserConnectors?: { enabled?: Record<string, boolean> };
  roots: unknown[];
  readOnly: boolean;
}): {
  readOnly: boolean;
  rootsApproved: number;
  sites: Array<{ id: string; name: string; enabled: boolean; inputSelectors: number; submitSelectors: number; codeMirror: boolean }>;
} {
  const enablement = config.browserConnectors?.enabled ?? {};
  return {
    readOnly: config.readOnly,
    rootsApproved: Array.isArray(config.roots) ? config.roots.length : 0,
    sites: BROWSER_SITES.map((site) => ({
      id: site.id,
      name: site.name,
      enabled: enablement[site.id] === true,
      inputSelectors: site.inputSelectors.length,
      submitSelectors: site.submitSelectors.length,
      codeMirror: site.codeMirror
    }))
  };
}

export function findBrowserSite(hostname: string, path: string): BrowserSiteConfig | null {
  for (const site of BROWSER_SITES) {
    if (!hostname.includes(site.hostname)) continue;
    if (site.pathPattern && !site.pathPattern.test(path)) continue;
    return site;
  }
  return null;
}
