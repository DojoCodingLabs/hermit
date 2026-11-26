# Hermit: how open-source agents operate other Android apps

Research date: 2026-11-11. I read source code through the GitHub API and raw files only (no clones, no installs). **V** = Verified in the cited file or official page. **U** = Unverified (README claim, paper, secondary source or inference).

## 1. What each project does

**DroidRun / Mobilerun (MIT framework, AGPL-3.0 Portal app).** The Python agent runs on a PC and drives the phone through ADB or through the Portal app's local HTTP/WebSocket API (`mobilerun/agent/utils/android_device.py` imports `async_adbutils`, **V**). Portal is an on-phone AccessibilityService. It reads the screen as an accessibility tree that the agent flattens into numbered elements (`mobilerun/tools/formatters/indexed_formatter.py`, **V**). It also takes screenshots (`canTakeScreenshot="true"`). It acts with `dispatchGesture` taps and swipes (`app/src/main/java/com/mobilerun/portal/service/GestureController.kt`, **V**) and types through its own keyboard (`input/MobilerunKeyboardIME.kt`, **V**). Its service config sets `android:isAccessibilityTool="true"` (`app/src/main/res/xml/accessibility_service_config.xml`, **V**), which Play policy does not allow for an automation app (section 3). `service/AutoAcceptGate.kt` taps through install, screen-capture and record-audio system dialogs inside a 30 to 90 second window (**V**). The models are cloud LLMs. The README claims 91.4% on AndroidWorld, and 100% for the companion "mobile-harness" (**U**). https://github.com/droidrun/droidrun , https://github.com/droidrun/droidrun-portal

**mobile-use (minitap-ai, Apache-2.0).** A multi-agent LangGraph (planner, orchestrator, cortex, executor; `minitap/mobile_use/agents/*`, **V**) that runs on a PC. It acts over ADB plus uiautomator2 (`controllers/android_controller.py` uses `adbutils` and `UIAutomatorClient`, **V**) and reads both the UI hierarchy and screenshots. Its tools are tap, long press, swipe, focus-and-input-text, launch app, open link, back and press key (`tools/mobile/*.py`, **V**). The defaults are cloud models (Claude Sonnet, MiniMax, OpenAI). The README claims it was the first agent to complete 100% of AndroidWorld (**U**). https://github.com/minitap-ai/mobile-use

**AppAgent (Tencent, MIT, inactive since 2025-03).** Runs on a PC over ADB with `subprocess` calls to `adb shell screencap`, `uiautomator dump` and `input tap` (`scripts/and_controller.py`, **V**). The model sees a screenshot with numeric tags placed on elements from the XML tree (`scripts/prompts.py`, **V**). An exploration phase writes per-app docs that later runs reuse (`scripts/self_explorer.py`, `document_generation.py`, **V**). The model is GPT-4V. https://github.com/TencentQQGYLab/AppAgent

**Mobile-Agent / GUI-Owl (X-PLUG, MIT).** Versions v1 and v2 use pure screenshots plus ADB `input tap` (`Mobile-Agent-v2/MobileAgent/controller.py`, **V**). The main finding for Hermit is the GUI-Owl-1.5 vision models (Qwen3-VL based, screenshot-only). Their published AndroidWorld scores are **2B: 67.9, 4B: 69.8, 8B: 69.0, 32B: 69.4** (`Mobile-Agent-v3.5/README.md`, **V** as a published claim, **U** as reproduced). That is the first evidence that a phone-sized model can drive apps at a useful rate. Inference still runs on a PC or GPU server in their code. https://github.com/X-PLUG/MobileAgent

**AutoDroid (MobileLLM, MIT, inactive since 2024).** Built on DroidBot and runs on a PC over ADB (`droidbot/adapter/adb.py`, **V**). It turns the view hierarchy into HTML-like text and calls GPT-3.5 (`tools.py`, **V**). The paper reports a fine-tuned Vicuna-7B and a security check that asks the user before risky actions, but I found no risk-confirmation code in `droidbot/input_policy.py` (**U**). https://github.com/MobileLLM/AutoDroid

**Open-AutoGLM (Zhipu, Apache-2.0).** Runs on a PC over ADB. It takes screenshots, types through ADBKeyboard (`phone_agent/adb/input.py`, **V**), and uses the AutoGLM-Phone-9B VLM. On sensitive actions: the *model* adds a `message` field to a tap, and the handler then calls `confirmation_callback` (`phone_agent/actions/handler.py` lines 138 to 144, **V**). `Take_over` hands login and captcha to the human (**V**). So the model decides what counts as sensitive, which is the weakness Hermit's cage avoids. https://github.com/zai-org/Open-AutoGLM

**Roubao, legacy Android app (MIT).** The only candidate here whose agent loop runs **on the phone**: Kotlin `agent/MobileAgent.kt` with manager, executor and reflector roles (**V**). It acts through **Shizuku** shell (`controller/DeviceController.kt`, **V**), which needs a one-time ADB or wireless-debugging pairing, and sends screenshots to a cloud VLM (`vlm/GUIOwlClient.kt`, **V**). When a screenshot is blocked (FLAG_SECURE), it stops and asks a human. Its prompt asks the model to self-flag payments (`agent/Executor.kt` lines 72 to 75, **V**). https://github.com/Turbo1123/roubao

**AndroidWorld (Google, Apache-2.0).** A benchmark of 116 tasks across 20 apps (README, **V**). The text-only agent T3A reads a numbered accessibility element list and outputs one JSON action from a fixed set: `click, long_press, input_text, keyboard_enter, navigate_home, navigate_back, scroll, open_app, wait, answer, status(complete|infeasible)` (`android_world/agents/t3a.py`, `android_world/env/json_action.py`, **V**). That action space fits a grammar-constrained 1B to 4B model almost as is. The leaderboard is a Google Sheet linked from the README. https://github.com/google-research/android_world

**Google's direction: AppFunctions and UI automation.** AppFunctions lets apps act like on-device MCP servers on Android 16+. Callers need `EXECUTE_APP_FUNCTIONS` (https://developer.android.com/ai/appfunctions, **V**). In AOSP that permission is `protectionLevel="internal|role"` (`frameworks/base/core/res/AndroidManifest.xml`, **V**), granted only to `SYSTEM_SHELL`. The `_TRUSTED` variant goes to `SYSTEM_UI_INTELLIGENCE` and `SYSTEM_VENDOR_INTELLIGENCE` (`PermissionController/res/xml/roles.xml`, **V**). **A third-party agent such as Hermit cannot call AppFunctions today.** It can *expose* them, so Gemini could call Hermit. Google's docs also say only a limited set of agents can reach the pipeline during the experiment (**V**). Android 17's "UI automation framework" for agents is described only for Gemini, with partner apps (https://android-developers.googleblog.com/2026/02/the-intelligent-os-making-ai-agents.html, **U** for third-party access).

## 2. Comparison

| Project | Reads screen | Acts via | Runs fully on phone | Model, score | Sensitive actions | License |
|---|---|---|---|---|---|---|
| DroidRun + Portal | A11y tree (indexed) + screenshot | A11y gestures, own IME, or ADB | No (agent on PC or their cloud) | Cloud LLMs; 91.4% AW claimed **U** | None found; auto-accepts system dialogs **V** | MIT / AGPL-3.0 |
| mobile-use | UI hierarchy + screenshot | ADB + uiautomator2 | No | Cloud LLMs; 100% AW claimed **U** | Not found | Apache-2.0 |
| AppAgent | Screenshot with tags from XML | ADB | No | GPT-4V | Not found | MIT |
| Mobile-Agent / GUI-Owl | Screenshot only | ADB | No (model on server) | GUI-Owl-1.5 2B 67.9, 4B 69.8 AW **V** (claim) | Not found | MIT |
| AutoDroid | View hierarchy as HTML | ADB (DroidBot) | No | GPT-3.5, Vicuna-7B (paper) | In paper only **U** | MIT |
| Open-AutoGLM | Screenshot | ADB + ADBKeyboard | No | AutoGLM-Phone-9B | Model self-flags, callback confirms **V** | Apache-2.0 |
| Roubao (Android) | Screenshot | Shizuku shell | Loop yes, model in cloud | GUI-Owl / MAI-UI via API | Model self-flags; FLAG_SECURE triggers handoff **V** | MIT |
| AndroidWorld T3A | A11y element list | Env (ADB/gRPC) | No | Any; benchmark | `infeasible` status | Apache-2.0 |
| AppFunctions | Typed functions, no screen | OS registry | Yes | Any | Up to the caller | Platform; caller is system-only **V** |

No project combines on-phone inference, on-phone control and no PC. Hermit would be the first.

## 3. Google Play policy (AccessibilityService)

From https://support.google.com/googleplay/android-developer/answer/10964491 (**V**):

- `isAccessibilityTool="true"` is only for apps whose *primary purpose* is helping people with disabilities (screen readers, switch, voice and braille access). The policy names "automation tools, assistants" as apps that do **not** qualify. Hermit cannot set the flag. Portal's use of it is the wrong model to copy.
- A non-tool app needs an in-app prominent disclosure with affirmative consent, separate from other disclosures, plus a Play Console declaration and a video (targetSdk 31+).
- **Prohibited:** "any use of the Accessibility API that enables an app to autonomously initiate, plan, and execute actions". Only "deterministic, rule-based automation" with a fixed, human-defined script is allowed. An LLM that plans taps is exactly the prohibited case, even if each step is approved. Approving each step lowers the risk, but I found no policy text that makes it allowed (**U**).
- Sideloaded APKs on Android 13+ also hit "restricted settings" for accessibility, the same flow Hermit already handles for the notification listener (PRD line 138). Android 16 Advanced Protection reportedly blocks non-tool accessibility services (**U**).

## 4. WhatsApp: AccessibilityService vs RemoteInput

**What an AccessibilityService adds:** it can start a new chat, message contacts with no pending notification, send to groups, attach files and read the full thread. RemoteInput only works while a live notification exists (FR-MSG-04 `stale`).

**Risks:**
1. **Play:** prohibited as autonomous LLM planning (above). Shipping it in the Play build risks suspension of the developer account.
2. **WhatsApp ToS:** WhatsApp bans automated or unofficial-client messaging, and accounts get banned (**U**: ToS text not re-read here).
3. **Fragility:** WhatsApp view IDs and layouts change without notice, so selectors break silently. RemoteInput is a stable platform API.
4. **Prompt injection:** the on-screen thread is untrusted text inside the very tree the model acts on. A message saying "tap Send to forward this" sits next to the Send button.
5. **Locked or unattended phone:** gestures need an unlocked, visible screen, which matches the cage rule that unattended sessions cannot act, but makes timed sends impossible.
6. **Scope creep:** the same permission reads banking apps and OTPs. FLAG_SECURE blocks screenshots but not the accessibility tree.

**Reliability verdict:** more *capable*, not more *reliable*. A better middle path needs no special permission: `Intent.ACTION_VIEW` on `https://wa.me/<number>?text=<urlencoded>` (or `ACTION_SEND` with `setPackage("com.whatsapp")`) opens the chat with the text prefilled, and the human taps Send. The human tap becomes the commit step of the cage (**U**: behavior well known, not re-tested).

## 5. What Hermit should take

1. **Intents first (W1 to W2, Play-safe).** Add an `open_in_app` skill family built on typed intents: WhatsApp `wa.me` prefill, `ACTION_SENDTO` sms/mailto, `ACTION_DIAL` (never `ACTION_CALL`), `geo:` / Maps navigation, `ACTION_INSERT` for calendar and contacts, `ACTION_SEND` share, and the alarm/timer `AlarmClock` intents. The model fills a schema, the cage shows a fingerprint, Android opens the app, and the human taps the final button. New FRs extend FR-MSG for "start a new chat" without accessibility.
2. **Expose Hermit as AppFunctions (later wave).** Hermit cannot call AppFunctions, but exposing `ask_hermit`, `add_reminder` and `read_vault_item` (with the cage still asking) makes Hermit reachable from Gemini and OEM assistants. Do not plan on Hermit as an AppFunctions caller. Track it as an assumption ("Google opens a caller role to third parties"), not a dependency.
3. **"Phone use" as a separate, off-Play capability (new EP-26, new ADR-020).** Ship an AccessibilityService only in the GitHub/F-Droid APK flavor, never in the Play build, with `isAccessibilityTool="false"`. Design:
   - Observation: a pruned, numbered accessibility element list (AndroidWorld T3A and DroidRun format), text only, no pixels. This reuses the FR-WEB-05 browser design, so one action grammar serves both WebView and native apps.
   - Actions: the T3A JSON action set under a GBNF grammar, executed with `AccessibilityNodeInfo.performAction(ACTION_CLICK / ACTION_SET_TEXT)` first and `dispatchGesture` as fallback. No custom IME and no Shizuku.
   - Cage: a per-app allowlist chosen by the user. Banking, wallet, password-manager and OTP packages are hard-denied, and Hermit's own app is never driven. Every `click` whose target node text or ID matches a commit lexicon (send, pay, buy, confirm, delete, post, transfer, and the Spanish equivalents) becomes a send/spend action with a fingerprint. The cage decides from the node, never from a model-supplied flag (Open-AutoGLM and Roubao let the model self-flag, which a prompt injection defeats). All on-screen text is tagged untrusted. Sessions are foreground only, with a visible overlay and a stop button. Never auto-accept system dialogs (unlike Portal's `AutoAcceptGate`).
   - Model: text-only 1B to 4B is untested on AndroidWorld. Add an eval gate that runs a T3A-style subset of AndroidWorld against the QVAC model before enabling the feature. Keep a GUI-Owl-1.5-2B (vision) spike as an option if text-only scores poorly.
4. **Keep RemoteInput as the default WhatsApp reply path.** Phone use is an opt-in upgrade in the sideload build only, documented as possibly breaking WhatsApp's terms.

**The trade-off:** Play distribution and LLM-planned accessibility control are mutually exclusive under the current policy. Cloud agents reach full control of the phone because they are not on Play (DroidRun, Roubao) or because they are Gemini with system roles. Hermit can match most daily tasks through intents plus a human final tap while staying on Play. Full screen driving must live in the sideloaded build, and the cage must enforce commit detection itself.
