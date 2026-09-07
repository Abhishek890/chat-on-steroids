/**
 * Provider connector contracts for the multi-provider Chat On Steroids.
 *
 * Phase 0 of the integration blueprint keeps these contracts signature-only:
 * ChatGPT remains the one registered connector and no live path is rewired.
 * Later phases add browser connectors (MCP-SuperAssistant engine) and API
 * connectors behind the same seams.
 *
 * Attribution honesty: only ChatGPT can prove which conversation issued an MCP
 * call (the x-request-id / metadata.request_id join). Every other connector is
 * attributed by local session identity, which is weaker.
 */

export type ConnectorTransport = 'api' | 'browser';
export type ToolProtocol = 'native' | 'prompt';
export type AttributionMode = 'session' | 'request-id';

export interface ConnectorDescriptor {
  /** Stable registry id, e.g. "chatgpt-browser". */
  readonly id: string;
  /** Human label shown in the UI and setup cards. */
  readonly name: string;
  readonly transport: ConnectorTransport;
  /**
   * How tool calls reach the model:
   *  - "native": MCP / chat-completions tool calls inside the transport;
   *  - "prompt": a pasted instruction block the model must echo back as text.
   */
  readonly toolProtocol: ToolProtocol;
  readonly streaming: boolean;
  readonly multimodal: boolean;
  readonly attribution: AttributionMode;
  /** Optional hint for the model picker (e.g. an API catalogue id). */
  readonly modelCatalogHint: string | null;
  /** Hostnames the connector can bind, when transport is "browser". */
  readonly sites: readonly string[];
  /**
   * New connectors ship disabled; the existing ChatGPT path is the exception
   * because it is what the app ships with today.
   */
  readonly enabledByDefault: boolean;
}

/**
 * One live conversation behind any connector.
 *
 * Signature-only in Phase 0; implemented per connector in later phases.
 * The durable input queue in session/input.ts remains the single owner of a
 * user message regardless of which transport finally delivers it.
 */
export interface ConversationSession {
  readonly connectorId: string;
  readonly sessionId: string;
  conversationId(): string | null;
  status(): 'idle' | 'busy' | 'closed';
  sendUserTurn(input: UserTurn): Promise<TurnReceipt>;
  /** Receive tokens, tool calls, boundaries and errors for the active turn. */
  stream(handler: (event: TurnEvent) => void): () => void;
  /** Feeds one tool result back into the model's turn. */
  resolveTool(result: ToolResultMessage): Promise<void>;
  stop(): Promise<void>;
}

export interface UserTurn {
  readonly text: string;
  readonly images?: readonly { name: string; dataUrl: string }[];
}

export interface TurnReceipt {
  /** Durable input-queue id; decides redelivery on an ambiguous send. */
  readonly inputId: string;
  readonly state: 'queued' | 'sent' | 'failed';
}

export type TurnEvent =
  | { kind: 'token'; text: string }
  | { kind: 'tool-call'; name: string; args: Record<string, unknown> }
  | { kind: 'tool-result'; name: string }
  | { kind: 'boundary'; turnId: string }
  | { kind: 'error'; message: string };

export interface ToolResultMessage {
  readonly name: string;
  readonly result: { content: unknown[]; isError?: boolean };
}

/**
 * Renderer-facing summary of one API provider (no secrets).
 */
export interface ApiConnectorInfo {
  readonly id: string;
  readonly name: string;
  readonly openaiCompatible: boolean;
  readonly toolCall: 'openai-native' | 'unsupported-shape' | 'unknown';
  /** Whether a usable API key is currently configured for this provider. */
  readonly hasKey: boolean;
  /** If non-empty, only these models are allowed to use tools. */
  readonly toolModels: readonly string[];
  /** Default for new sessions: write tools are refused when false. */
  readonly writeToolsDefault: boolean;
}

export interface ApiModelList {
  readonly providerId: string;
  readonly models: readonly string[];
}

/** Registry contract; implemented in src/main/providers/manager.ts. */
export interface ProviderManager {
  register(descriptor: ConnectorDescriptor): void;
  get(id: string): ConnectorDescriptor;
  has(id: string): boolean;
  list(): readonly ConnectorDescriptor[];
}
