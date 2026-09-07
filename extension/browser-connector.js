/**
 * Chat On Steroids — browser connector content script (Phase 1).
 *
 * Runs on the MCP-SuperAssistant sites (everything except ChatGPT). It is
 * disabled by default per site: nothing runs until the user enables the site
 * under chrome.storage.local["cosBrowserConnectors"][siteId].
 *
 * Flow (the SuperAssistant model, wired to the CoS kernel):
 *   1. User clicks the floating MCP button -> instructions (from CoS
 *      /browser/catalog) are typed into the chat input.
 *   2. A MutationObserver watches pre/code blocks for the JSONL prompt-protocol
 *      tool calls the model echoes back.
 *   3. A Run button is rendered; clicking it sends the call to the background,
 *      which posts it to CoS /browser/execute (kernel dispatch).
 *   4. The result is wrapped in <function_result call_id="N"> and typed back
 *      into the input; auto-submit sends it if enabled.
 *
 * Attribution is session-scoped (URL-derived), never request-id proven.
 */

(() => {
  'use strict';

  const VERSION = 1;
  const handle = { version: VERSION, healthy: () => false, stop: () => undefined };
  {
    const incumbent = globalThis.__COS_BROWSER_CONNECTOR__ || null;
    let healthy = false;
    try {
      healthy = !!incumbent && typeof incumbent.healthy === 'function' && incumbent.healthy() === true;
    } catch {
      healthy = false;
    }
    if (healthy && (incumbent.version || 0) >= VERSION) return;
    if (incumbent && typeof incumbent.stop === 'function') {
      try {
        incumbent.stop();
      } catch {
        /* orphan */
      }
    }
    globalThis.__COS_BROWSER_CONNECTOR__ = handle;
  }

  const STORAGE_KEY = 'cosBrowserConnectors';
  const OBSERVE_MS = 200;

  /** Site table mirrors src/main/providers/browser-connectors.ts. */
  const SITES = [
    { id: 'browser-gemini', host: 'gemini.google.com', input: ['div.ql-editor.textarea.new-input-ui p', '.ql-editor p', 'div[contenteditable="true"]'], submit: ['button.mat-mdc-icon-button.send-button', 'button[aria-label*="Send"]'] },
    { id: 'browser-perplexity', host: 'perplexity.ai', input: ['#ask-input[contenteditable="true"]', '#ask-input[role="textbox"]', 'div[contenteditable="true"][data-lexical-editor="true"]'], submit: ['button[aria-label="Submit"]', 'button[aria-label="Send"]'] },
    { id: 'browser-grok', host: 'grok.com', input: ['textarea', 'div[contenteditable="true"]'], submit: ['button[aria-label*="Send"]', 'button.send-button'] },
    { id: 'browser-grok-x', host: 'x.com', path: /\/i\/grok/, input: ['textarea', 'div[contenteditable="true"]'], submit: ['button[aria-label*="Send"]'] },
    { id: 'browser-aistudio', host: 'aistudio.google.com', input: ['textarea', 'div[contenteditable="true"]'], submit: ['button[aria-label*="Send"]', 'button[aria-label*="Run"]'] },
    { id: 'browser-openrouter', host: 'openrouter.ai', input: ['textarea[data-testid="composer-input"]', 'textarea[placeholder="Start a new message..."]', 'div[contenteditable="true"]'], submit: ['button[data-testid="send-button"]', 'button[aria-label="Send message"]'] },
    { id: 'browser-deepseek', host: 'chat.deepseek.com', input: ['textarea[spellcheck="false"]', 'textarea.chat-input', 'div[contenteditable="true"]'], submit: ['button[aria-label*="Send"]', 'button[data-testid="send-button"]'] },
    { id: 'browser-t3chat', host: 't3.chat', input: ['textarea', 'input[type="text"]', 'div[contenteditable="true"]'], submit: ['button[aria-label*="Send"]', 'button[type="submit"]'] },
    { id: 'browser-copilot', host: 'github.com', path: /\/(copilot|settings\/copilot)/, input: ['textarea', 'div[contenteditable="true"]'], submit: ['button[aria-label*="Send"]', 'button[type="submit"]'] },
    { id: 'browser-mistral', host: 'chat.mistral.ai', input: ['textarea', 'div[contenteditable="true"]'], submit: ['button[aria-label*="Send"]'] },
    { id: 'browser-kimi', host: 'kimi.com', input: ['.chat-input-editor[contenteditable="true"]', 'div[contenteditable="true"][data-lexical-editor="true"]', '.chat-input-editor'], submit: ['.send-button', 'button[aria-label*="Send"]'] },
    { id: 'browser-qwen', host: 'chat.qwen.ai', input: ['textarea.message-input-textarea', '#chat-input', 'textarea.chat-input'], submit: ['button.omni-button-content-btn', 'button.send-button'] },
    { id: 'browser-z', host: 'chat.z.ai', input: ['#chat-input'], submit: ['#send-message-button'] }
  ];

  const state = {
    site: null,
    enabled: false,
    instructions: '',
    observer: null,
    timer: null,
    processed: new WeakSet(),
    executed: new WeakSet(),
    autoExecute: false,
    autoSubmit: false,
    nonce: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  };

  const pick = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  function conversationId() {
    const path = window.location.pathname || '';
    const segment = path.split('/').filter(Boolean)[0] || '';
    const id = segment && /^[a-zA-Z0-9_-]{4,64}$/.test(segment) ? segment : `tab-${state.nonce}`;
    return `${state.site.id}--${id}`;
  }

  function findSite() {
    const host = window.location.hostname || '';
    const path = window.location.pathname || '';
    for (const site of SITES) {
      if (!host.includes(site.host)) continue;
      if (site.path && !site.path.test(path)) continue;
      return site;
    }
    return null;
  }

  async function enabledSites() {
    // The app owns the switches; its answer wins when the bridge answers.
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'cos-browser-settings' });
      if (reply && reply.ok && reply.data && reply.data.enabled) {
        return {
          ...reply.data.enabled,
          autoExecute: reply.data.autoExecute === true,
          autoSubmit: reply.data.autoSubmit === true
        };
      }
    } catch {
      /* fall through to local storage */
    }
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      return stored[STORAGE_KEY] || {};
    } catch {
      return {};
    }
  }

  function insertIntoInput(text) {
    const input = pick(state.site.input);
    if (!input) return false;
    input.focus();
    if (input.isContentEditable) {
      const existing = input.textContent || '';
      const paragraph = document.createElement('p');
      paragraph.textContent = existing ? `${existing}\n${text}` : text;
      input.innerHTML = '';
      input.appendChild(paragraph);
      const range = document.createRange();
      const selection = window.getSelection();
      if (selection && paragraph.lastChild) {
        range.setStartAfter(paragraph.lastChild);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      const value = input.value || '';
      input.value = value ? `${value}\n${text}` : text;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function submit() {
    const button = pick(state.site.submit);
    if (button && typeof button.click === 'function') {
      button.click();
      return true;
    }
    const input = pick(state.site.input);
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      return true;
    }
    return false;
  }

  async function fetchCatalog() {
    const reply = await chrome.runtime.sendMessage({ type: 'cos-browser-catalog' });
    if (reply && reply.ok && reply.data && typeof reply.data.instructions === 'string') {
      state.instructions = reply.data.instructions;
    }
    return state.instructions;
  }

  async function insertInstructions() {
    if (!state.instructions) await fetchCatalog();
    if (!state.instructions) return false;
    return insertIntoInput(state.instructions);
  }

  async function executeTool(info) {
    const reply = await chrome.runtime.sendMessage({
      type: 'cos-browser-execute',
      tool: info.name,
      args: info.params,
      conversationId: conversationId(),
      siteId: state.site.id
    });
    if (reply && reply.ok && reply.data && reply.data.result) {
      return reply.data.result;
    }
    const error = reply && reply.error ? reply.error : 'Tool call failed';
    return { content: [{ type: 'text', text: `Tool execution failed: ${error}` }], isError: true };
  }

  function resultText(result) {
    if (!result || !Array.isArray(result.content)) return '';
    return result.content
      .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
  }

  function renderBlock(el, info) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cos-fn';
    wrapper.style.cssText = 'margin:6px 0;padding:8px 10px;border:1px solid rgba(128,128,128,.35);border-radius:8px;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const name = document.createElement('span');
    name.textContent = info.name;
    name.style.fontWeight = '600';
    const run = document.createElement('button');
    run.textContent = 'Run';
    run.style.cssText = 'margin-left:auto;padding:2px 10px;border-radius:6px;border:1px solid rgba(128,128,128,.5);background:transparent;cursor:pointer;';
    const params = document.createElement('div');
    params.style.cssText = 'margin-top:4px;opacity:.85;white-space:pre-wrap;word-break:break-word;';
    params.textContent = JSON.stringify(info.params || {}, null, 2);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;display:none;white-space:pre-wrap;word-break:break-word;';
    head.appendChild(name);
    head.appendChild(run);
    wrapper.appendChild(head);
    wrapper.appendChild(params);
    wrapper.appendChild(result);
    if (el.parentNode) el.parentNode.insertBefore(wrapper, el.nextSibling);

    run.addEventListener('click', async () => {
      run.disabled = true;
      run.textContent = 'Running…';
      result.style.display = 'block';
      result.textContent = 'Running…';
      const toolResult = await executeTool(info);
      run.textContent = 'Run';
      run.disabled = false;
      const text = resultText(toolResult);
      result.textContent = text || '(empty result)';
      const wrapped = `<function_result call_id="${info.callId}">\n${text}\n</function_result>`;
      const inserted = insertIntoInput(wrapped);
      if (inserted && state.autoSubmit) {
        setTimeout(() => submit(), 400);
      }
    });
  }

  /** Parses one pre/code element; returns {name, callId, params} or null. */
  function parse(el) {
    const text = (el.textContent || '').trim();
    if (!text) return null;
    const isJson = text.includes('"type"') && text.includes('function_call');
    const isXml = text.includes('<function_calls>') || text.includes('<invoke');
    if (!isJson && !isXml) return null;

    if (isJson) {
      const complete = text.includes('function_call_end');
      if (!complete) return null;
      let name = null;
      let callId = '1';
      const params = {};
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'function_call_start') {
            name = parsed.name || null;
            if (parsed.call_id !== undefined) callId = String(parsed.call_id);
          } else if (parsed.type === 'parameter' && parsed.key !== undefined) {
            params[parsed.key] = parsed.value;
          }
        } catch {
          /* skip malformed lines */
        }
      }
      if (!name) return null;
      return { name, callId, params };
    }

    // XML (antml-style)
    if (!text.includes('</function_calls>')) return null;
    const invoke = text.match(/<invoke\s+name="([^"]+)"(?:\s+call_id="([^"]+)")?/);
    if (!invoke) return null;
    const name = invoke[1];
    const callId = invoke[2] || '1';
    const params = {};
    const paramRe = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
    let match;
    while ((match = paramRe.exec(text)) !== null) {
      params[match[1]] = match[2].trim();
    }
    return { name, callId, params };
  }

  function scan() {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      const elements = document.querySelectorAll('pre, code');
      for (const el of elements) {
        if (state.processed.has(el) || el.closest('.cos-fn')) continue;
        const info = parse(el);
        if (!info) continue;
        state.processed.add(el);
        renderBlock(el, info);
      }
    }, OBSERVE_MS);
  }

  /** Marks user messages that carry a function result, so they are findable. */
  function relabelResults() {
    if (!state.site.resultAnchor) return;
    for (const el of document.querySelectorAll(state.site.resultAnchor)) {
      if (el.closest('.cos-marked') || el.querySelector('.cos-marked')) continue;
      const text = el.textContent || '';
      if (!text.includes('<function_result')) continue;
      el.classList.add('cos-marked');
      el.style.outline = '1px dashed rgba(128,128,128,.4)';
    }
  }

  function startObserver() {
    if (state.observer) return;
    const observer = new MutationObserver(() => {
      scan();
      relabelResults();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
    state.observer = observer;
    scan();
  }

  function addFloatingButton() {
    const existing = document.getElementById('cos-browser-button');
    if (existing) return;
    const button = document.createElement('button');
    button.id = 'cos-browser-button';
    button.textContent = 'MCP';
    button.title = 'Insert Chat On Steroids MCP instructions';
    button.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:2147483000;padding:6px 12px;border-radius:999px;' +
      'border:1px solid rgba(128,128,128,.5);background:rgba(20,20,30,.9);color:#fff;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    button.addEventListener('click', async () => {
      const ok = await insertInstructions();
      button.textContent = ok ? 'Inserted ✓' : 'Failed';
      setTimeout(() => {
        button.textContent = 'MCP';
      }, 2000);
    });
    (document.body || document.documentElement).appendChild(button);
  }

  async function boot() {
    const site = findSite();
    if (!site) return;
    // Double-extension conflict guard: if MCP-SuperAssistant is also running on
    // this page it owns the tool-call protocol here. Two engines parsing the
    // same blocks would double-execute. Defer, deliberately, fail-closed.
    if (typeof window.mcpClient !== 'undefined' || typeof window.mcpAdapter !== 'undefined') {
      console.debug('[cos-browser-connector] MCP-SuperAssistant detected; deferring.');
      return;
    }
    state.site = site;
    const enabled = await enabledSites();
    state.enabled = enabled[site.id] === true;
    state.autoExecute = enabled.autoExecute === true;
    state.autoSubmit = enabled.autoSubmit === true;
    if (!state.enabled) return;
    addFloatingButton();
    startObserver();
    handle.healthy = () => true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    void boot();
  }
})();
