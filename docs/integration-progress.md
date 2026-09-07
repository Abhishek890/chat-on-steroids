# Chat On Steroids × MCP-SuperAssistant — Integration Blueprint & Progress

> **Status of this document:** living plan. Updated as phases start and finish.
> **Current phase:** Phases 0–3 complete; Phase 4 dropped. Browser path is the product; API path slated for removal.
> **Last updated:** 2026-09-07

Legend for status fields: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked/needs decision.
Evidence markers: `[CONFIRMED]` = traced in source during the audits; `[UNKNOWN]` = requires a runtime test before committing.

---

## 0. Product decision — browser path is the product (2026-09-07)

- The **browser path** is the product: free web chats with tool access, **no API keys, no per-token cost** — the user's logged-in browser session is the only credential. This matches the project's original thesis ("use browser chat to save money").
- The **API path (Phase 3)** is built and tested but is **slated for future removal**. Do **not** invest further in it: no per-provider key slots, no usage-meter wiring, no more provider catalogs. It stays in the codebase until a removal task is scheduled; it does not interfere with the browser path.
- **Next browser-first work** (the deferred Phase 2 items, in priority order):
  1. Composer → browser delivery (type in CoS, message lands in the site's chat).
  2. Auto-open / navigate to the target site.
  3. Compact & Resume generalization for browser connectors (limit → summary → new chat → continue).
  4. Settings UI for the per-site browser-connector toggles.
- User-facing setup for the browser path lives in **`how-to-use.md`**.

---

## 1. Goal

Make **Chat On Steroids** a multi-provider chat workspace that supports **every AI website MCP-SuperAssistant already supports**, while keeping the existing ChatGPT-native path (Developer-mode MCP over a tunnel) working exactly as it is today.

Providers in scope (from the SuperAssistant audit — all have adapters in `pages/content/src/plugins/adapters/` `[CONFIRMED]`):

| Provider | Website | Adapter | Connect method in CoS |
|---|---|---|---|
| ChatGPT | chatgpt.com / chat.openai.com | `chatgpt.adapter.ts` | **Native MCP tunnel** (existing, keep as-is) |
| Gemini | gemini.google.com | `gemini.adapter.ts` | Browser connector (SA engine) |
| Perplexity | perplexity.ai | `perplexity.adapter.ts` | Browser connector |
| Grok | grok.com, x.com/twitter.com Grok | `grok.adapter.ts` | Browser connector |
| Google AI Studio | aistudio.google.com | `aistudio.adapter.ts` | Browser connector |
| OpenRouter Chat | openrouter.ai | `openrouter.adapter.ts` | Browser connector |
| DeepSeek | chat.deepseek.com | `deepseek.adapter.ts` | Browser connector |
| T3 Chat | t3.chat | `t3chat.adapter.ts` | Browser connector |
| GitHub Copilot | github.com/copilot | `ghcopilot.adapter.ts` | Browser connector |
| Mistral | chat.mistral.ai | `mistral.adapter.ts` | Browser connector |
| Kimi | kimi.com | `kimi.adapter.ts` | Browser connector |
| Qwen Chat | chat.qwen.ai | `qwenchat.adapter.ts` | Browser connector |
| Z Chat (GLM) | chat.z.ai | `z.adapter.ts` | Browser connector |

**Not supported by either project today (out of scope unless APIs are added):** MiniMax, MiMo, Muse, Tencent/HY — zero code references in either repo `[CONFIRMED]`.

---

## 2. Architecture decisions (from the two audits)

1. **CoS is the single authority** for tools, permissions, sessions, and UI. Its MCP server (`buildServer`/`kernel`), session store/recorder, agents broker, Goal/Loop, tunnels, and durable stores are already provider-independent `[CONFIRMED]`.
2. **SuperAssistant's engine becomes the "browser connector"** inside CoS: its adapters, DOM observers, XML/JSONL parsers, and instruction generator. Tool calls detected in the DOM are executed by **CoS's kernel** (one permission model), not by SuperAssistant's own MCP client.
3. **ChatGPT keeps its native path untouched**: tunnel + `correlation.ts` request-id attribution + extension relabeling. It becomes one connector among many.
4. **Attribution model differs per connector**: ChatGPT uses the request-id join `[CONFIRMED]`; browser connectors use session-scoped attribution (URL-bound conversation), which is weaker — documented limitation, not silent.
5. **One tool surface, three encodings**: `buildServer` generates the tool list once; it is consumed by (a) ChatGPT's connector over the tunnel, (b) API connectors as the `tools` array, (c) browser connectors as the generated instruction text.
6. **Non-ChatGPT sites have no native MCP**, so tool calls there work the SuperAssistant way: pasted instruction block → model prints a text-protocol call → DOM detection → execution → typed-back result. This is a property of those sites, not a design flaw.

---

## 3. Full phase roadmap

| Phase | Name | Goal | Status |
|---|---|---|---|
| 0 | Connector boundary extraction | Introduce ProviderManager/ConversationSession seams; ChatGPT becomes connector #1; no behavior change | [x] |
| 1 | Multi-site browser connector | Port SA engine into CoS; non-ChatGPT sites work end-to-end | [x] |
| 2 | Sessions, compaction, workers unified | Compact & Resume + multi-agent across providers | [~] |
| 3 | API connectors | Built, then **deprecated** — browser path only going forward | [x] |
| 4 | SA as thin client of CoS | **Dropped** by product decision | [–] |

---

## Phase 0 — Connector boundary extraction

**Objective:** introduce the provider seams with zero behavior change, so every later phase is additive.

**Tasks**
- [x] Design `ProviderManager` (registry) + `ConversationSession` (uniform handle) interfaces (signature-only, no implementation).
- [x] Register the existing ChatGPT browser path as connector #1 behind the manager.
- [x] Confirm the tool surface (`buildServer`/`kernel`) is callable without any ChatGPT-specific dependency `[CONFIRMED — tools-core operates on ToolContext; no bridge/extension/chatgpt imports in src/main/mcp/* (only doc comments)]`.
- [x] Add per-connector capability descriptor: `{ id, transport: 'api'|'browser', toolProtocol: 'native'|'prompt', streaming, multimodal, attribution: 'session'|'request-id', modelCatalogHint }`.
- [x] Keep all existing tests green; ChatGPT behavior byte-identical (2852 passed / 0 failed / 100 skipped; typecheck clean).

**Deliverables (chat-on-steroids tree, uncommitted)**
- `src/shared/providers.ts` — connector contracts + signature-only `ConversationSession`.
- `src/main/providers/manager.ts` — data-only registry + `registerChatgptBrowserConnector`.
- `test/providers.test.ts` — 6 registry tests.
- `src/main/index.ts` — registry wired + one log line; no live path rewired.

**Note:** pinned-ripgrep test needs `npm run rg` after a `--ignore-scripts` install (environmental, not code).

**Rollback:** single-commit revert; deleting the registry file restores today's wiring.

---

## Phase 1 — Multi-site browser connector (core, non-breaking)

**Objective:** non-ChatGPT sites from SuperAssistant work end-to-end inside CoS, disabled by default per site.

**Scope**
1. **Connector registry** in CoS: one entry per site (hostname, adapter source, capabilities, attribution mode).
2. **Port SuperAssistant's engine** into the companion extension as a second, parallel code path **disabled by default**:
   - `render_prescript` — MutationObservers, XML/JSONL parsers, streaming + stalled-stream handling, duplicate-protection/execution history `[CONFIRMED]`.
   - Adapter pattern + per-site `WEBSITE_CONFIGS` render configs (targetSelectors, function_result_selector, CodeMirror flags) `[CONFIRMED]`.
   - Instruction generator (XML/JSONL) — but the tool list/schema comes from **CoS's `buildServer`**, not from SA's own tool store.
3. **Execution wiring:** detected tool call → bridge command to CoS → **CoS kernel** dispatch (same permission gates, `TOOL_DISABLED`, evidence recording) → result typed back via SA's `insertText` + optional auto-submit.
4. **Sessions:** each site conversation recorded as a normal CoS session (events.jsonl/messages/meta); tool rows summarized by the existing summarizer.
5. **Attribution:** ChatGPT keeps request-id; other sites get session-scoped attribution.

**Tasks**
- [x] Phase 0 lands first (manager + registry).
- [x] Port render_prescript parser/observer modules into the extension (behind flag).
- [x] Port adapter base + first 3 adapters (Gemini, DeepSeek, Kimi).
- [x] Bridge protocol: new command types for detected tool calls + result delivery.
- [x] Kernel entry: accept browser-connector calls with session-scoped identity.
- [x] Instruction generation from `buildServer` tool list.
- [~] Session recording for browser connectors (tool calls are recorded via the kernel; full transcript capture per site is Phase 2 remaining).
- [~] Per-site enable flags in Settings; Setup-tab health probe (selector smoke test) (flags exist in extension storage; Settings UI is Phase 2 remaining).
- [x] Double-extension conflict guard (defers to MCP-SuperAssistant when present — implemented in `extension/browser-connector.js`).

**Deliverables (chat-on-steroids tree, uncommitted) — complete**
- `src/main/mcp/kernel.ts` — `createRegistrar` capture param (one handler set, every transport) + `dispatchWithKnownCaller` (session-scoped identity; skips request-id waits, keeps every capability gate).
- `src/main/providers/browser-connectors.ts` — 13 SA site configs (Gemini, Perplexity, Grok, Grok-on-X, AI Studio, OpenRouter, DeepSeek, T3, Copilot, Mistral, Kimi, Qwen, Z) registered as disabled prompt connectors.
- `src/main/providers/browser-tools.ts` — tool catalog via the same `buildServer` publication path as the ChatGPT connector; JSONL prompt-protocol instructions; `executeBrowserTool` (never throws; kernel entry); `capturedCoreHandler` shared by every transport.
- `src/main/bridge.ts` — authed routes `GET /browser/catalog`, `POST /browser/execute`.
- `src/main/index.ts` — browser connectors registered in the Phase 0 manager.
- `extension/browser-connector.js` — content script: floating MCP button (inserts instructions), MutationObserver + XML/JSONL parser, Run button, `<function_result call_id>` typed back, optional auto-submit. Disabled by default per site (`chrome.storage.local["cosBrowserConnectors"]`).
- `extension/manifest.json` — content-script entries for the 13 site groups (ChatGPT entries untouched); `extension/background.js` — `cos-browser-catalog` / `cos-browser-execute` handlers.
- Tests: `test/browser-connectors.test.ts` (14) + `test/providers.test.ts` (6). Suite: 2866 passed / 0 failed / 100 skipped; typecheck clean.

**Notes**
- Enablement is app-owned via the `browserConnectors` config section; Settings UI pending (interim method in `how-to-use.md`).
- An ESM import cycle (kernel→bridge→browser-tools→tools→tools-desktop→kernel) was caught by the suite and fixed with call-time dynamic imports inside `browser-tools.ts`.
- Remaining Phase 1 polish deferred into Phase 2: CodeMirror accessor on Qwen/Z, per-site result anchors, result-anchor rendering, health probes.

**Dependencies:** Phase 0.
**Risks:**
- DOM selector rot per site (SA's known weakness) — mitigate with multi-fallback selectors + health probe.
- Prompt-injection surface (page text can encode tool calls) — mitigate with execute/auto-execute toggles, **default off**.
- Weaker attribution than ChatGPT — documented limitation.
- Two extensions on one site — detect and defer.

**Success criteria:** on at least Gemini + DeepSeek + Kimi: user chats in the site's own UI, model calls CoS tools, results return, everything lands in the CoS timeline with correct outcomes; ChatGPT flow byte-identical; all existing tests green.

**Rollback:** per-site enable flags (default off) + one connector-module delete. ChatGPT path shares no code with this phase.

---

## Phase 2 — Sessions, compaction, and workers unified across providers

**Objective:** the session layer works for every provider, not just ChatGPT.

**Scope**
1. **Compact & Resume generalized:** handoff brief written in the site chat (typed via the adapter), continuation opened as a new tab on the same site through the bridge opener; `resume-gate.ts` reused for the recorder race (mechanism is browser-generic) `[CONFIRMED]`.
2. **Multi-agent workers on browser providers:** prime/worker broker reused; worker = a tab on the chosen site; identity fail-closed per connector (agent tools only where the connector can prove the conversation).
3. **Blocked-chats generalized** from ChatGPT conversation ids to connector-scoped conversation ids.
4. **Hardening:** per-site health probe in Setup, selector-rotation alerts, model-picker equivalents where sites expose them (Gemini, OpenRouter), CoS update flow shipping extension + connector set together.

**Tasks**
- [ ] Generalize continuation/handoff to connector-scoped sessions. **Design-gated, deferred** (needs live-site runtime validation; attempting blind risks the race `resume-gate.ts` exists to prevent).
- [x] Generalize blocked-chats (`setConnectorChatBlocked` + `POST /browser/block` + tests).
- [x] Workers on browser providers: resolved **fail-closed by design** — the `agents` tool requires proven caller identity (`caller.sessionId`/`caller.conversationId` via request-id evidence), which browser connectors cannot supply (attribution is session-scoped). Agent control stays refused for browser connectors rather than weakened; revisit only with a real identity source.
- [x] App-owned per-site enablement: `browserConnectors` config section (zod-validated, defaults off) + `GET/POST /browser/settings` bridge routes; the extension background forwards app settings to the content script (chrome.storage kept as offline fallback).
- [x] Setup health probe: `GET /browser/health` + `browserHealthProbe()` (per-site selector counts, enabled state, roots/readOnly). Selector-rotation alerts remain UI work.
- [x] Session recording for browser connectors: conversation keys use the `siteId--segment` shape (valid session-store ids); kernel `setCallerConversation` now respects a preset identity ("first proof wins"), so browser tool calls record under their own sessions instead of Unattributed; `executeBrowserTool` validates the key shape and refuses malformed ones.
- [x] Hardening: double-extension conflict guard; result-anchor relabeling pass in the content script; Settings UI for the new config section remains renderer work.

**Deliverables (chat-on-steroids tree, uncommitted)**
- `src/shared/types.ts` + `src/main/config.ts` — `browserConnectors` config section (enabled/autoExecute/autoSubmit, zod defaults).
- `src/main/providers/browser-connectors.ts` — `browserEnablement()` + `browserHealthProbe()` projections.
- `src/main/providers/browser-tools.ts` — conversation-key validation (`siteId--segment`).
- `src/main/session/blocked-chats.ts` — connector key separator `--` + docs.
- `src/main/mcp/kernel.ts` — `setCallerConversation` first-proof-wins guard (critical correctness fix: browser-call identity was being erased to Unattributed).
- `src/main/bridge.ts` — `GET/POST /browser/settings`, `GET /browser/health`, `POST /browser/block`, block-route key join.
- `extension/browser-connector.js` — `--` keys, app-settings fetch with storage fallback, SA conflict guard, result relabeling.
- `extension/background.js` — `cos-browser-settings` handler.
- Tests: `test/browser-settings.test.ts` (5), `test/browser-blocked.test.ts` (4), Phase 1 files updated to the new key format. Suite: **2875 passed / 0 failed / 100 skipped**; typecheck clean.

**Dependencies:** Phase 1.
**Risks:**
- Compaction quality depends on each site's model writing a good brief.
- Worker identity on non-ChatGPT sites is heuristic (URL-scoped) — keep agent tools off where proof is weak (CoS already fail-closes `[CONFIRMED]`).
- More sites = more maintenance surface.

**Success criteria:** compact+resume works on at least two non-ChatGPT sites; workers spawn/message/finish on one browser provider; blocked chats work across providers; zero regressions in ChatGPT e2e.
*(Workers item resolved as fail-closed by design; compact+resume generalization remains the open success criterion.)*

**Rollback:** feature flags per subsystem (`compaction.browser`, `agents.browser`); Phase 1 connectors keep working standalone; ChatGPT-native path remains isolated throughout.

---

## Phase 3 — API connectors — built, tested, DEPRECATED (browser path only going forward)

> **Status per the 2026-09-07 product decision:** the API path is **slated for future removal**. It is fully built and tested, does not interfere with the browser path, and stays in the codebase until a removal task is scheduled. **No further investment**: no per-provider key slots, no usage-meter wiring, no more provider catalogs.

**What was built (complete)**
- `src/main/providers/api-catalog.ts` — provider catalog: OpenAI-compatible family (OpenRouter, DeepSeek, Moonshot/Kimi, Zhipu/GLM, Qwen/DashScope) with base URLs + known models; Gemini marked `unsupported-shape` (not wired); honest `openai-native`/`unknown` flags; `API_WRITE_TOOLS`; per-model tool allowlist helper. Only OpenRouter has a wired key slot today.
- `src/main/providers/api-transport.ts` — `registerApiConnectors` (all catalog providers, disabled); `ApiConversationSession` (full `ConversationSession`: SSE streaming, native `tool_calls` accumulation, 16-round tool loop, usage capture, abort/stop, message budget, per-session `allowWrite` + `toolModelsAllowlist`); `executeApiTool` (kernel entry via `dispatchWithKnownCaller`, transport key `api:<connector>`, write-tools gate).
- `src/main/providers/api-sessions.ts` — `ApiSessionManager` (create/list/close; key resolved at creation, never exposed).
- `src/main/ipc.ts` — `api:connectors`, `api:models`, `api:session:create` (event streaming to the window on `api:event`), `api:session:send`, `api:session:close`.
- `src/preload/index.ts` — `apiConnectors/apiModels/apiSessionCreate/apiSessionSend/apiSessionClose/onApiEvent`.
- `src/renderer/api-chat.ts` + `index.html` + `main.ts` — the **API chat panel**: provider/model pickers, OpenRouter key field (reuses `secret:set` `openRouterApiKey`), write-access toggle (default off), streaming timeline (tokens, tool calls, boundaries, errors) via `api:event`.
- Tests: `test/api-catalog.test.ts` (5), `test/api-transport.test.ts` (6, updated for the new signature). Suite: **2890 passed / 0 failed / 100 skipped**; typecheck clean.

**Bugs caught by the suite and fixed**
- ESM import cycle (kernel→bridge→browser-tools→tools→tools-desktop→kernel) — fixed with call-time dynamic imports.
- Duplicate element id (`apiKey` → `apiProviderKey`) — caught by the duplicate-id renderer test.
- CSS-style `$('#id')` lookups against the repo's bare-`getElementById` `$()` helper — caught by 24 renderer-state failures.
- Kernel `setCallerConversation` erasing preset browser/API identity — first-proof-wins guard.

**Known honest limits**
- DeepSeek/Qwen/Kimi/GLM key slots are catalog-pending (`apiKeySecret: null`) — moot after removal.
- Per-provider tool-call support is `[UNKNOWN]` until verified against live APIs — moot after removal.
- The `usage()` meter data is captured but not displayed — moot after removal.

**Removal task (when scheduled):** delete `api-catalog.ts`, `api-transport.ts`, `api-sessions.ts`, their tests, the `api:*` IPC/preload routes, the `api:event` channel, the renderer API panel, and `registerApiConnectors` from `index.ts`. Keep `capturedCoreHandler` and the Phase 0 manager (used by the browser path).

---

## Phase 4 — SuperAssistant as a thin client of CoS — DROPPED

**Dropped by product decision (2026-09-07).** Was optional; nothing depends on it.

---

## 4. Cross-cutting concerns

- **Security:** keep CoS's loopback-only endpoints, per-surface random path tokens, Host/Origin validation, body caps, rate limits, `safeStorage` secrets, approved-folder sandboxing, read-only kill switch `[CONFIRMED]`. Browser connectors must not weaken any of these.
- **Prompt injection:** browser connectors parse page text; keep execute/auto-execute default-off and add a per-site confirmation for first execution.
- **Testing:** extend the vitest suite per phase; add per-site DOM smoke tests (jsdom) for ported adapters.
- **Attribution honesty:** document session-scoped attribution for non-ChatGPT connectors in the UI and README.

---

## 5. Per-provider implementation checklist (Phase 1)

| Provider | Adapter ported | Render config ported | Instruction variant | Result anchor | Status |
|---|---|---|---|---|---|
| Gemini | [x] | [x] | XML/JSONL | `div.query-content` | [x] |
| DeepSeek | [x] | [x] | XML/JSONL | `div._9663006` (hash class — high breakage risk) | [x] |
| Kimi | [x] | [x] | XML/JSONL | `div[class*="user-content"]` | [x] |
| Perplexity | [x] | [x] | XML/JSONL | `div.group\/query` | [x] |
| Grok | [x] | [x] | XML/JSONL | `div.relative.items-end` | [x] |
| AI Studio | [x] | [x] | XML/JSONL | `ms-text-chunk.ng-star-inserted` | [x] |
| OpenRouter Chat | [x] | [x] | XML/JSONL | `div[data-testid="user-message"]` | [x] |
| T3 Chat | [x] | [x] | XML/JSONL | `div[aria-label="Your message"]` | [x] |
| GitHub Copilot | [x] | [x] | XML/JSONL | `.UserMessage-module__container--cAvvK` | [x] |
| Mistral | [x] | [x] | XML/JSONL | `div[data-message-part-type="answer"]` | [x] |
| Qwen Chat | [x] | [x] | XML/JSONL | `.user-message-text-content` (+CodeMirror accessor) | [x] |
| Z Chat | [x] | [x] | XML/JSONL | `div.chat-user` (+CodeMirror accessor) | [x] |

Selector data above is from `render_prescript/src/core/config.ts` `WEBSITE_CONFIGS` `[CONFIRMED]`.

---

## 6. Progress log

| Date | Phase | Entry |
|---|---|---|
| 2026-09-07 | — | Product decision: browser path is the product; API path (Phase 3) slated for removal; Phase 4 dropped. `how-to-use.md` written. |
| 2026-09-07 | 3 | Phase 3 complete: renderer chat view added (`api-chat.ts` + panel + sidebar button + `showTab('api')`) — provider/model pickers, OpenRouter key field (reuses `secret:set`), write-access toggle, streaming timeline via `api:event`. Two bugs caught by the suite and fixed: duplicate element id (`apiKey` → `apiProviderKey`, caught by the duplicate-id test) and CSS-style `$('#id')` lookups against the repo's bare-`getElementById` `$()` helper. Suite 2890 passed / 0 failed / 100 skipped; typecheck clean. |
| 2026-09-07 | 3 | Phase 3 completed: provider catalog (OpenAI-compatible family + Gemini flagged honest), provider-parametric transport with usage capture + model allowlist + write-tools gate (default read-only), session manager, IPC + preload surface (`api:connectors/models/session:*` + `api:event`). Suite 2890 passed / 0 failed / 100 skipped. |
| 2026-09-07 | 3 | Phase 3 core done: OpenRouter API transport (native tool_calls via SSE, tool loop through the CoS kernel), `ApiConversationSession`, shared `capturedCoreHandler`, registered in manager. |
| 2026-09-07 | 2 | Phase 2 core work done: app-owned enablement (config + `/browser/settings`), health probe (`/browser/health`), connector key format `siteId--segment` + session recording (kernel first-proof-wins fix), double-extension guard, result relabeling. Suite 2875 passed / 0 failed / 100 skipped. Remaining (design-gated): Compact & Resume generalization (needs live-site runtime validation) and workers on browser providers (fail-closed by identity design); Settings UI + selector-rotation alerts are renderer work. |
| 2026-09-07 | 2 | Phase 2 started. Slice 1 done: connector-scoped blocked chats (`setConnectorChatBlocked` + `POST /browser/block` + 4 tests). |
| 2026-09-07 | 1 | Phase 1 done: browser-connector engine ported (13 sites, default-off), kernel seam (`dispatchWithKnownCaller` + handler capture), bridge `/browser/catalog` + `/browser/execute`, extension content script + manifest + background handlers. Suite 2866 passed / 0 failed / 100 skipped; typecheck clean. ESM cycle fixed via lazy imports. |
| 2026-09-07 | 0 | Phase 0 done: shared contracts + data-only registry + ChatGPT connector #1 registered + 6 tests; full suite 2852 passed / 0 failed / 100 skipped; typecheck clean. Changes live in the chat-on-steroids working tree (uncommitted). |
| 2026-09-07 | — | Blueprint created from the two audits (MCP-SuperAssistant + Chat On Steroids). |

---

## 7. Sequencing rule

Phases 0 and 1 landed in order; Phase 2's remaining work (compact/resume generalization, composer→browser delivery, auto-open, Settings UI) is the next priority. Phase 3 is complete and deprecated — schedule its removal as a standalone task; do not extend it. Phase 4 is dropped.
