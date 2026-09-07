/**
 * Renderer for the API chat panel (Phase 3).
 *
 * A self-contained multi-model chat: pick a provider and model, type a message,
 * and stream the reply. Tool calls run through the Chat On Steroids kernel and
 * show up in the timeline as rows. Nothing here uses innerHTML — every node is
 * built from text, matching the rest of the renderer.
 */

import { $, el, run } from './dom.js';

const $btn = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;
const $sel = (id: string): HTMLSelectElement => $(id) as HTMLSelectElement;
const $inp = (id: string): HTMLInputElement => $(id) as HTMLInputElement;
const $txt = (id: string): HTMLTextAreaElement => $(id) as HTMLTextAreaElement;
import type { ApiConnectorInfo, TurnEvent } from '../shared/providers.js';

const api = window.api;

interface ApiChatState {
  providerId: string | null;
  model: string;
  sessionId: string | null;
  connectors: ApiConnectorInfo[];
  allowWrite: boolean;
}

const state: ApiChatState = {
  providerId: null,
  model: '',
  sessionId: null,
  connectors: [],
  allowWrite: false
};

/** One timeline row per source message; tool rows get their own kind. */
function timeline(kind: 'user' | 'assistant' | 'tool' | 'system', text: string): HTMLElement {
  const row = el('div', `api-row api-${kind}`);
  const label = el('span', 'api-row-label', kind === 'user' ? 'You' : kind === 'assistant' ? 'Model' : kind === 'tool' ? 'Tool' : 'System');
  const body = el('div', 'api-row-body', text);
  row.append(label, body);
  return row;
}

function appendTimeline(node: HTMLElement, stick = true): void {
  const timelineEl = $<HTMLDivElement>('apiTimeline');
  timelineEl.append(node);
  const empty = $('apiTimelineEmpty');
  if (empty) empty.hidden = true;
  if (stick) timelineEl.scrollTop = timelineEl.scrollHeight;
}

function setStatus(text: string): void {
  $('apiStatus').textContent = text;
}

async function refreshConnectors(): Promise<void> {
  const connectors = await run(api.apiConnectors());
  if (connectors) state.connectors = connectors;
  const providerSelect = $sel('apiProvider');
  providerSelect.replaceChildren();
  // Only OpenAI-shaped providers can run the transport today; the rest are shown
  // disabled with a note so the catalog is visible.
  for (const connector of connectors ?? []) {
    const option = document.createElement('option');
    option.value = connector.id;
    option.textContent = connector.name;
    const usable = connector.toolCall === 'openai-native';
    if (!usable) option.disabled = true;
    else if (!connector.hasKey) option.textContent = `${connector.name} — add a key`;
    providerSelect.append(option);
  }
  if (connectors && connectors.length > 0 && !state.providerId) {
    const first = connectors[0];
    if (first) providerSelect.value = first.id;
    void onProviderChange();
  }
}

async function onProviderChange(): Promise<void> {
  const providerSelect = $sel('apiProvider');
  const providerId = providerSelect.value;
  state.providerId = providerId;
  const models = await run(api.apiModels(providerId));
  const modelSelect = $sel('apiModel');
  modelSelect.replaceChildren();
  if (models && models.models.length > 0) {
    for (const model of models.models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.append(option);
    }
    const firstModel = models.models[0];
    if (firstModel) {
      modelSelect.value = firstModel;
      state.model = firstModel;
    }
    modelSelect.disabled = false;
    $('apiKeyRow').hidden = providerId !== 'openrouter';
  } else {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No models available';
    modelSelect.append(option);
    modelSelect.disabled = true;
  }
}

async function saveKey(): Promise<void> {
  const input = $inp('apiProviderKey');
  const value = input.value.trim();
  const result = await run(api.setGoalKey(value));
  if (result) {
    input.value = '';
    setStatus(value ? 'OpenRouter key stored.' : 'OpenRouter key cleared.');
    void refreshConnectors();
  }
}

async function startChat(): Promise<void> {
  if (!state.providerId || !state.model) {
    setStatus('Choose a provider and model first.');
    return;
  }
  const provider = state.connectors.find((c) => c.id === state.providerId);
  if (provider && !provider.hasKey) {
    setStatus(`${provider.name} has no API key. Add one above.`);
    return;
  }
  const created = await run(api.apiSessionCreate(state.providerId, state.model, state.allowWrite));
  if (created) {
    state.sessionId = created.sessionId;
    $('apiTimeline').replaceChildren();
    $('apiTimelineEmpty')?.removeAttribute('hidden');
    $('apiComposer').hidden = false;
    $btn('apiSend').disabled = false;
    $txt('apiInput').value = '';
    setStatus(`Session started (${state.model}).`);
  }
}

async function sendMessage(): Promise<void> {
  const input = $txt('apiInput');
  const text = input.value.trim();
  if (!text || !state.sessionId) return;
  appendTimeline(timeline('user', text));
  input.value = '';
  $btn('apiSend').disabled = true;
  setStatus('Sending…');
  const receipt = await run(api.apiSessionSend(state.sessionId, text));
  if (!receipt) {
    $btn('apiSend').disabled = false;
    setStatus('Send failed — see the error above.');
  } else if (receipt.state === 'failed') {
    $btn('apiSend').disabled = false;
  }
}

function onEvent(data: { sessionId: string; event: TurnEvent }): void {
  if (state.sessionId && data.sessionId !== state.sessionId) return;
  const event = data.event;
  switch (event.kind) {
    case 'token':
      ($('apiStream') ?? appendStreamRow()).textContent += event.text;
      break;
    case 'tool-call':
      setStatus(`Running ${event.name}…`);
      appendTimeline(timeline('tool', `${event.name}\n${JSON.stringify(event.args, null, 2)}`));
      break;
    case 'tool-result':
      setStatus('Tool finished.');
      break;
    case 'boundary':
      flushStream();
      $btn('apiSend').disabled = false;
      setStatus('Done.');
      break;
    case 'error':
      flushStream();
      $btn('apiSend').disabled = false;
      appendTimeline(timeline('system', event.message));
      setStatus('Failed.');
      break;
  }
}

/** One assistant row that token events append into until the turn boundary. */
function appendStreamRow(): HTMLElement {
  const row = el('div', 'api-row api-assistant');
  const label = el('span', 'api-row-label', 'Model');
  const body = el('div', 'api-row-body');
  row.append(label, body);
  appendTimeline(row);
  $('apiStream')?.removeAttribute('id');
  body.id = 'apiStream';
  return body;
}

function flushStream(): void {
  const stream = $('apiStream') as HTMLElement | null;
  if (stream) stream.removeAttribute('id');
}

export function initApiChat(): void {
  // Defensive: every lookup is guarded so a host page missing this panel (or a
  // test harness that renders a subset) cannot crash the app.
  const provider = document.getElementById('apiProvider');
  const model = document.getElementById('apiModel');
  const keySave = document.getElementById('apiKeySave');
  const newChat = document.getElementById('apiNewChat');
  const allowWrite = document.getElementById('apiAllowWrite');
  const composer = document.getElementById('apiComposer');
  if (provider) provider.addEventListener('change', () => void onProviderChange());
  if (model) model.addEventListener('change', () => { state.model = $sel('apiModel').value; });
  if (keySave) keySave.addEventListener('click', () => void saveKey());
  if (newChat) newChat.addEventListener('click', () => void startChat());
  if (allowWrite) allowWrite.addEventListener('change', (event) => {
    state.allowWrite = (event.target as HTMLInputElement).checked;
  });
  if (composer) composer.addEventListener('submit', (event) => {
    event.preventDefault();
    void sendMessage();
  });
  api.onApiEvent(onEvent);
}

export function showApiScreen(): void {
  void refreshConnectors();
}
