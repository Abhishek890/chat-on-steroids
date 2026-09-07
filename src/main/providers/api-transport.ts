/**
 * API connector transport (Phase 3): native tool-calling chat-completions
 * against OpenAI-compatible providers, using the same CoS kernel for tool
 * execution and the same buildServer tool list as every other connector.
 *
 * The transport is provider-parametric: the provider supplies the base URL,
 * the key slot and the tool-model allowlist (see api-catalog.ts). Attribution
 * is the session: an API conversation owns its own tool calls outright (there
 * is no browser page to prove them). The conversation id used for kernel
 * recording is the local session id, which is a valid session-store key.
 */

import { randomUUID } from 'node:crypto';
import { getConfig, effectiveCapabilities } from '../config.js';
import { serverInstructions } from '../mcp/instructions.js';
import { browserToolCatalog, capturedCoreHandler } from './browser-tools.js';
import { API_PROVIDERS, API_WRITE_TOOLS, apiProvider, toolAllowlistAllows } from './api-catalog.js';
import { dispatchWithKnownCaller, fail, friendlyError, type ToolContext, type ToolResult } from '../mcp/kernel.js';
import type {
  ConnectorDescriptor,
  ConversationSession,
  ProviderManager,
  ToolResultMessage,
  TurnEvent,
  TurnReceipt,
  UserTurn
} from '../../shared/providers.js';

const REQUEST_TIMEOUT_MS = 180_000;
const MAX_SSE_RECORD_CHARS = 64_000;
const MAX_MESSAGES = 120;
const MAX_TOOL_LOOP_ROUNDS = 16;

type ApiRole = 'system' | 'user' | 'assistant' | 'tool';

interface ApiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ApiMessage {
  role: ApiRole;
  content: string | Array<Record<string, unknown>> | null;
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
}

interface ApiToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ApiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

function liveContext(): ToolContext {
  const live = getConfig();
  return {
    roots: live.roots,
    caps: effectiveCapabilities(live),
    readOnly: live.readOnly,
    privacyScreenshots: live.ui.privacyScreenshots
  };
}

/** Registers every cataloged API provider in the Phase 0 manager. */
export function registerApiConnectors(manager: ProviderManager): void {
  for (const provider of API_PROVIDERS) {
    const descriptor: ConnectorDescriptor = {
      id: `api-${provider.id}`,
      name: `${provider.name} (API)`,
      transport: 'api',
      toolProtocol: provider.toolCall === 'openai-native' ? 'native' : 'prompt',
      streaming: provider.openaiCompatible,
      multimodal: provider.openaiCompatible,
      attribution: 'session',
      modelCatalogHint: provider.id,
      sites: [],
      enabledByDefault: false
    };
    manager.register(descriptor);
  }
}

/**
 * Executes one API tool call through the CoS kernel (session-scoped identity).
 * Write tools are refused before the kernel unless the session opted in, so an
 * API conversation defaults to read-only independent of the global capability
 * checkboxes.
 */
export async function executeApiTool(
  tool: string,
  args: Record<string, unknown>,
  conversationId: string,
  connectorId: string,
  allowWrite: boolean
): Promise<ToolResult> {
  if (!tool || typeof tool !== 'string') return fail('MISSING_TOOL: no tool name was supplied by the API connector.');
  if (API_WRITE_TOOLS.has(tool) && !allowWrite) {
    return fail(
      `WRITE_TOOLS_DISABLED: '${tool}' changes this machine, and write tools are off for API sessions. ` +
        'Ask the user to enable write access for this connector in Chat On Steroids, then retry.'
    );
  }
  const handler = await capturedCoreHandler(tool);
  if (!handler) {
    return fail(
      `UNKNOWN_TOOL: '${tool}' is not available on this connector. ` +
        'Enable the matching permission in Chat On Steroids, then retry.'
    );
  }
  try {
    return await dispatchWithKnownCaller(
      tool,
      args,
      conversationId,
      `api:${connectorId}`,
      'core',
      (received) => handler(received as never)
    );
  } catch (err) {
    return fail(friendlyError(err));
  }
}

/** One live API conversation. */
export class ApiConversationSession implements ConversationSession {
  readonly connectorId: string;
  readonly sessionId: string;
  readonly model: string;
  private readonly providerId: string;
  private readonly baseUrl: string;
  private readonly key: string | null;
  private readonly allowWrite: boolean;
  private readonly toolsAllowed: boolean;
  private readonly toolsPromise: Promise<ApiToolDef[]>;
  private readonly messages: ApiMessage[] = [];
  private readonly listeners = new Set<(event: TurnEvent) => void>();
  private controller: AbortController | null = null;
  private busy = false;
  private closed = false;
  private lastUsage: ApiUsage | null = null;

  constructor(
    providerId: string,
    model: string,
    key: string | null,
    options?: { allowWrite?: boolean; toolModelsAllowlist?: readonly string[] }
  ) {
    const provider = apiProvider(providerId);
    if (!provider) throw new Error(`Unknown API provider: ${providerId}`);
    if (provider.toolCall !== 'openai-native') {
      throw new Error(`Provider ${providerId} does not expose OpenAI-shaped tool calls yet.`);
    }
    this.providerId = provider.id;
    this.connectorId = provider.id;
    this.baseUrl = provider.baseUrl;
    this.model = model;
    this.key = key;
    this.allowWrite = options?.allowWrite ?? provider.writeToolsDefault;
    this.toolsAllowed = toolAllowlistAllows(
      { ...provider, toolModels: options?.toolModelsAllowlist ?? provider.toolModels },
      model
    );
    this.sessionId = randomUUID();
    // The catalog is async (lazy-imports the tool surface to avoid an ESM
    // cycle); the tool list is never needed before the first request.
    this.toolsPromise = browserToolCatalog().then((catalog) =>
      catalog.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
      }))
    );
    this.messages.push({ role: 'system', content: serverInstructions(liveContext(), 'core') });
  }

  conversationId(): string {
    return this.sessionId;
  }

  status(): 'idle' | 'busy' | 'closed' {
    if (this.closed) return 'closed';
    return this.busy ? 'busy' : 'idle';
  }

  /** Token usage from the most recent completion, when the provider reported it. */
  usage(): ApiUsage | null {
    return this.lastUsage;
  }

  stream(handler: (event: TurnEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(event: TurnEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** One user turn, run to completion including any tool-call loop. */
  async sendUserTurn(input: UserTurn): Promise<TurnReceipt> {
    if (this.busy) throw new Error('A turn is already in progress on this session.');
    if (this.closed) throw new Error('This session is closed.');
    if (!this.key) return { inputId: this.sessionId, state: 'failed' };

    this.messages.push({
      role: 'user',
      content:
        input.images && input.images.length > 0
          ? [
              { type: 'text', text: input.text },
              ...input.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))
            ]
          : input.text
    });

    this.busy = true;
    try {
      await this.runToolLoop();
      return { inputId: this.sessionId, state: 'sent' };
    } catch (err) {
      this.emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return { inputId: this.sessionId, state: 'failed' };
    } finally {
      this.busy = false;
    }
  }

  /** Appends one tool result and lets the model continue the same turn. */
  async resolveTool(result: ToolResultMessage): Promise<void> {
    if (this.busy) throw new Error('A turn is already in progress on this session.');
    this.busy = true;
    try {
      this.messages.push({
        role: 'tool',
        tool_call_id: result.name,
        content: contentToText(result.result?.content)
      });
      await this.runToolLoop();
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    this.busy = false;
  }

  close(): void {
    this.closed = true;
    this.controller?.abort();
    this.listeners.clear();
  }

  /** The assistant/tool loop for one turn, until the model produces a final answer. */
  private async runToolLoop(): Promise<void> {
    for (let round = 0; round < MAX_TOOL_LOOP_ROUNDS; round += 1) {
      const assistant = await this.streamOnce();
      if (assistant.toolCalls.length === 0) {
        this.messages.push({ role: 'assistant', content: assistant.content });
        this.emit({ kind: 'boundary', turnId: this.sessionId });
        return;
      }
      this.messages.push({ role: 'assistant', content: assistant.content, tool_calls: assistant.toolCalls });
      for (const call of assistant.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = { _raw: call.function.arguments };
        }
        this.emit({ kind: 'tool-call', name: call.function.name, args });
        const result = await executeApiTool(call.function.name, args, this.sessionId, this.providerId, this.allowWrite);
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: contentToText(result.content) });
        this.emit({ kind: 'tool-result', name: call.function.name });
      }
    }
    throw new Error('Tool loop exceeded the round limit without a final answer.');
  }

  /** One POST /chat/completions streaming request; returns content + tool calls. */
  private async streamOnce(): Promise<{ content: string; toolCalls: ApiToolCall[] }> {
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(1, this.messages.length - MAX_MESSAGES);
    }
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.key}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages: this.messages,
          tools: this.toolsAllowed ? await this.toolsPromise : []
        }),
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      return await this.readStream(response.body);
    } finally {
      clearTimeout(timer);
      this.controller = null;
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<{ content: string; toolCalls: ApiToolCall[] }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let content = '';
    const toolCalls: ApiToolCall[] = [];

    const consume = (rawLine: string): boolean => {
      if (rawLine.length > MAX_SSE_RECORD_CHARS) throw new Error('stream_record_too_long');
      const line = rawLine.trim();
      if (!line || line.startsWith(':') || !line.startsWith('data:')) return false;
      const payload = line.slice(5).trim();
      if (!payload) return false;
      if (payload === '[DONE]') return true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error('malformed_stream_record');
      }
      const usage = (parsed as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } }).usage;
      if (usage && typeof usage === 'object') {
        this.lastUsage = {
          promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
          completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
          totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null
        };
      }
      const choice = (parsed as { choices?: Array<{ delta?: { content?: string | null; tool_calls?: unknown } }> })?.choices?.[0];
      const delta = choice?.delta;
      if (!delta) return false;
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        this.emit({ kind: 'token', text: delta.content });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const part of delta.tool_calls) {
          if (!part || typeof part !== 'object') continue;
          const index = (part as { index?: number }).index ?? 0;
          const id = (part as { id?: string }).id ?? '';
          const fn = (part as { function?: { name?: string; arguments?: string } }).function;
          if (!toolCalls[index]) {
            toolCalls[index] = { id, type: 'function', function: { name: '', arguments: '' } };
          }
          if (id) toolCalls[index].id = id;
          if (fn?.name) toolCalls[index].function.name += fn.name;
          if (fn?.arguments) toolCalls[index].function.arguments += fn.arguments;
        }
      }
      return false;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let cut = buffered.indexOf('\n');
        while (cut >= 0) {
          const rawLine = buffered.slice(0, cut);
          buffered = buffered.slice(cut + 1);
          if (consume(rawLine)) return { content, toolCalls: toolCalls.filter(Boolean) };
          cut = buffered.indexOf('\n');
        }
      }
      if (buffered.trim()) consume(buffered);
    } finally {
      reader.releaseLock();
    }
    return { content, toolCalls: toolCalls.filter(Boolean) };
  }
}

/** Flattens a kernel ToolResult content array into text for a tool message. */
function contentToText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .filter((item): item is { type: 'text'; text: string } => !!item && typeof item === 'object' && (item as { type?: string }).type === 'text')
      .map((item) => item.text)
      .join('\n');
  }
  return String(content ?? '');
}
