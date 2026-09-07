# Chat On Steroids — Browser Path: How To Use

> **Product direction (decision 2026-09-07):** the **browser path** is the product. It gives free web chats tool access with no API keys and no per-token cost. The API path (Phase 3) is built but **slated for removal** — do not invest further in it; new work goes into the browser path only.

This guide covers **only the browser path**: giving a free AI website's chat real tools (read files, run commands, patch code) through Chat On Steroids, using the same loop MCP-SuperAssistant pioneered.

---

## 1. What the browser path is

```
You chat in the website (DeepSeek, Gemini, Kimi, Qwen, GLM/Z, …)
        │  the site's model prints a ```jsonl tool-call block
        ▼
CoS extension (content script) detects it in the page
        │  "Run" button (or auto-execute)
        ▼
CoS app kernel executes the tool (roots, permissions, read-only all apply)
        │  result wrapped as <function_result call_id="N">
        ▼
Extension types the result back into the chat input
        ▼
The model sees the result and continues
```

- **No API keys.** No API requests. The only credential is your logged-in browser session on the site.
- **All tool permissions are CoS's**: approved folders, per-capability switches, the read-only kill switch.
- **The model pays with the site's own free limits**, nothing else.

---

## 2. What you need up front

1. **The Chat On Steroids app** running (tray app) with:
   - a **project folder approved** in Settings → Workspace, and
   - the tool permissions you want (defaults are fine).
2. **The companion Chrome extension** loaded:
   - open `chrome://extensions` → Developer mode → **Load unpacked** → select the app's `extension/` folder.
   - (This single extension serves ChatGPT **and** every browser connector site.)
3. **Chrome** with the target site open **and you logged in** — e.g. `chat.deepseek.com` with your DeepSeek account.

---

## 3. Sites supported (browser path)

| Site | Connector | Notes |
|---|---|---|
| chatgpt.com / chat.openai.com | `chatgpt-browser` | Native MCP path (the original CoS flow), always on |
| gemini.google.com | `browser-gemini` | |
| perplexity.ai | `browser-perplexity` | |
| grok.com | `browser-grok` | |
| x.com /i/grok | `browser-grok-x` | |
| aistudio.google.com | `browser-aistudio` | |
| openrouter.ai | `browser-openrouter` | |
| chat.deepseek.com | `browser-deepseek` | |
| t3.chat | `browser-t3chat` | |
| github.com/copilot | `browser-copilot` | |
| chat.mistral.ai | `browser-mistral` | |
| kimi.com | `browser-kimi` | |
| chat.z.ai (GLM) | `browser-z` | needs CodeMirror accessor |
| chat.qwen.ai | `browser-qwen` | needs CodeMirror accessor |

**By default every browser connector is OFF.** You must enable each site you want (step 4). This is deliberate: nothing parses any page until you turn it on.

---

## 4. Enabling a site (interim method, before the Settings UI lands)

The Settings screen does not expose the per-site toggles yet — this is the one interim step until that UI is built. Choose either:

**Option A — app config file** (recommended while the UI is pending):
1. Quit the app. Open its config file in a text editor:
   - Windows: `%APPDATA%\chat-on-steroids\config.json`
   - macOS: `~/Library/Application Support/chat-on-steroids/config.json`
   - Linux: `${XDG_CONFIG_HOME:-~/.config}/chat-on-steroids/config.json`
2. Add (or edit) the section, listing the sites you want on:
   ```json
   "browserConnectors": {
     "enabled": {
       "browser-deepseek": true,
       "browser-qwen": true,
       "browser-kimi": true,
       "browser-z": true
     },
     "autoExecute": false,
     "autoSubmit": false
   }
   ```
3. Save, relaunch the app, reload the extension (`chrome://extensions` → Reload) so it re-reads settings.

**Option B — extension storage** (only takes effect if the app's bridge is unreachable; treat as fallback): in the DevTools console of the site, run
```js
chrome.storage.local.set({ cosBrowserConnectors: { 'browser-deepseek': true, autoExecute: false, autoSubmit: false } });
```
then reload the page.

> When the app answers, app settings win. Keep the two in agreement.

---

## 5. Using it, step by step

1. **Open the site and log in** (e.g. chat.deepseek.com). Keep it in the foreground tab.
2. The extension adds a small **floating “MCP” button** (top-right of the page).
3. Click **MCP** — this types the tool instructions (the tool list from CoS, in the ```jsonl format) into the site's chat input.
   - The button briefly shows “Inserted ✓”.
   - Do this in every new conversation you want tool-enabled; the site does not remember it across chats.
4. **Chat normally.** Ask something like: *"read the file at /work/notes.txt and tell me what's in it"* (paths are virtual under your approved root, e.g. `/work/...` with `work` = the root name).
5. When the model decides to call a tool, it prints a ```jsonl block:
   ```jsonl
   {"type":"function_call_start","name":"read","call_id":1}
   {"type":"description","text":"Read notes.txt"}
   {"type":"parameter","key":"paths","value":["/work/notes.txt"]}
   {"type":"function_call_end","call_id":1}
   ```
   The extension renders it as a small card with a **Run** button (and the parsed arguments).
6. Click **Run**:
   - the call goes to the CoS kernel (approved roots, permissions, read-only all enforced);
   - the result is typed back into the chat input wrapped in `<function_result call_id="1">…</function_result>`.
7. Click **Send** (or, if you enabled `autoSubmit`, it sends automatically) — the model reads the result and continues.
8. Repeat. Each tool call also lands in the **CoS app timeline** (sessions/timeline), so you have a recorded transcript of what ran and what it returned.

---

## 6. Settings that matter

| Setting | Where | Effect |
|---|---|---|
| `autoExecute` | `browserConnectors` config | Run detected tool calls automatically instead of clicking Run. **Keep off until you trust the site** — page text can be crafted to look like a tool call. |
| `autoSubmit` | `browserConnectors` config | Auto-send the chat input after a result is typed back. |
| Read-only mode | CoS Settings (global) | Refuse every mutating tool across all connectors. |
| Permissions | CoS Settings → tool groups | Per-tool capability switches (read / edit / command / …). |
| Approved folders | CoS Settings → Workspace | The only paths tools can touch. |

Prompt-injection warning: browser connectors parse page text. Keep `autoExecute` off and read what the model calls before running it, especially on conversations whose content you don't fully control.

---

## 7. What is NOT in the browser path yet (honest gaps)

- **Typing from the CoS app composer into non-ChatGPT sites.** For browser connectors you type in the site's own input. (The CoS composer currently drives ChatGPT and the API path.)
- **Auto-opening / navigating** to the site. You open and log in yourself.
- **Compact & Resume on non-ChatGPT sites.** The “limit hit → summary → new chat → continue” loop is ChatGPT-only for now (and even there it is CoS's existing feature). Design-gated, not built for browser connectors.
- **Settings UI** for the per-site toggles — use step 4's interim method until it lands.

These are the next browser-first work items. Everything in steps 1–8 **works today**.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| No floating MCP button | Site not enabled (step 4) or extension not loaded/reloaded. Check `chrome://extensions`. |
| Button appears but inserts nothing | Try the fallback selectors by refreshing the page; if still nothing, the site's input selector changed (report it). |
| Tool call rendered but Run fails | Connection to the app: is the tray app running? Check CoS Activity/Setup for bridge status. |
| “UNKNOWN_TOOL” | The tool's permission is off in CoS, or the site model invented a tool name — retry with a listed tool. |
| “WRITE_TOOLS_DISABLED” | (API path only, write opt-in off.) Not applicable to the browser path. |
| Result typed but model doesn't continue | Press Send if autoSubmit is off, or check the site's own send button. |
| Site updated its UI and nothing works | The per-site selectors rotted; this is the known maintenance cost of the browser path. |
