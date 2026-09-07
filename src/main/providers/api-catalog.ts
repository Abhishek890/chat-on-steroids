/**
 * API provider catalog (Phase 3).
 *
 * One row per chat-completions-style provider. OpenRouter is the only provider
 * with a wired key slot today; the rest are registered so the transport is
 * provider-parametric, but their key slots are pending and their tool-call
 * support is marked UNKNOWN until verified at runtime against each provider.
 */

import { getSecret } from '../secrets.js';
import type { ApiConnectorInfo } from '../../shared/providers.js';

export type ToolCallSupport = 'openai-native' | 'unsupported-shape' | 'unknown';

export interface ApiProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  /** Secret key slot; null means the slot is not wired yet. */
  readonly apiKeySecret: string | null;
  readonly openaiCompatible: boolean;
  readonly toolCall: ToolCallSupport;
  /** If non-empty, only these models are allowed to use tools. */
  readonly toolModels: readonly string[];
  /** Default for new sessions: write tools are refused when false. */
  readonly writeToolsDefault: boolean;
  readonly knownModels: readonly string[];
}

/**
 * Tools that change the machine. API connectors default to read-only until the
 * user explicitly opts in, independent of the global capability permissions.
 */
export const API_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'apply_patch',
  'exec_command',
  'write_stdin',
  'computer'
]);

export const API_PROVIDERS: readonly ApiProviderConfig[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeySecret: 'openRouterApiKey',
    openaiCompatible: true,
    toolCall: 'openai-native',
    toolModels: [],
    writeToolsDefault: false,
    knownModels: []
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeySecret: null,
    openaiCompatible: true,
    toolCall: 'openai-native',
    toolModels: [],
    writeToolsDefault: false,
    knownModels: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeySecret: null,
    openaiCompatible: true,
    toolCall: 'openai-native',
    toolModels: [],
    writeToolsDefault: false,
    knownModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview']
  },
  {
    id: 'zhipu',
    name: 'GLM (Zhipu)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeySecret: null,
    openaiCompatible: true,
    toolCall: 'openai-native',
    toolModels: [],
    writeToolsDefault: false,
    knownModels: ['glm-4', 'glm-4-plus', 'glm-4-flash', 'glm-4.5']
  },
  {
    id: 'qwen',
    name: 'Qwen (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeySecret: null,
    openaiCompatible: true,
    toolCall: 'openai-native',
    toolModels: [],
    writeToolsDefault: false,
    knownModels: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3-235b-a22b']
  },
  {
    id: 'gemini',
    name: 'Gemini API',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeySecret: null,
    openaiCompatible: false,
    toolCall: 'unsupported-shape',
    toolModels: [],
    writeToolsDefault: false,
    knownModels: []
  }
];

export function apiProvider(id: string): ApiProviderConfig | null {
  return API_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Whether a model may be given tool definitions for this provider. */
export function toolAllowlistAllows(provider: ApiProviderConfig, model: string): boolean {
  return provider.toolModels.length === 0 || provider.toolModels.includes(model);
}

/** Whether write tools are allowed for a session on this provider. */
export function writeToolsAllowed(provider: ApiProviderConfig, allowWrite: boolean): boolean {
  return provider.writeToolsDefault && allowWrite;
}

/** Renderer-facing summary, with the key presence resolved (never the key). */
export async function apiConnectorInfo(): Promise<ApiConnectorInfo[]> {
  const infos: ApiConnectorInfo[] = [];
  for (const provider of API_PROVIDERS) {
    const hasKey = provider.apiKeySecret ? (await getSecret(provider.apiKeySecret as never)) !== null : false;
    infos.push({
      id: provider.id,
      name: provider.name,
      openaiCompatible: provider.openaiCompatible,
      toolCall: provider.toolCall,
      hasKey,
      toolModels: provider.toolModels,
      writeToolsDefault: provider.writeToolsDefault
    });
  }
  return infos;
}
