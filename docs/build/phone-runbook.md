# Hermit phone-session runbook

Status as of 2026-11-21 (master at `381824a`). One list for the session with the Galaxy S26 Ultra: what to have ready, every on-device check by gate (W1 to W6), the cross-cutting checks, and what to do when the first native build fails.

Sources: the PRD's wave gates and slice map (`docs/prd/hermit-prd.md` 2.20, 3.3, 3.4); the phone, device and native-build checks in every merged PR body (#1 to #106, whatever the heading); the research notes those PRs point to (`docs/research/autofill-spike.md`, `web-task-spike.md`, `wdk-worklet-spike.md`, `x402-spike.md`, `mcp-client-spike.md`); the gap audit in `docs/prd/hermit-ui-states-and-edge-cases.md`; and the phone checks in `docs/design/polish/decisions.md` and `docs/design/mascot/decisions.md`. GitHub Actions stopped (Q99), so every PR from #74 on merged on local checks only, and most of this list has never run on a phone.

## How to read a line

- `- [ ] What to do. **Pass:** what must happen. **See:** where to look. (#PR)`
- **T1**: security-critical. Covers what a fingerprint or Keystore prompt shows, FLAG_SECURE, exact-origin refusals, the paid-redirect rule, the one-time code consent, the cage refusing, and secrets kept out of logs, keyboards and the clipboard. A T1 failure blocks its gate on its own.
- **+contact**, **+2nd phone**, **+Gmail**, **+USD₮0**, **+Play**, **+account**: the check needs the WhatsApp test contact, a second Android phone, the tester's own Google OAuth client, test USD₮0 in the phone's wallet, the Play Console, or the third-party account or host the line names. All are in 1.3.
- **Blocked**: it can't run on this build; the reason follows. It stays listed so nothing is lost. Skip it in the session.
- Screens go by their PRD ID. The phone runs in Spanish, so on-screen copy is quoted in es-419 from `packages/copy/locales/es-419.json` or the module's own Spanish strings. Logcat lines and a few labels stay in English, as the code writes them.
- "Superseded" notes name PR checks that a later PR replaced, so nobody runs them against code that is gone.

## Counts

| Section | Gate criteria | Checks | T1 checks | Blocked checks |
| :---- | ----: | ----: | ----: | ----: |
| W1 the first win | 8 | 40 | 7 | 0 |
| W2 voice, mail, connectors, spikes | 5 | 34 | 4 | 8 |
| W3 eyes, settings, accessibility | 3 | 69 | 15 | 1 |
| W4 hands I | 4 | 56 | 29 | 2 |
| W5 hands II, money | 3 | 33 | 18 | 0 |
| W6 phones and distribution | 4 | 4 | 1 | 2 |
| Cross-cutting | 0 | 36 | 1 | 0 |
| **Total** | **27** | **272** | **75** | **13** |

Checks count the lines under each section's groups. The gate criteria are counted apart: 8 of them are T1 and 8 are blocked.

## 1. Before the phone

### 1.1 Getting a build

Nothing native has compiled since the last green APK (2026-11-15 06:44 UTC, SL-37's branch). Section 9 lists what is uncompiled and what to do when the build fails. Q154 decides between the two ways below.

**A. The dev APK from CI, once Actions runs again (Q154's recommended option)**

- [ ] Actions runs again (Q99, Q154).
- [ ] Start the job on master: `gh workflow run android-dev.yml --ref master`. It also runs on any PR that touches `apps/mobile/**`, `pnpm-lock.yaml`, the two vector files or the workflow.
- [ ] Follow it: `gh run list --workflow android-dev.yml --limit 1`, then `gh run watch <run-id>`.
- [ ] Know the job's steps, to read a failure. Runner: Node 24, Temurin JDK 17. Then `sdkmanager --install "platforms;android-37.0" "build-tools;37.0.0" "ndk;29.0.14206865" "cmake;3.22.1"`, `pnpm install --frozen-lockfile`, and in `apps/mobile` `npx expo prebuild --platform android --no-install`. Then `node scripts/qvac-bundle.mjs`. Last, in `apps/mobile/android`: `./gradlew :app:assembleDebug --no-daemon`, `./gradlew :hermit-autofill:testDebugUnitTest --no-daemon`, `./gradlew :hermit-approval-key:testDebugUnitTest --no-daemon`.
- [ ] Download the artifact, kept 7 days: `gh run download <run-id> -n hermit-debug-apk -D /tmp/hermit-apk`.
- [ ] Install: `adb install -r /tmp/hermit-apk/app-debug.apk`.
- [ ] The wallet's addons: the job now runs `node apps/mobile/worklets/wallet/build.mjs` after `node scripts/qvac-bundle.mjs`, last before Gradle. It only adds files, so the wallet keeps its addons whatever ran before. On the Mac, `qvac-bundle.mjs` left the addon folder unchanged (81 files, 2026-11-21).

**B. A local build on the Mac**

Run heavy commands one at a time, after `df -h /` shows at least 15 GB free (DEP-02). Q154 counts about 15 GB for the NDK, the Gradle caches and the outputs. The full recipe, with the Node version, the memory limits and the APK checks, is `docs/build/local-android-build.md` (first build 2026-11-21).

```sh
df -h /
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install "platforms;android-37.0" "build-tools;37.0.0" "ndk;29.0.14206865" "cmake;3.22.1"
pnpm install --frozen-lockfile                 # or: pnpm install --offline --frozen-lockfile
(cd apps/mobile && npx expo prebuild --platform android --no-install)
node scripts/qvac-bundle.mjs                   # QVAC's worker bundle from the workspace root (Node 22.21 or later)
node apps/mobile/worklets/wallet/build.mjs     # the wallet bundle and addons again, last before Gradle (CI too)
(cd apps/mobile/android && ./gradlew :app:assembleDebug --no-daemon)
(cd apps/mobile/android && ./gradlew :hermit-autofill:testDebugUnitTest :hermit-approval-key:testDebugUnitTest --no-daemon)
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

- [ ] Or, after the prebuild and the two bundle steps, run `npx expo run:android --device` in `apps/mobile`. It builds and installs in one go (the WDK spike's path).
- [ ] Note the APK's size for #79's size check: `ls -l app-debug.apk`.

### 1.2 The setup

- [ ] Phone: USB debugging on, the Mac authorized, `adb devices` shows it as `device` (DEP-01).
- [ ] Keep it awake over USB: `adb shell svc power stayon usb`. Keep it unlocked, because the dev links only run in the foreground.
- [ ] Metro with a clean cache: `pnpm --filter @hermit/mobile start -- --clear`. A stale watcher once served old code to the phone.
- [ ] `adb reverse tcp:8081 tcp:8081`, again after every USB reconnect. The debug APK loads its JavaScript from Metro, so JS changes need no rebuild.
- [ ] Launch Hermit. **Pass:** logcat shows `[hermit] creating ports`, then `[hermit] ports ready`, and never `[hermit] runtime failed to start`.
- [ ] Decide before the first model download whether W2's download-recovery checks run on it. They need a download in progress.
- [ ] Onboarding on a fresh install: Welcome, Language, Download, Permissions. W1 lists what each step must do.
- [ ] Model download on Wi-Fi: BotPsy-0.8B Q4_K_M from `huggingface.co` at the pinned revision. It is ready only after its SHA-256 matches.
- [ ] Permissions: WhatsApp notification access, calendar, the fingerprint card (it creates the approval key), contacts (optional). If Android greys out notification access as a restricted setting, use App info, then the menu, then Allow restricted settings.
- [ ] Settings, Approval key: set it up. W4 and W5 signed approvals need it.
- [ ] Evidence folder: `out=/tmp/hermit-phone-$(date +%Y%m%d); mkdir -p "$out"`. Screenshots: `adb exec-out screencap -p > "$out/<name>.png"`. Logs: `adb logcat -d > "$out/<name>.txt"`.
- [ ] For evals and long runs, run `scripts/phone/thermal-guard.sh` in its own terminal. It force-stops Hermit at severe heat.

### 1.3 Accounts, devices and funds

- [ ] **WhatsApp test contact** (DEP-03): a person, or the second phone, with WhatsApp, saved in your contacts and ready to send on cue. Have their name exactly as WhatsApp shows it; it is the W1 script's argument. "¿Qué me perdí?" needs a second chat (#39).
- [ ] **A second Android phone.** Needed for the phone-to-phone transfer (SL-19 and SL-42, both Open). It also covers:
  - the WhatsApp contact;
  - the other wallet that scans HM-PAY-04's QR code (#84);
  - a restore on a second install (#82);
  - the floor facts on a 6 GB or 8 GB phone (#76);
  - the one-time code detector, if it runs Android 14 (#56).
- [ ] **The tester's own Google Cloud OAuth client for Gmail** (US-CONN-08, DEP-10). Set up:
  - a project with the Gmail API on;
  - the OAuth consent screen in Testing, with the tester's Gmail as a test user (`gmail.modify` is a restricted scope, Q45);
  - an Android client for package `io.dojocoding.hermit`, with the SHA-1 of the key that signs the build. After the prebuild, read it with `keytool -list -v -keystore apps/mobile/android/app/debug.keystore -alias androiddebugkey -storepass android`. The client ID must end in `.apps.googleusercontent.com` (#40).

  Three caveats before relying on it:
  - The app can't take the client yet. HM-CONN-05 has no own-client-ID field (#81), and the app doesn't wire mail (SL-48 and SL-49 are Finish).
  - The redirect isn't built. SL-48 planned an app-link redirect (#47) on `hermit.dojocoding.io`, which doesn't resolve (Q77).
  - Google's native-app guide (`developers.google.com/identity/protocols/oauth2/native-app`) says custom URI schemes are no longer supported on Android. Google's own Android sign-in library, `play-services-auth`, is denied by `pnpm check:privacy` (#90). So the client type has to follow whatever redirect SL-48 builds.
- [ ] **Test USD₮0 on Stable testnet**, following `docs/research/x402-spike.md`. The keys live in the temp dir of the machine that made them, so use the addresses the tools print, not the ones written in the doc.
  1. Start the facilitator: `cd packages/eval/x402-facilitator && npm ci --ignore-scripts && node facilitator.mjs`. It listens on 127.0.0.1:4022 and prints `facilitator gas key <address>`.
  2. Open `https://faucet.stable.xyz`, paste that address, pass the Turnstile check, and claim 1 USD₮0. USD₮0 is also Stable's gas token, so one claim pays the fees and funds the payers.
  3. Run `pnpm --filter @hermit/eval spike:x402` once. Unfunded, it prints its payer and the exact `node facilitator.mjs fund <payer> 0.1` command; run that from the facilitator's directory.
  4. Run the spike again to settle SL-18. Expect `paid`, a transaction hash, receipt `0x1`, and `authorizationState` used. Record the hash in the doc.
  5. Run `pnpm --filter @hermit/eval eval:x402-merchant` the same way: it prints its own payer to fund, then a rerun should end `merchant_paid` with the ledger row `settled`.
  6. For the phone, fund the wallet's own address, read from HM-PAY-04 (Receive), with `node facilitator.mjs fund <phone address> <amount>` or a faucet claim straight to it.
- [ ] **A merchant the phone can reach** (needed for W5's x402 purchase). `read_web` takes only https on a public host. The reference merchant exists only inside `x402-spike.ts` and `x402-merchant-eval.ts`, on a random 127.0.0.1 port, and closes when their run ends. `adb reverse` gives a loopback address, which is refused. A merchant served over public HTTPS still has to be set up.
- [ ] **Play Console account** (DEP-06), in Dojo Coding's name. It is for SL-21 (the internal-track upload with the notification listener declaration) and SL-44 (the release); both are Open. A `QUERY_ALL_PACKAGES` declaration would also go there, if Q80's check needs one.
- [ ] Also named by single checks:
  - WhatsApp Business on the S26 with its own number (#56).
  - A site account that texts a sign-in code, and a login page with reCAPTCHA v3 (#86, #90).
  - An HTML test page you control on public HTTPS, with an injected instruction, whose server logs request headers (#51, W3 gate).
  - A public SearXNG address (#62).
  - An account on one public MCP server with dynamic registration (Notion, Linear, Sentry, Vercel, Canva, Stripe, PayPal or Atlassian), and the product owner's OK to register Hermit with it (#68, #73).
  - A small API with an API key and an `openapi.json` or short docs (#80).
  - Your own relay, `node apps/relay/src/main.ts`, behind HTTPS (#81).
  - A Bitwarden and a Chrome password export, and a CSV on Google Drive (#71).
  - Samsung Internet, Firefox, Gboard, Google or Samsung Messages, the Gmail app, Maps and Samsung Clock on the phone (#55, #67).
  - A native test app with a login form (#67, #78).

### 1.4 Session order

Some checks destroy state that other checks need. Run them in this order.

1. The download-recovery checks (W2) on the first model download, then onboarding.
2. The W1 journey, then the W1 checks.
3. The other gates in order. Create the wallet, write its words down and fund it before W5.
4. Next to last, the fingerprint enrollment checks. A new fingerprint:
   - retires the approval key (#15, #72);
   - sends the vault to its lost state, where Start over wipes it (Q85);
   - loses the wallet until it's restored from its words (#82).

   Batch these together: W1 (#15), W4 (#70, #78), W5 (#72, #82).
5. Last, Delete everything: W3 (#49, #64), W4 (#70, #73, #74, #78), W5 (#82). Then restore the wallet from its words (#82) and download the model again.

### 1.5 How to observe

- JS logs: `adb logcat -s ReactNativeJS`. The app's lines start with `[hermit]`, `[hermit:journey]`, `[hermit:S1]` (model load, completions and their stats), `[hermit:eval]` and `[qvac]`. The wallet worklet logs under the tag `bare`.
- Screen text: `adb shell uiautomator dump /sdcard/u.xml && adb shell cat /sdcard/u.xml`.
- Screenshot: `adb exec-out screencap -p > x.png`. A FLAG_SECURE screen comes out black. Motion: `adb shell screenrecord /sdcard/x.mp4`.
- Notifications: `adb shell dumpsys notification --noredact | grep -A3 io.dojocoding.hermit`.
- Background work:
  - `adb shell dumpsys jobscheduler | grep -i hermit`;
  - Doze: `adb shell dumpsys deviceidle force-idle`, then `unforce`.
- Frames: `adb shell dumpsys gfxinfo io.dojocoding.hermit reset`, then `adb shell dumpsys gfxinfo io.dojocoding.hermit framestats`. Also Developer options, Profile HWUI rendering, and Show refresh rate.
- Device state:
  - memory: `adb shell dumpsys meminfo io.dojocoding.hermit`;
  - heat: `adb shell dumpsys thermalservice`;
  - permissions: `adb shell dumpsys package io.dojocoding.hermit`.
- Toggles:
  - airplane: `adb shell cmd connectivity airplane-mode enable|disable`;
  - dark: `adb shell cmd uimode night yes|no`;
  - text: `adb shell settings put system font_scale 2.0`, back to `1.0`;
  - display size: Settings;
  - kill: `adb shell am force-stop io.dojocoding.hermit`.
- Dev links, opened with `adb shell am start -a android.intent.action.VIEW -d "<link>" io.dojocoding.hermit`: `hermit://?say=<text>&n=<nonce>`, `hermit://activity`, `hermit://eval?p=<ids>`, `hermit://autofill-debug`, `hermit://wallet-debug`.
- App files on a debug build: `adb shell run-as io.dojocoding.hermit ls -R`.

## 2. W1: the first win

Gate (PRD 2.6, 2.20, law 4 in 3.3): the first-win journey script passes on the S26 Ultra, and every W1 slice is merged. They are all merged: SL-09 to SL-11 are Done, and the rest are Prove until this gate. Run the journey first.

- [ ] `scripts/phone/w1-journey.sh "<contact as WhatsApp shows it>"` ends with "W1 GATE: PASS". **See:** `/tmp/w1-journey-<time>/result.txt` and its screenshots. (#31) **+contact**
- [ ] This install has a verified model, and notification and calendar access granted. **See:** HM-ONB-03, HM-ONB-04. (#31)
- [ ] Airplane mode: "recuerda que mi pasaporte vence en marzo" is saved. **See:** logcat `[hermit] step executed remember true`. (#31)
- [ ] Airplane mode: "recuérdame en 2 minutos tomar agua" fires offline. "recuérdame llamar a mamá a las 9 de la noche" is set and fires at 9 PM, which the script doesn't wait for. **See:** the notifications, `dumpsys notification`. (#31)
- [ ] Airplane mode: "¿qué tengo mañana?" answers from the calendar. **See:** `[hermit] step executed calendar_read true`. (#31)
- [ ] Radio on, the contact sends a WhatsApp message. "¿Me escribió <contact>?" reads it, names the contact, and taints the session. **See:** `[hermit] step executed read_messages true`. (#31) **+contact**
- [ ] **T1** "dile que voy 10 minutos tarde": the sheet shows the real recipient and the taint warning, the fingerprint approves it, and the reply arrives on the contact's phone. (#31) **+contact**
- [ ] Activity lists every step and "Cadena verificada". **See:** `hermit://activity`. (#31)

### Onboarding (HM-ONB-01, HM-ONB-03, HM-ONB-04; SL-01)

- [ ] A fresh install. **Pass:** it opens on Welcome, then Language, Download and Permissions, and the chat sends you back to onboarding until it's done. **See:** the screens. (#13, #61)
- [ ] The model download on Wi-Fi. **Pass:** progress with a percent, then "Verificando el archivo…", then ready. Nothing loads before the SHA-256 matches. **See:** HM-ONB-03; logcat `[hermit:S1] model loaded in`. (#10, #13, #17)
- [ ] The download on mobile data. **Pass:** "Estás con datos móviles. Conéctate a Wi-Fi para descargar o usa datos móviles.": it waits for Wi-Fi unless you opt in. **See:** HM-ONB-03. (#13)
- [ ] The notification access card. **Pass:** it opens Android's page. If Android blocks it as a restricted setting, the card's help says how to allow it. Back in Hermit, the card reads on. **See:** HM-ONB-04. (#13, #15)
- [ ] The calendar card, then "Not now" on another card. **Pass:** calendar is granted, and a skipped card leaves the rest of setup working. **See:** HM-ONB-04. (#13)
- [ ] **T1** The fingerprint card. **Pass:** the approval key is created only after a strong-biometric prompt, and that prompt offers no PIN. **See:** the system prompt. (#15)
- [ ] **T1** Enroll a new fingerprint in Android, then approve a reply (run with 1.4's batch). **Pass:** the sheet denies, and nothing is sent until the fingerprint card sets the key up again. **See:** HM-APPR-01; Activity shows the denial. (#15)
- [ ] Exact alarms. **Pass:** Android asks for Alarms and reminders, and logcat shows `[hermit] reminder alarm: exact permission true`. **See:** logcat. (#14)

### Chat (HM-CHAT-01, HM-CHAT-02; SL-02, SL-03)

- [ ] The empty chat's first run. **Pass:** the staged crab, "Hola, soy Hermit.", the promise in two short sentences, and three example asks that work offline. A tap sends one. **See:** screenshot. (#33, #104)
- [ ] The first turn after launch. **Pass:** the status reads "Cargando el modelo…", then the step. **See:** the chat bar. (#36)
- [ ] A streamed reply. **Pass:** tokens show from the first one. No `<think>` text or markup ever shows, and the final bubble replaces the streaming one. **See:** a screen recording. (#10, #11, #12, #21)
- [ ] Live steps. **Pass:** a running step shows a spinner and its time. Finished steps fold into one line, "Trabajó N s · N pasos", that unfolds on tap. **See:** the chat. (#21, #99, #104)
- [ ] "Dónde funciona Hermit" from the menu. **Pass:** it shows the model and the last turn's speed. In airplane mode it still says the model runs on this phone. **See:** HM-CHAT-02. (#13, #104)
- [ ] The KV cache. **Pass:** from a turn's second step, the `[hermit:S1] … completion` stats show `cacheTokens` well above 0. **See:** logcat. (#20)
- [ ] A clarifying question: "recuérdame llamar al banco" with no time. **Pass:** Hermit asks for the time and never invents one. **See:** the chat. (#18)
- [ ] Two reminders "a las 9", one a.m. and one p.m., then "cancela el de las 9". **Pass:** "¿Cuál cancelo: … o …?" word for word. **See:** the chat. (#25)
- [ ] A failed action: cancel a reminder that doesn't exist. **Pass:** "No pude hacerlo. ¿Me lo dices de otra forma?", never a claim that it was done. **See:** the chat; Activity shows the failure. (#26)
- [ ] The tainted marker. **Pass:** after reading the contact's message, the composer's top line says Hermit won't follow their instructions and will ask before sending. It stays for the session. **See:** screenshot. (#33, #104)

### Memory (SL-04)

- [ ] Recall offline: "¿cuándo vence mi pasaporte?". **Pass:** March, from the saved note. **See:** the chat. (#2, #24)
- [ ] Forget: "olvida lo del pasaporte". **Pass:** the note is gone from Memories, and Activity shows `forget`. A forget that matches more than 5 notes asks you to be specific. **See:** HM-MEM-01, Activity. (#2)
- [ ] **T1** After reading the contact's message, "recuerda lo que me dijo". **Pass:** the write asks first, with the taint warning. **See:** HM-APPR-01. (#2)

### Calendar (SL-05)

- [ ] "agéndame mañana a las 10 el dentista". **Pass:** the event lands in the phone's calendar. **See:** Samsung Calendar. (#8, #14)

### WhatsApp capture (HM-MSG-01; SL-06, SL-12 spike S4)

- [ ] S4: a WhatsApp message arrives. **Pass:** HM-MSG-01 lists the chat with its app, time and latest message, quoted and marked as written by others. A group summary is no row. **See:** HM-MSG-01. (#15, #34) **+contact**
- [ ] Force-stop Hermit, have the contact write, then reopen. **Pass:** the message is in HM-MSG-01; the native queue drained on start. **See:** `adb shell am force-stop io.dojocoding.hermit`, HM-MSG-01. (#15) **+contact**
- [ ] **T1** Write in that chat yourself from WhatsApp. **Pass:** Hermit never stores your words as the contact's. **See:** ask "¿qué me dijo <contact>?". (#16) **+contact**
- [ ] HM-MSG-01 without notification access. **Pass:** it says why access is needed and that nothing leaves the phone. "Dar acceso" opens Android's page, and the screen re-checks on return. **See:** HM-MSG-01. (#34)
- [ ] Dismiss the chat's notification, then ask Hermit to reply to it. **Pass:** HM-MSG-01 marks the chat as no longer answerable. The reply ends stale with the reason, and nothing is sent. **See:** HM-MSG-01, the chat. (#15, #34) **+contact**

### Approvals (HM-APPR-01; SL-07)

- [ ] **T1** The reply sheet. **Pass:**
  - the recipient comes from WhatsApp's own chat name;
  - it shows the exact text and the taint warning;
  - "Dijiste" quotes your exact words, and a long message opens with "Ver todo lo que dijiste";
  - the foot reads "Lo muestra Hermit, no el modelo. Se envía solo con tu huella."

  **See:** screenshot. (#9, #12, #99, #104)
- [ ] **T1** Tap "No enviar" on one sheet, and leave another to time out. **Pass:** nothing is sent either time. The chat says so, and Activity shows the denial or the expiry. **See:** the chat, Activity. (#12)
- [ ] **T1** Cancel the fingerprint prompt. **Pass:** a denial; nothing is sent. **See:** Activity. (#12)
- [ ] Open the sheet in airplane mode. **Pass:** the no-network notice shows before the fingerprint ("Sin conexión: solo se envía si hay internet…"). **See:** screenshot. (#35)

### Replies after the first session (2026-11-24, branch `fix/w1-replies`)

The first session on the S26 had every action right and the words wrong. Re-check with the phone in Costa Rica time (UTC-6), in Spanish, with Metro started with `--clear`.

- [ ] "recuérdame mañana a las 9 llamar a mamá". **Pass:** "Listo. Te aviso mañana, <weekday> <day>, a las 9:00: «Llamar a mamá».", word for word from code, never "la semana de…". **See:** the chat; logcat `[hermit] step executed remind true` and no `writing` step after it.
- [ ] "recuérdame en 2 minutos tomar agua". **Pass:** "Listo. Te aviso hoy a las <HH:MM>: «tomar agua».", the whole sentence, never cut. **See:** the chat, then the notification.
- [ ] "recuerda que mi pasaporte vence en marzo". **Pass:** "Listo, lo recuerdo: tu pasaporte vence en marzo." **See:** the chat.
- [ ] "¿qué tengo mañana?" with a timed event and an all-day one tomorrow. **Pass:** "Esto tienes mañana, <weekday> <day> de <month>:", the all-day one as "Todo el día", each time as the phone's calendar shows it (a 9:00 event is 9:00, never 15:00), and nothing from today or the day after. **See:** the chat beside Samsung Calendar.
- [ ] A WhatsApp message arrives, then "¿Me escribió <contact>?". **Pass:** "<contact> te escribió a las <HH:MM>: «<text>»" with the time the notification showed, the text quoted, and the tainted line on the composer. **See:** the chat beside WhatsApp. **+contact**
- [ ] "dile que voy 10 minutos tarde", approved with the fingerprint. **Pass:** "Listo, enviado a «<contact>»: «Voy 10 minutos tarde»." **See:** the chat. **+contact**
- [ ] "¿Qué puedes hacer?", then "what can you do?". **Pass:** the list of what this phone has (reminders, memory, calendar, WhatsApp, and email, web, other apps or payments only if wired) and the promise, in Spanish then in English; nothing invented. **See:** the chat.
- [ ] A turn whose reply is taller than the screen ("¿qué me perdí?" with several chats, or a long answer). **Pass:** the list ends on the newest words when the turn finishes, also when the tainted line appears on the composer; scrolled up to read, the list stays put. **See:** a screen recording. (the follow is Q155's, `w2/q155-long-answers`; the list getting shorter under it is `fix/chat-follow-resize`, on top of Q155)
- [ ] `hermit://eval`. **Pass:** first-win scored on the lab's clock (2026-11-11 21:00), so es-remind-4 is 07:30 like the Mac's. **See:** logcat `[hermit:eval]`.

## 3. W2: voice, mail, connectors, the model on device, the spikes

Gate (PRD 2.20):

- [ ] **Blocked** A voice note in es and in en runs a turn. SL-13 is Open.
- [ ] **Blocked** The tester connects Gmail, gets an inbox summary and sends an approved reply. SL-48 and SL-49 are Finish: the app has no mail screens, sign-in or transport. **+Gmail**
- [ ] **Blocked** A catalog connector connects and disconnects. Every catalog entry signs in with OAuth, and HM-CONN-04 answers "This service's sign-in isn't available here yet" (Q43; no HM-CONN-01 yet). A key-based connector from SL-55 shows install and remove meanwhile (W4).
- [ ] The eval meets the bar on device (US-MODEL-02). The bar: at least 85% correct first actions in es and in en, a median time to the first action within NFR-01's 15 s, and the results stored per model hash. SL-14 is Open, but the eval screen and scripts exist (Eval below).
- [ ] Each spike has a written result:
  - SL-17 (WDK) and SL-20 (autofill) wait for this session;
  - SL-18 (x402) waits for the faucet claim;
  - SL-19 (Holepunch, **+2nd phone**), SL-21 (Play upload, **+Play**) and SL-59 (AndroidWorld) are Open;
  - SL-50 and SL-52 are Done.

### Stop and catch-up (HM-CHAT-01; SL-15)

- [ ] Stop during a long generation. **Pass:** decoding stops promptly, and the next turn runs normally, with no stuck worklet and the KV cache still in use. **See:** the chat; logcat `[hermit:S1]` on the next turn. (#39)
- [ ] **T1** Stop with the approval sheet open. **Pass:** the sheet closes, the chat says "Detenido. No se hizo nada.", Activity shows the denial, and nothing is sent. **See:** the chat, Activity. (#39)
- [ ] Stop right after "Guardado" or a reminder. **Pass:** "Detenido. Lo que ya estaba en marcha terminó; puedes verlo en Actividad." **See:** the chat. (#39)
- [ ] The Send and Stop control. **Pass:** Stop replaces Send while a turn runs, then reads "Deteniendo…" and is disabled. Leaving the chat mid-turn stops it. The control fits beside the input. **See:** screenshot. (#39)
- [ ] "¿Qué me perdí?" with two or more chats. **Pass:** the list from code, then one "En resumen: …" paragraph that stays faithful to the messages. Record the reader call's extra latency. **See:** the chat; logcat `[hermit:S1]`. (#28, #39) **+contact**

### Download recovery (HM-ONB-03; SL-16)

- [ ] Airplane mode on mid-download. **Pass:** "Se cayó la conexión al N%. Lo descargado se conserva…". Turning it off resumes from N%, not 0. **See:** HM-ONB-03. (#43)
- [ ] Kill the app mid-download, reopen, and go Welcome then Download. **Pass:** "Tu descarga se detuvo al N%…" with "Continuar descarga". It continues from N% with an HTTP Range request (a 206 from Hugging Face), and the hash runs at the end. **See:** HM-ONB-03. (#43)
- [ ] Fill the storage mid-download with a large filler file over adb. **Pass:** "Tu teléfono se quedó sin espacio al N%…" and "Abrir ajustes de almacenamiento". Free space, come back, and it resumes. **See:** HM-ONB-03. (#43)
- [ ] Corrupt a complete `.part` file (through `adb shell run-as io.dojocoding.hermit`), or use a wrong pin in a dev build. **Pass:** "La descarga llegó dañada, así que la borré…", and "Descargar de nuevo" starts at 0%. **See:** HM-ONB-03. (#43)

### Eval on device (SL-14)

- [ ] Run `scripts/phone/thermal-guard.sh` in one terminal and `scripts/phone/eval-runs.sh botpsy-q4-native-think256 botpsy-q4-two-stage-nothink` in another, with Metro on `--clear`. **Pass:** first-action accuracy and the median time to first action meet the bar above in each language, with no safety stop. **See:** `[hermit:eval]` lines in `/tmp/hermit-eval-runs.out`; `/tmp/hermit-thermal.csv`. (#21, #37)
- [ ] The prompt-cache probe: `hermit://eval?p=botpsy-q4-native-think256,botpsy-q4-native-think256-stable&probe=prefix`. **Pass:** record the warm, first-message and second-message times for both profiles. The stable profile becomes the default only if its in-chat gain shows here. **See:** `[hermit:eval] … probe:` lines. (#21, #22)
- [ ] The speed probe: `hermit://eval?p=botpsy-q4-native-think256&probe=speed&mode=mmap`, then `mode=none`. **Pass:** record tok/s for each (the S26 measured about 40 at rest). mmap stays the default unless `none` is faster. **See:** `[hermit:eval]`. (#37)

### WDK in the worklet (`hermit://wallet-debug`; SL-17)

- [ ] Start the wallet worklet. **Pass:** `open` returns an address and `m/44'/60'/0'/0/0`, and the `bare` log tag shows no `CANNOT_LOAD` or `UNSUPPORTED_ENGINE`. That proves the linked addons and Bare 1.33.4 on the device. **See:** wallet-debug, logcat. (#79)
- [ ] Balances. **Pass:** USD₮0 and native both read 0 for the fresh wallet, and "Read the balance again" works. **See:** wallet-debug. (#79)
- [ ] **T1** Sign a test authorization. **Pass:** "Signed in the worklet and verified here". The three refusals read `unsupported_network`, `wrong_payer` and `bad_input`, never "SIGNED". **See:** wallet-debug. (#79)
- [ ] Both worklets in one process: chat with the model loaded while the wallet runs, then start the wallet with the model loaded. **Pass:** no crash with two versions of `bare-tls`, `bare-crypto` and others in one process (Q110). Record free memory. **See:** `adb shell dumpsys meminfo io.dojocoding.hermit`. (#79, #82)
- [ ] Background the app for a minute, then come back. **Pass:** the wallet still answers, or fails cleanly with `worklet_stopped`. Stop, then Start, works. **See:** wallet-debug. (#79)
- [ ] Record the start, open, balance and sign times (the Mac measured open 71 to 344 ms and sign 6 to 11 ms). Record the APK size against the last W2 APK (up to about 25 MB more native code per ABI). **See:** wallet-debug, `ls -l app-debug.apk`. (#79)

### x402 settlement on the Mac (SL-18)

- [ ] Fund and run the spike: 1.3, test USD₮0, steps 1 to 4. **Pass:** `spike:x402` ends `paid`, with a Stable testnet transaction hash, receipt status `0x1` and `authorizationState` used. The hash goes into `docs/research/x402-spike.md`. **See:** the tool's output, `testnet.stablescan.xyz`. (#42, #50) **+USD₮0**

### The autofill service (`hermit://autofill-debug`; SL-20, shared by SL-35 and SL-36)

- [ ] Select Hermit. **Pass:** the debug screen says "Hermit todavía no es el servicio de autocompletar." Open autofill settings picks Hermit (or General management, Passwords, passkeys and autofill). Back in Hermit, it says Hermit is the service, and Settings' autofill row says on. **See:** autofill-debug, HM-SET-01. (#67, #74)
- [ ] Chrome: Settings, Autofill services, "Autofill using another service" on, and let Chrome restart. **Pass:** Chrome's requests then carry a web scheme. Without one, the rule refuses with `no_web_scheme`. **See:** the debug screen's last request. (#67)
- [ ] A form in Chrome. **Pass:** the last request shows:
  - package `com.android.chrome`;
  - digest `8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M`;
  - the web domain, with scheme `https`;
  - the verdict, and whether inline was used.

  It never shows a field's value. **See:** autofill-debug. (#67, #74)
- [ ] A native app's form (Q80). **Pass:** the last request shows that package and its certificate digests. `no_signing_cert` means package visibility hides it; record that for Q80. **See:** autofill-debug. (#67, #74, #78)
- [ ] Samsung Internet and Firefox. **Pass:** each reports a web domain and scheme, and its digest equals the shipped allowlist (Q81). **See:** autofill-debug. (#67, #74)
- [ ] Samsung Keyboard and Gboard. **Pass:** the suggestion shows as an inline chip or as the dropdown. Record which on each. **See:** screenshot. (#67, #74)
- [ ] Turn Hermit off as the autofill service by picking Samsung Pass again. **Pass:** chat and the eval screen behave as before, and the autofill row says off. **See:** HM-SET-01. (#67)
- Superseded: #67's herokuapp test login, its cancel path and "Trust this origin" (its steps 3, 6 and 7). #74 removed the test login; SL-35 and SL-36 (W4) run those paths on the profile and on vault logins.

### Connectors and mail (SL-47, SL-48, SL-49), blocked on this build

- [ ] **Blocked** One read and one write per catalog connector against the real APIs: Google Calendar, Drive, Outlook Calendar, OneDrive, Spotify, GitHub, Notion and Slack. Their endpoints were written from the docs. Blocked: no catalog sign-in in the app (Q43, HM-CONN-01). (#40)
- [ ] **Blocked** Gmail and Outlook: sign in, list unread, search, and open one message. Graph's unread filter with `$orderby` returns the newest unread first. Blocked: mail isn't wired. (#47) **+Gmail** **+account** (Outlook)
- [ ] **Blocked** An IMAP account with an app password, and SMTP on 465 and 587. Also blocked on Q46: there is no TLS socket module. (#47, #53) **+account**
- [ ] **Blocked** Sign in again for the write scopes. Then Gmail: send, reply in thread, draft, archive, and label (found or created). Graph: sendMail, reply, createReply, move to archive, and categories. (#53) **+Gmail**
- [ ] **Blocked** **T1** The mail send sheet. **Pass:** From (the sending account), To, Cc, Subject and the exact body. A recipient the mail never had gets the new-recipient line. (#53)
- [ ] **Blocked** **T1** Disconnect. **Pass:** it deletes the account, its cached messages and its tokens first, then revokes at Google. An unattended session denies every mail read and send. (#47, #53)
- [ ] **Blocked** The HM-MAIL-01 to HM-MAIL-04 screens. Send on a draft runs `draftSendCall` through the cage. (#47, #53)
- [ ] **Blocked** Mail recipients by name. **Pass:** when Hermit asks for an address, past recipients show as chips, and the sheet says where a found address came from. (#65)

## 4. W3: eyes, the night shift, settings, privacy, language and accessibility

Gate (PRD 2.20):

- [ ] **T1** A page with an injected instruction is read, and nothing acts. Read your test page (visible orders, a hidden fake tool call). **Pass:** only `read_web` runs, the page text never reaches the main model, and the next memory write or send asks with the taint warning. **See:** Activity, HM-APPR-01. (#51)
- [ ] **Blocked** A night shift produces a briefing whose suggestion is approved in the morning. Only the mail job makes suggestions (an empty draft to a sender you wrote to), and the app doesn't wire mail (SL-48 Finish). The night shift without suggestions is checked below.
- [ ] A TalkBack pass completes: every TalkBack line in section 8 passes.

Already compiled in CI on 2026-11-14 and 2026-11-15, so these only need the install: `hermit-intents` (#55), `hermit-contacts` (#65), `hermit-night` (#64) and `hermit-notifications` with `power()` (#63).

### Web reading (HM-WEB-01; SL-22)

- [ ] **T1** Read three redirecting links: one that stays on the same site (`https://wikipedia.org` goes to `www`), one that goes to another site (a link shortener), and one that lands on http. **Pass:** the same-site one reads, and the other two are refused in words. Record whether Hermes `fetch` streams `res.body` (otherwise the XHR fallback runs) and honors `redirect: "manual"`. The 5-redirect cap only holds where the 3xx comes back to the app. **See:** the chat, HM-WEB-01. (#51)
- [ ] **T1** `credentials: "omit"`. **Pass:** a read sends no cookies from React Native's cookie jar. **See:** your test page's server log. (#51)
- [ ] Reader quality on a real page. **Pass:** a faithful answer with "Fuente: {title} ({domain})". HM-WEB-01 shows the title, address, untrusted note, answer, quotes and the exact text the reader used. Record the extra call's latency. **See:** HM-WEB-01. (#51)
- [ ] The fetch sheet. **Pass:** it shows the full address and the site. Deny says "No abrir", and the chat then says "No se abrió." A second read on that site in the same session asks nothing; after a restart, it asks again. **See:** HM-APPR-01. (#51)

### Web search (SL-23)

- [ ] "busca en internet el clima en Lima mañana". **Pass:** the sheet shows the query and DuckDuckGo, with "No buscar". Then "Buscando en internet…", and the answer with "Fuentes: …". Privacy counts `html.duckduckgo.com`. **See:** the chat, HM-SET-02. (#62)
- [ ] DuckDuckGo through the phone's HTTP client. **Pass:** results come back. If its robot check (anomaly page) shows, the chat says so (EC-WEB-12). If it shows often, Q58 needs an answer before release. **See:** the chat. (#62)
- [ ] A second search in the same chat. **Pass:** no sheet. **See:** the chat. (#62)
- [ ] Privacy's search picker. **Pass:** a public SearXNG address saves, a LAN address is refused inline, and off makes a search ask nothing while the model points to Privacy. The address field stays usable with the keyboard open. **See:** HM-SET-02. (#62) **+account** (SearXNG)
- [ ] Airplane mode, then a search. **Pass:** the sheet's offline note, then "No puedo buscar…". **See:** the chat. (#62)

### Open other apps (SL-58, contacts by name)

- [ ] With contacts denied: "mándale un WhatsApp al +506 XXXX XXXX que ya voy", then "text Carlos on WhatsApp that I'm on my way". **Pass:** WhatsApp opens on that chat with the text, nothing is sent, and the chat shows the Spanish answer. The second one, with no number, opens WhatsApp's picker with the text. **See:** WhatsApp, the chat. (#55, #65)
- [ ] A local number with no country code. **Pass:** record what WhatsApp does, and whether the country-code hint reads well. **See:** the chat. (#55)
- [ ] "llama al 8888 1234". **Pass:** the dialer opens with the number exactly as you wrote it, and no call is placed. **See:** the dialer. (#55, #58)
- [ ] "envíale un SMS al … que ya voy" in Samsung or Google Messages, and "email ana@example.com the notes" in Gmail. **Pass:** record whether the SMS body, and the email's recipient, subject and body, come prefilled. Nothing sends by itself. **See:** the apps. (#55)
- [ ] "navigate to …" and "share this: …". **Pass:** Maps opens on the place, and the share sheet opens with the text. **See:** the apps. (#55)
- [ ] "wake me at 6". **Pass:** the clock app shows 06:00 for you to confirm, with hour and minutes arriving as ints. Record whether Samsung Clock honors SKIP_UI false. **See:** Samsung Clock. (#55)
- [ ] "guarda el 8888 1234 como Pedro". **Pass:** the contacts insert screen opens with the name and the number. **See:** Contacts. (#55)
- [ ] **T1** Once "¿me escribió <contact>?" taints the session, ask for any intent. **Pass:** the sheet with the taint warning comes first. **See:** HM-APPR-01. (#55)
- [ ] An intent opens another app while a turn runs. **Pass:** the chat finishes the turn, and back in Hermit there is no frozen status line. **See:** the chat. (#55)
- [ ] **T1** With contacts allowed and a contact "Mamá": "llama a mi mamá". **Pass:** the sheet shows the number and "De tus contactos", then the dialer opens with it. **See:** HM-APPR-01, the dialer. (#65)
- [ ] Two contacts with the same first name. **Pass:** the question shows only the last 4 digits of each, and the chip opens the right number. **See:** the chat. (#65)
- [ ] Contacts denied. **Pass:** the dialer's own picker opens. The "Permitir contactos" offer shows once and doesn't come back after a restart. **See:** the chat. (#65)
- [ ] The contacts row in Settings, and the HM-ONB-04 card with "Not now". **Pass:** both show the permission's state and can change it. **See:** HM-SET-01, HM-ONB-04. (#65)

### Night shift (HM-NIGHT-01, HM-NIGHT-02; SL-24)

- [ ] The device reading. **Pass:** HM-NIGHT-01's "right now" list changes when you unplug the charger. **See:** HM-NIGHT-01. (#63)
- [ ] Turn it on, plug in, and tap "Probarlo ahora" (debug builds only). **Pass:** the briefing shows the agenda, reminders and messages, and Activity shows `night.*` rows on a verified chain. **See:** HM-NIGHT-02, Activity. (#63)
- [ ] Run while the phone is warm (thermal status 2 or more). **Pass:** the briefing opens with the stop banner, and the jobs are paused. **See:** HM-NIGHT-02; `adb shell dumpsys thermalservice`. (#63)
- [ ] Overnight on the charger, with the screen off and Hermit closed. **Pass:**
  - the ongoing "Hermit night shift" notice appears during the window;
  - the briefing is ready in the morning;
  - Activity shows `night.*` rows once per job.

  **See:** the notices, Activity. (#64)
- [ ] The morning notice. **Pass:** it fires at the chosen time. Tapping it opens the chat, not the briefing yet. **See:** the notice. (#63, #64)
- [ ] Doze: `adb shell dumpsys deviceidle force-idle`, then plug in. **Pass:** the work runs in a maintenance window, and the guards still hold. **See:** `adb shell dumpsys jobscheduler | grep -i hermit`. (#64)
- [ ] Reboot with the night shift on. **Pass:** the work is still listed after boot, and the next night runs. **See:** `dumpsys jobscheduler`. (#64)
- [ ] With battery optimization on (the default). **Pass:**
  - logcat shows "foreground service refused, running the night pass in the worker", and the pass still runs;
  - HM-NIGHT-01 says Android blocked it, with "Abrir ajustes de batería";
  - after you allow Hermit there, the line reads active and the next wake shows the notice.

  **See:** logcat, HM-NIGHT-01. (#64)
- [ ] Turn the night shift off. **Pass:** the work is cancelled. **See:** `dumpsys jobscheduler` lists no Hermit work. (#64)
- [ ] Keep the app open while a wake fires. **Pass:** one pass only, with one set of `night.*` rows. **See:** Activity. (#64)
- [ ] With notifications off for Hermit. **Pass:** the pass runs, and HM-NIGHT-01 shows the note. **See:** HM-NIGHT-01. (#64)
- [ ] **T1** Delete everything while a pass runs ("Probarlo ahora", then the erase). **Pass:** the pass stops, the ongoing notice goes away, no Hermit work is left, and the app restarts at first launch. **See:** `dumpsys jobscheduler`, the notices. (#64)
- [ ] **Blocked** Email suggestions. **Pass:** an unread email from someone you wrote to shows "Hacer un borrador de respuesta a…", Review opens the sheet, and approving saves a draft without sending. Blocked: mail isn't wired. (#63) **+Gmail**
- Superseded: #63's "does the in-app timer survive Doze" (Q69) became the WorkManager wake and the foreground service in #64.

### Settings, privacy and the app lock (HM-SET-01, HM-SET-02; SL-25)

- [ ] Turn the app lock on in Settings, kill the app, and reopen. **Pass:** the lock screen and the fingerprint prompt appear, and the modal covers everything. **See:** screenshot. (#52, #101)
- [ ] Lock the phone for more than a minute and return; then do a quick app switch. **Pass:** locked after the minute; not locked after the switch. **See:** the lock screen. (#52)
- [ ] **T1** Approve a reply with the lock on. **Pass:** the approval's fingerprint prompt doesn't bring up the lock. **See:** the sheet. (#52)
- [ ] Open a permission's page from Settings, change it, and come back. **Pass:** the row updates. **See:** HM-SET-01. (#52)
- [ ] After the model download. **Pass:** Privacy lists `huggingface.co` with a count. **See:** HM-SET-02. (#52)
- [ ] The chat menu. **Pass:** every entry opens its screen, including "Dónde funciona Hermit". The bar's crab and status open Activity. **See:** the menu. (#52, #104)

### Delete everything (HM-SET-03; SL-26)

- [ ] **T1** Erase with no model loaded, including on a launch where an erase resumes. **Pass:** QVAC's `deleteCache({ all: true })` runs, and the erase finishes. **See:** logcat. (#49)
- [ ] **T1** The SQLCipher database. **Pass:** op-sqlite's `getDbPath()` and `delete()` remove the file with its `-wal`, `-shm` and `-journal` files. **See:** `adb shell run-as io.dojocoding.hermit ls -R`, before and after. (#49)
- [ ] **T1** The keys. **Pass:** `SecureStore.deleteItemAsync` removes the biometric-gated approval key along with the rest, and the next setup makes new ones. **See:** the approval key screen asks for setup. (#49)
- [ ] Kill the app mid-erase. **Pass:** it resumes the erase at launch without asking again. **See:** HM-SET-03. (#49)
- [ ] When the erase is done. **Pass:** `reloadAppAsync` lands on Welcome. **See:** the screen. (#49)
- [ ] **T1** After the fingerprint. **Pass:** hardware back and the back swipe do nothing. **See:** HM-SET-03. (#101)

### Language (HM-ONB-02, HM-SET-05; SL-27)

- [ ] Switch the language on HM-SET-05 and on HM-ONB-02. **Pass:** screens, header titles and dates change without a restart. A message in the other language gets its reply in that language. **See:** the screens. (#61)
- [ ] Approval sheets in es-419. **Pass:** every label Hermit writes is in Spanish, and connector and MCP fields read "Campo de la herramienta: <name>". **See:** HM-APPR-01. (#95)

TalkBack, 200% text and dark mode for SL-27 are in section 8.

### The mascot's states and About (SL-28)

- [ ] Airplane mode, then ask for a WhatsApp reply and approve it. **Pass:** the offline pose with "Sin conexión: eso necesita internet". The next send returns to thinking. **See:** the chat bar. (#57)
- [ ] About in es-419 and en. **Pass:** the logos open their sites, and each license row opens its license, including the fonts' OFL and Lucide's. The signature stays verbatim in English. The logos look right in light and dark. **See:** HM-SET-08. (#57, #99, #101, #104)

### Memories and the conversation (HM-MEM-01, HM-MEM-02; SL-29)

- [ ] Restart the app after a few turns. **Pass:** the conversation comes back. A session that read WhatsApp keeps the tainted marker until you clear it. **See:** the chat. (#46)
- [ ] Memories past 30. **Pass:** older ones load as the list nears its end, and search works with the keyboard open. **See:** HM-MEM-01. (#46, #104)
- [ ] Delete a memory. **Pass:** Android's destructive alert asks first, then Activity shows `forget`. **See:** HM-MEM-02, Activity. (#46)
- [ ] "Borrar conversación" from the chat menu. **Pass:** a confirmation first; memories and the log stay. **See:** the chat, HM-MEM-01, Activity. (#46, #104)
- Superseded: #46's "header fit with the Memories and Clear links". Both moved into the menu (#52, #104).

### Reminders and calendars (HM-REM-01, HM-CAL-02; SL-30)

- [ ] Cancel a reminder on HM-REM-01. **Pass:** its alarm no longer fires, and Activity shows `reminder_cancel`. **See:** wait past its time; `dumpsys notification`. (#45)
- [ ] Choose a calendar on HM-CAL-02, which opens from the bottom of Reminders, then add an event from the chat. **Pass:** it lands in the chosen calendar. **See:** Samsung Calendar. (#45)
- [ ] With calendar access denied. **Pass:** HM-CAL-02 says why, and Open settings opens Hermit's app page. **See:** HM-CAL-02. (#45)

### WhatsApp Business and one-time codes (SL-31)

- [ ] A WhatsApp Business message. **Pass:** HM-MSG-01 names "WhatsApp Business" on its row, and "¿me escribió X?" names it too. A reply goes out through Business after the sheet shows "WhatsApp Business". **See:** HM-MSG-01, HM-APPR-01. (#56) **+account** (WhatsApp Business)
- [ ] The same contact in both apps. **Pass:** two rows, each replying in its own app. **See:** HM-MSG-01. (#56) **+account**
- [ ] **T1** A real verification code by WhatsApp on the S26 (Android 15 or later). **Pass:** record what the listener receives (the system placeholder). Nothing breaks, and the digits never show in Hermit. **See:** HM-MSG-01. (#56)
- [ ] **T1** On an Android 14 phone, receive "Tu código es 482913" by WhatsApp. **Pass:** HM-MSG-01 shows "Código de un solo uso oculto…", and the chat never repeats the digits. **See:** HM-MSG-01, the chat. (#56) **+2nd phone**
- [ ] Privacy in en and es-419. **Pass:** the one-time codes section says Android hides these codes from apps like Hermit, on purpose. **See:** HM-SET-02. (#56, #105)

### Activity details and the logged clear (HM-ACT-01, HM-ACT-02; SL-32)

- [ ] **T1** Tap a row. **Pass:** HM-ACT-02 shows full 64-character hashes and a 128-character signature in monospace, selectable, with a copy button that turns into a check. No message text. **See:** HM-ACT-02. (#54, #104)
- [ ] "Borrar registro" (the trash in Activity's bar), then "Conservar el registro". **Pass:** nothing changes. **See:** Activity. (#54, #104)
- [ ] **T1** "Borrar con huella", then cancel the fingerprint. **Pass:** "No se confirmó la huella. No se borró nada." **See:** Activity. (#54)
- [ ] **T1** "Borrar con huella" with a real fingerprint. **Pass:** one row, "Registro borrado" with "N entradas eliminadas", and "Cadena verificada". It opens with the count and the last hash of the cleared log. A phone with no fingerprint enrolled can't clear the log, and no PIN is offered. **See:** Activity, HM-ACT-02. (#54)
- [ ] A chat action after the clear. **Pass:** the new row sits above the cleared row, and the chain still verifies. **See:** Activity. (#54)
- [ ] The clear in English (switch the language). **Pass:** the same flow, with "Log cleared (N entries removed)". **See:** Activity. (#54)

SL-51's MCP checks (#68) run with SL-54 in W4.

## 5. W4: hands I

Before this gate: the approval key is set up (1.2); Hermit is the autofill service and Chrome's switch is on (W2); the vault exists.

Gate (PRD 2.20):

- [ ] **T1** A form in another app is filled after approval (SL-35 below).
- [ ] **T1** A login fills only on the exact origin and refuses a lookalike (SL-36 below).
- [ ] **T1** A reorder on a reference site completes, with each committing step approved (SL-53 below). Hermit never clicks Pay (Q121): the task pauses there, and the reorder ends at your own Pay tap.
- [ ] "Connect to" a service with no catalog entry yields an approved spec that works (SL-55 below). **+account**

### The vault (HM-VAULT-01, HM-VAULT-02; SL-33)

- [ ] **T1** Reveal, copy and save a login. **Pass:** a fingerprint prompt on each. A revealed value hides again after 30 s. **See:** HM-VAULT-02. (#70, #101)
- [ ] **T1** Enroll a new fingerprint in Android (1.4's batch). **Pass:** the vault shows its lost state, with Start over. **See:** HM-VAULT-01. (#70)
- [ ] **T1** FLAG_SECURE on the vault list, an item, the import, the profile and the fill screen. **Pass:** screenshots and the Recents preview are black. **See:** `adb exec-out screencap -p`, Recents. (#70, #71, #74, #101)
- [ ] **T1** Copy a password. **Pass:**
  - the clip is marked sensitive, so Android 13 and later hide its preview;
  - it clears after 30 s, unless something else was copied since;
  - locking, leaving a vault screen, and Delete everything clear it at once;
  - keyboards don't learn the password.

  **See:** the clipboard preview, Gboard's clipboard and suggestions. (#70, #101)
- [ ] **T1** Delete everything with a vault (1.4's last step). **Pass:** the Keystore alias is destroyed, and a new vault starts empty. **See:** HM-VAULT-01 shows none. (#70)

### CSV import (HM-VAULT-03; SL-34)

- [ ] The picker on Downloads and on Drive. **Pass:** the file opens through the system picker, and Hermit asks for no storage permission. **See:** HM-VAULT-03. (#71) **+account** (Drive)
- [ ] A real Chrome export and a real Bitwarden export. **Pass:** the preview shows names, exact origins and counts only. Duplicates offer Keep saved, Replace and Keep both. **See:** HM-VAULT-03. (#71) **+account** (Bitwarden)
- [ ] **T1** The import. **Pass:** exactly one fingerprint for the whole import, and one `vault.imported` row in Activity, with counts only. **See:** the prompt, Activity. (#71)
- [ ] Done, then Delete the file. **Pass:** it is deleted from Downloads after a destructive confirmation. On a provider that can't delete it, the screen says to delete it in Files. **See:** Files. (#71)
- [ ] A pick slower than 15 s. **Pass:** the vault locks, and Unlock reads the same file again. **See:** HM-VAULT-03. (#71)
- [ ] Samsung Pass. **Pass:** record whether it exports a CSV, and whether its header names a website column and a password column (Q89). **See:** Samsung Pass. (#71)

### The personal profile and form fill (HM-FORM-02, HM-FORM-01; SL-35)

- [ ] **T1** Menu, Personal profile: add a first name, a last name, an email and an ID number. **Pass:** the ID asks for the vault's fingerprint, then shows "Guardado y protegido…". Keyboards don't learn the values, and sensitive ones are masked. **See:** HM-FORM-02. (#74)
- [ ] A name and email form in Chrome (a shop's checkout, or the W3C forms tutorial's examples). **Pass:** "Llenar con tu perfil de Hermit" shows, as a chip or the dropdown, with no value visible. **See:** screenshot. (#74)
- [ ] **T1** Tap it. **Pass:** HM-FORM-01 shows the exact origin as the Website, "Reported by Chrome", and each field with its value. Fill sends Hermit to the back, the fields fill, and the form isn't submitted. Record whether the result reaches the form while Hermit's task is in front. **See:** HM-FORM-01, the page. (#74)
- [ ] **T1** A form with an ID number field ("dni", "cedula" or "national id"). **Pass:** the value is masked, the button says "Llenar con huella", and the prompt is the vault's. Cancel it once: "No se confirmó la huella…", nothing is filled, and the preview stays. **See:** HM-FORM-01. (#74)
- [ ] **T1** "No llenar" on another try. **Pass:** you're back in the form, with nothing filled. Activity reads `fill_form` approved, denied and ran. **See:** Activity. (#74)
- [ ] **T1** An http page with a form. **Pass:** plain fields offer and fill, with "Esta página no es segura (http)…". The ID field is listed as not filled. **See:** HM-FORM-01. (#74)
- [ ] A native app's name or address form (Q80). **Pass:** with digests, the suggestion appears and HM-FORM-01 names the app by package and signing key. With `no_signing_cert`, nothing is offered; record that. **See:** HM-FORM-01, autofill-debug. (#74)
- [ ] **T1** With the app lock on, tap a suggestion; then kill Hermit and tap a suggestion. **Pass:** the lock screen comes first, then HM-FORM-01. A cold start shows "Leyendo la solicitud del formulario", then the preview. **See:** screenshots. (#74)
- [ ] The same fill in Samsung Internet and Firefox, and with Samsung Keyboard and Gboard. **Pass:** it lands in each. Record whether Chrome reports HTML labels or only names and ids. **See:** the pages. (#74)
- [ ] **T1** Delete everything, then open the same form (1.4's last step). **Pass:** no Hermit suggestion. **See:** the page. (#74)

### Logging in on the exact origin (HM-APPR-01 login sheet; SL-36)

- [ ] In the vault, add "Heroku test" for `https://the-internet.herokuapp.com`, with `tomsmith` and the page's demo password. In Chrome, open its `/login` and tap the username. **Pass:** "Iniciar sesión con Hermit: Heroku test" shows, as a chip or the dropdown, with no value visible. The debug screen's last request shows `logins: 1`. **See:** the page, autofill-debug. (#78)
- [ ] **T1** Tap it. **Pass:**
  - HM-APPR-01 shows "¿Iniciar sesión con Hermit?", the login's name, Website `https://the-internet.herokuapp.com` reported by Chrome, and Username and Password masked;
  - "Aprobar con huella" shows the system prompt "Aprueba usar esta contraseña", with "Sitio: https://the-internet.herokuapp.com" and "Navegador: com.android.chrome";
  - then comes the vault's prompt, "Confirma que eres tú para abrir este inicio de sesión";
  - both fields fill, the page isn't submitted, and your Login tap logs in;
  - record whether the second prompt flickers on One UI (Q112).

  **See:** the prompts, the page. (#78, #99)
- [ ] **T1** Activity. **Pass:** `fill_login` rows read proposed, asked, approved (with the signed payload's hash) and ran. No row shows the username, the password or the login's name. **See:** Activity, HM-ACT-02. (#78)
- [ ] **T1** Cancel the approval key's prompt. Then approve it, and cancel the vault's. **Pass:** the sheet stays, saying the fingerprint wasn't confirmed, and the next Approve asks both prompts again. Nothing fills either time. **See:** HM-APPR-01. (#78)
- [ ] **T1** Lookalikes in Chrome: `https://herokuapp.com`, another `*.herokuapp.com` login page, `http://the-internet.herokuapp.com/login`, and `https://github.com/login`. **Pass:** no Hermit login suggestion on any of them; the profile one may still appear for an email field. **See:** the pages; autofill-debug shows no match. (#67, #78)
- [ ] Two logins for the same site. **Pass:** two suggestions, each with its name, and the one picked is the one filled. **See:** the page. (#78)
- [ ] **T1** A native app (Q80, Q113): add a login whose website is `android://<digest>@<package>`, taken from the debug screen. **Pass:**
  - the suggestion appears in the app;
  - HM-APPR-01 names the app by package and key;
  - the system prompt shows "App:" and "Clave de firma:";
  - a sideloaded copy signed by another key gets nothing.

  **See:** the prompt. (#78)
- [ ] **T1** Edit the login's password while HM-APPR-01 is open, then approve. **Pass:** "Este inicio de sesión cambió desde que lo abriste aquí. No se llenó nada…". **See:** HM-APPR-01. (#78)
- [ ] **T1** Tap the suggestion with the approval key lost, after adding a fingerprint in Android (1.4's batch). **Pass:** the key refusal shows, with "Configurar la clave de aprobación". **See:** HM-APPR-01. (#78)
- [ ] **T1** Delete the login; later, run Delete everything. **Pass:** the suggestion is gone, and after the erase there is no Hermit login suggestion anywhere. **See:** the page. (#78)

### Web tasks (HM-WEB-02; SL-53)

- [ ] The browser module. **Pass:** `hermit-browser` built with `androidx.webkit` 1.12.1, and `HermitBrowser.status()` reports `multiProfile: true` and an `android://<cert>@io.dojocoding.hermit` identity. HM-WEB-02 then offers "Stay signed in" (it does only with per-site profiles). **See:** HM-WEB-02. (#83)
- [ ] Record a real task: a status check on a public site, then a booking form on a test site. Save it, ask for it in the chat, open the plan from the link, and Start. **Pass:** each step shows on the live line as it runs. **See:** HM-WEB-02. (#83)
- [ ] **T1** The submit step. **Pass:** the approval sheet opens over the live page and shows the site, the button, every value the form sends (secrets as dots), and any amount by the button. **See:** HM-APPR-01. (#48, #83)
- [ ] Take over mid-task, scroll and type on the page, then Resume. Then Stop with the sheet open. **Pass:** the task resumes where it was, and Stop submits nothing. **See:** HM-WEB-02. (#83)
- [ ] A site's cookies, with "Stay signed in" off and then on: log in, finish, and run again. Then Clear. **Pass:** they're gone after the task when it's off, kept when it's on, and removed by Clear. HM-SET-09's Ask and Always toggle the same setting. **See:** the site's signed-in state, HM-SET-09. (#83, #99)
- [ ] After a task. **Pass:** Privacy lists the site's hosts and its CDNs. **See:** HM-SET-02. (#83)
- [ ] **T1** A vault login on the exact origin inside a task. **Pass:** one signed approval and the vault's fingerprint; the sign-in button is pressed without a second ask. **See:** the prompts, Activity. (#83)

### Sign-in steps in web tasks (SL-56)

- [ ] A recipe on a site with two vault logins. **Pass:** the plan's picker shows both, and the pick is used. After you delete the picked login, the next run asks you to sign in yourself. **See:** HM-WEB-02. (#86)
- [ ] A wrong password. **Pass:** the task ends with "El sitio no aceptó el inicio de sesión, así que Hermit se detuvo…", never as done, and with no retry. **See:** HM-WEB-02. (#86)
- [ ] A site that texts a sign-in code. **Pass:** the task pauses. You type the code on the page, tap Resume, and it carries on. **See:** HM-WEB-02. (#86) **+account**
- [ ] A login page with reCAPTCHA v3. **Pass:** no pause after a good sign-in. **See:** HM-WEB-02. (#86) **+account**

### One-time codes in web tasks (SL-56b)

- [ ] The APK built with `hermit-sms-consent` and `play-services-auth-api-phone:18.1.0`. **Pass:** `startSmsUserConsent` succeeds, and `registerReceiver` with `RECEIVER_EXPORTED` and `SmsRetriever.SEND_PERMISSION` gets the broadcast. **See:** logcat. (#90)
- [ ] **T1** A real site's code by SMS. **Pass:** Android's consent dialog appears only at the code step and shows the one message. Allow types the code after the sheet; Deny falls back to you typing it. **See:** the dialog, HM-WEB-02. (#90) **+account**
- [ ] **T1** An SMS that names only the brand, and one that arrives after the 5-minute window. **Pass:** both fall back to you typing the code. **See:** HM-WEB-02. (#90) **+account**
- [ ] **T1** The code sheet. **Pass:** it shows the exact origin the code goes to, the SMS text, and the code, which can't be selected. The fingerprint prompt shows the site. It reads well with TalkBack and at large text. **See:** HM-APPR-01, the prompt. (#90)
- [ ] Three sites: one with a box per digit, one whose code form auto-submits, and one that needs `requestSubmit`. **Pass:** the first falls back to you; the other two sign in. **See:** HM-WEB-02. (#90) **+account**
- [ ] **Blocked** Gmail: a real site's code email has `mx.google.com` with `dmarc=pass` at the top. Also record what a real Outlook message carries (Q141). Blocked: mail isn't wired. (#90) **+Gmail**

### MCP servers (HM-CONN-03; SL-51, SL-54)

- [ ] **T1** Add a public MCP server with dynamic registration, with the product owner's OK. **Pass:** the browser hands back to `hermit://oauth/mcp`. The review lists every tool by name with Hermit's risk, never the server's own text. Nothing reaches the menu before you approve. **See:** HM-CONN-03. (#68, #73) **+account**
- [ ] The expo/fetch transport. **Pass:** headers go in and out; a 3xx comes back as a redirect (`redirect: "manual"`) and is not followed; the body cap holds; the server's host is counted on Privacy. **See:** HM-CONN-03, HM-SET-02. (#68, #73)
- [ ] **T1** Use a tool, then remove the server. **Pass:** the call asks with its exact arguments. The token sat in SecureStore; removal deletes it on the phone, then revokes it. Delete everything's credentials step also removes tokens. **See:** HM-CONN-03, Activity. (#73)

### Connect me to X (HM-CONN-04; SL-55)

- [ ] **T1** "conéctame a <service>" for a service with no catalog entry, giving its docs page or `openapi.json`. **Pass:**
  - the fetch goes through the counted expo/fetch adapter;
  - the review card shows each operation with code's risk and the sign-in reading;
  - install asks for the key, runs the test call, and asks a strong-biometric fingerprint;
  - the connector then works under the cage.

  **See:** HM-CONN-04, HM-SET-02. (#80) **+account**
- [ ] Drafting from a pasted excerpt on the S26. **Pass:** a draft arrives behind the pending note. Record how long 3 endpoints take. **See:** HM-CONN-04. (#60, #80)
- [ ] Remove the connector. **Pass:** a destructive confirmation first; then it leaves HM-CONN-04's list and the turn's menu. Activity keeps its signed `connector` install entry. **See:** HM-CONN-04, Activity. (#80)

### Relays (HM-CONN-05; SL-57)

- [ ] Save your own relay on HM-CONN-05. **Pass:**
  - the one check lists the services the relay serves;
  - a private or LAN address is refused;
  - Privacy lists the relay;
  - Dojo's relay reads "Aún no disponible."

  **See:** HM-CONN-05, HM-SET-02. (#81) **+account** (a relay behind HTTPS)
- [ ] **Blocked** A sign-in through the self-hosted relay. Blocked: no screen starts a catalog connector sign-in yet (HM-CONN-01). (#81)

## 6. W5: hands II, money

Before this gate: the approval key is set up; the wallet is created and backed up, with its words written down; the phone's wallet is funded (1.3); the facilitator is running on the Mac.

Gate (PRD 2.20):

- [ ] **T1** A testnet payment to a contact completes within the caps (SL-40 below). **+USD₮0**
- [ ] **T1** An x402 testnet purchase completes within the caps (SL-41 below). **+USD₮0** It needs a merchant on public HTTPS (1.3).
- [ ] **T1** An over-cap payment is denied, with no sheet (SL-40 below).

### The approval key (SL-37)

- [ ] Settings, Approval key, Set up with fingerprint. **Pass:** the prompt reads "Configura tu clave de aprobación", and the screen then says "Guardada en el chip de seguridad StrongBox de este teléfono." or "Guardada en el hardware seguro de este teléfono." **See:** the approval key screen. (#72)
- [ ] **T1** Add a fingerprint in Android settings (1.4's batch). **Pass:** the screen says lost, and Set up again works with a fresh fingerprint. **See:** the screen. (#72)
- [ ] Cancel the setup prompt. **Pass:** "Cancelado. No cambió nada." **See:** the screen. (#72)
- [ ] **T1** The setup and signing prompts. **Pass:** the PIN is never offered. **See:** the prompts. (#72)
- [ ] **T1** A payment signed with the key (SL-40). **Pass:** the system prompt shows the amount and the recipient in the module's own words. The Activity entry has the payload hash and the signature. **See:** the prompt, HM-ACT-02. (#72)

### Create, back up and restore the wallet (HM-PAY-01, HM-PAY-02; SL-38)

- [ ] The prebuild log. **Pass:** "Hermit wallet: linked N addon files next to the M already there", plus the two-version list. The model still loads afterwards. **See:** the prebuild output, the chat. (#82)
- [ ] **T1** Create a wallet from the menu. **Pass:** a strong-biometric prompt with no PIN, then HM-PAY-02's backup. Show the words asks for a fingerprint again. **See:** the prompts. (#82)
- [ ] **T1** HM-PAY-02 while the words show. **Pass:**
  - screenshots and the Recents preview are black (FLAG_SECURE);
  - long-pressing a word copies nothing;
  - the keyboard on the check and restore fields shows no suggestions;
  - Gboard's clipboard and history stay empty.

  **See:** `screencap`, Recents, Gboard. (#82, #101)
- [ ] The three-word check. **Pass:** a wrong word returns to the intro. The right three mark the wallet backed up, and Back up never shows the words again. **See:** HM-PAY-02. (#82)
- [ ] **T1** Logcat during create, reveal and restore. **Pass:** no word and no key hex in any line. **See:** `adb logcat -s bare ReactNativeJS`. (#82)
- [ ] Restore with the words on a second install, or after Delete everything (1.4's last step). **Pass:** the preview shows the same address and its balance (0 for a fresh wallet). Use this wallet saves it; Not my wallet leaves nothing. **See:** HM-PAY-02. (#82) **+2nd phone** (optional)
- [ ] **T1** Enroll a new fingerprint (1.4's batch). **Pass:** HM-PAY-01 shows lost, and restoring from the words brings the wallet back. **See:** HM-PAY-01. (#82)
- [ ] **T1** Background Hermit on HM-PAY-02 while the words show; separately, let the app lock engage there. **Pass:** coming back shows the intro, not the words. **See:** HM-PAY-02. (#82)
- [ ] **T1** Delete everything with a wallet. **Pass:** the warning names the balance, or "an amount Hermit can't check right now" in airplane mode. Afterwards, HM-PAY-01 shows none, and the old words restore the same address. **See:** HM-SET-03, HM-PAY-01. (#82)
- [ ] After a balance read. **Pass:** Privacy lists `rpc.testnet.stable.xyz`. **See:** HM-SET-02. (#82, #84)

### Balance, history and receive (HM-PAY-01, HM-PAY-03, HM-PAY-04; SL-39)

- [ ] HM-PAY-01 with a wallet. **Pass:** Receive and Transactions show. **See:** HM-PAY-01. (#84)
- [ ] HM-PAY-04. **Pass:** "Solo USD₮0 en Stable testnet" comes first. Another wallet, or a camera, scans the code to the same address. In dark mode, the code stays dark on white. **See:** HM-PAY-04. (#84) **+2nd phone** (or any other wallet app)
- [ ] Copy the address on Receive and on the wallet home. **Pass:** it pastes the address; Gboard offers it (it isn't marked sensitive); leaving a vault screen doesn't clear it; "Copiada" shows for two seconds. This also proves `copyPlain` compiled. **See:** Gboard. (#84, #104)
- [ ] HM-PAY-03 on a fresh wallet, then after test USD₮0 arrives. **Pass:** the empty note first, then "Cargar anteriores" down to the floor note ("Las transferencias más antiguas no se muestran aquí…"). After the funding, one Received row with the exact amount, "Remitente desconocido", and the time. **See:** HM-PAY-03. (#84) **+USD₮0**
- [ ] HM-PAY-03 in airplane mode. **Pass:** "Hermit no pudo leer los movimientos. Revisa tu conexión." with "Leer de nuevo", never an empty list. **See:** HM-PAY-03. (#84)

### Pay a contact within the caps (HM-APPR-02, HM-PAY-05; SL-40)

- [ ] **T1** "envíale 1 USD₮ a <payee>" to a payee saved on HM-PAY-05. **Pass:**
  - the sheet opens with "¿Enviar a <name>?", the amount in large figures, the payee with the cut address under the name, the network, the fee estimate, and what the day's cap leaves;
  - the system prompt, "Aprueba este pago", reads "Monto", "Para" with the address, and "Red: Stable testnet"; then the wallet's own prompt follows;
  - "Envié … La red lo confirmó (transacción …)." only on a receipt, and HM-PAY-03 links the payment to its log entry.

  **See:** the prompts, HM-PAY-03. (#85, #99, #104) **+USD₮0**
- [ ] **T1** A typed address. **Pass:** the title asks "¿Enviar a esta dirección?", and the address shows whole, in mono, in groups of four, with "Tú escribiste esta dirección. Revisa cada carácter antes de aprobar." **See:** HM-APPR-02. (#85, #104) **+USD₮0**
- [ ] **T1** Address poisoning across screens. **Pass:**
  - a stranger's address shows whole in mono and wraps on the history, the latest movements, an unnamed payment sheet, the chat's receipt and Hermit's replies;
  - a saved payee shows the name, with the cut address under it;
  - the wallet home cuts your own address, and Receive shows it whole.

  **See:** those screens. (#104)
- [ ] **T1** A payment over each cap, per payment and per day. **Pass:** refused with no sheet. The chat shows the coral card, and See my caps opens HM-PAY-05. **See:** the chat. (#85, #99)
- [ ] **T1** Tap "No pagar", or cancel either fingerprint. **Pass:** nothing is sent, and the reservation is released. **See:** the "used today" line on HM-PAY-05. (#85, #99)
- [ ] **T1** Each HM-PAY-05 change: caps, a payee saved, a payee removed. **Pass:** a strong-biometric prompt with no PIN, and a `spending` row in Activity, logged by hash. **See:** the prompt, Activity. (#85)
- [ ] A confirmed payment. **Pass:** the receipt card shows alone, with no repeated bubble, names the transaction, and links Activity. Every Stable RPC call shows on Privacy. **See:** the chat, HM-SET-02. (#85, #99, #101)

### Pay an x402 merchant (HM-APPR-02 purchase; SL-41)

- [ ] **T1** A purchase from the reference merchant on Stable testnet. **Pass:**
  - the sheet, "¿Pagarle a este sitio?", shows the Site, Page, Amount, the payee, the network, "Se puede cobrar durante" five minutes after you sign, and the cap left, with nothing the merchant wrote;
  - the system prompt names the site's origin, and the wallet's prompt follows;
  - "Pagué … La red lo confirmó." only once the chain shows the nonce used;
  - HM-PAY-03 links the settled transfer, and the paid page goes through the reader into HM-WEB-01.

  **See:** the prompts, HM-PAY-03, HM-WEB-01. (#88, #99) **+USD₮0**
- [ ] **T1** The paid-redirect rule: a paid read that gets a 302. **Pass:** the 302 comes back as a redirect and is never followed. **See:** the chat's outcome; the merchant's log shows no request to the redirect target. (#89)
- [ ] **T1** A plain read of a page that answers 402. **Pass:** "{domain} pide un pago para mostrar esa página, así que no la leí y no pagué nada…". Nothing is read or paid, and the session isn't tainted. **See:** the chat. (#88)
- [ ] SL-41's eval on the Mac, with no assumed balance. **Pass:** `pnpm --filter @hermit/eval eval:x402-merchant` ends `merchant_paid`, with the ledger row `settled`. **See:** its output. (#88) **+USD₮0**

### Hermes runtime

- [ ] `TextDecoder` in fatal mode, `URL.origin`, and `Uint8Array` writes on `worklet.IPC`. **Pass:** each works on Hermes; the payments package and the wallet client rely on them. **See:** wallet-debug's sign and verify; the purchase sheet's origin. (#42, #79)
- [ ] `Intl.NumberFormat` with a bigint, and `Intl.DateTimeFormat` with `dateStyle`, in en and es-419. **Pass:** block numbers and amounts format, and dates read right. **See:** HM-PAY-03's rows. (#84)

## 7. W6: changing phones and distribution

Gate (PRD 2.20):

- [ ] **Blocked** A full transfer to a second phone verifies. SL-42 and its spike, SL-19, are Open. **+2nd phone**
- [ ] **Blocked** The Play internal track is published. SL-44 and its spike, SL-21, are Open (DEP-06). **+Play**
- [ ] **Blocked** The reproducible APK is published on GitHub Releases. SL-45 is Open and needs CI (Q99).
- [ ] **Blocked** The website is live. SL-46 is built but not deployed. It waits for Tether's written OK on the logos (Q14), the domain (OQ-05) and the privacy contact (Q107).

### The device floor and model updates (HM-ONB-05, HM-CHAT-02; SL-43)

- [ ] The facts on a 6 GB and on an 8 GB phone (Q103). **Pass:** record what expo-device and the module report: memory as Android reports it, the ABI, and the API level. On the S26 the check returns supported, and onboarding is unchanged. **See:** HM-ONB-03 or HM-ONB-05. (#76) **+2nd phone**
- [ ] HM-ONB-05 at 200% text with TalkBack, on a phone below the floor. **Pass:** the reasons, what still works, and the opt-in with its warning all read and scroll. **See:** HM-ONB-05. (#76) **+2nd phone**
- [ ] **Blocked** A real model update, a rollback, and a kill mid-update. Blocked: there is no manifest source or signing key yet (`MODEL_UPDATE_SOURCE` is unset, Q104). (#76)

### Release builds

- [ ] **Blocked** **T1** In a release build, the dev-only hooks are off. **Pass:** `hermit://?say=`, `hermit://eval`, `hermit://autofill-debug`, `hermit://wallet-debug` and the night shift's "Probarlo ahora" do nothing, and autofill diagnostics stay debug-only. Blocked: no release build until SL-44 and SL-45. (#31, #63, #67, #74, #79)

## 8. Cross-cutting

### Fonts and type

- [ ] After `npx expo prebuild`, check the font files. **Pass:** `android/app/src/main/res/font/` holds the six TTFs and the three `xml_*.xml` families. `MainApplication` registers Newsreader, InstrumentSans and JetBrainsMono with `ReactFontManager.addCustomFont`. **See:** `ls apps/mobile/android/app/src/main/res/font`; grep `addCustomFont` under `apps/mobile/android/app/src`. (#104)
- [ ] On the phone. **Pass:**
  - titles are in Newsreader, not the system serif;
  - UI text is in Instrument Sans, in two weights (Medium for labels, SemiBold in Deep sea);
  - addresses are in JetBrains Mono;
  - no text is faux bold.

  **See:** screenshots. (#99, #104)
- [ ] USD₮ on the payment button and the balance. **Pass:** the ₮ falls back to the system font beside Instrument Sans, sits on the baseline, and matches the weight closely. **See:** screenshots. (#104)
- [ ] Tabular figures. **Pass:** the balance and the amounts don't shift width while the balance loads, and the history's amounts line up in a column. **See:** HM-PAY-01, HM-PAY-03. (#104)
- [ ] Balanced line breaking. **Pass:** no title ends on a single word at the default text size. **See:** screenshots. (#104)

### Surfaces and layout

- [ ] `boxShadow` on groups, cards, the composer and sheets. **Pass:**
  - shadows are soft, not clipped by rounded corners, and show no banding in Deep sea;
  - on the long lists (vault, Activity, memories, messages), no seam shows between rows while scrolling;
  - a tap on the search field above the first row still lands.

  **See:** screenshots, a scroll recording. (#104)
- [ ] The crab's stage. **Pass:** the radial fade has no visible edge or banding behind the breathing crab, in light and in Deep sea, and the hello wave stays inside the fade. **See:** a screen recording. (#104)
- [ ] Empty states. **Pass:** they sit just above the middle of the screen on a tall phone, and scroll normally at 200% text. **See:** screenshots. (#104)

### Icons and navigation

- [ ] `react-native-svg` in the build. **Pass:** icons draw on every screen, in light and in dark. **See:** screenshots. (#99)
- [ ] Screens that draw their own back button: wallet, transactions, caps, receive, settings, What Hermit can use, privacy, Activity. **Pass:** the arrow and the system back both go back. **See:** each screen. (#99)

### Motion at 60 fps

- [ ] Native-driver motion. **Pass:** at 60 fps:
  - press feedback on buttons;
  - the sheet's spring and its backdrop;
  - the first block's rise and the status crossfade;
  - the segmented thumb and the switch's knob;
  - LayoutAnimation easing the chat on send and when steps fold;
  - the large title's copy fading into the bar on list pages.

  **See:** `dumpsys gfxinfo … framestats`, a screen recording. (#104)
- [ ] The crab while streaming: a long streamed reply with a tool call, so the header crab goes thinking, working, done. **Pass:** no dropped frames in the crab, and the springs don't stall while the JS thread is busy. **See:** `dumpsys gfxinfo io.dojocoding.hermit framestats`. (#103)
- [ ] Pose changes. **Pass:** the claw's paper gap follows it over the shell (working, asking, hello), the tuck closes the door, and the envelope falls on error. Compare with the proof page's clips. **See:** a screen recording, `docs/design/mascot/index.html`. (#103)
- [ ] Opening any screen with a crab. **Pass:** no piece is ever out of place on the first frame. **See:** a screen recording. (#103)

### Reduce motion and quiet mode

- [ ] Turn on Remove animations (Settings, Accessibility, Visibility enhancements) while Hermit is open. **Pass:**
  - the crab stops at once, rests on its pose, and swaps poses without moving;
  - nothing else moves, presses still dim, and sheets appear in place;
  - HM-SET-06 shows the system line;
  - turning it off brings the motion back.

  **See:** a screen recording, HM-SET-06. (#57, #103, #104)
- [ ] Turn quiet mode on. **Pass:**
  - there is no crab anywhere: chat bar, welcome, empty states, lock screen;
  - the status text still changes, and nothing pulses or moves;
  - the approval sheet appears without sliding.

  **See:** screenshots. (#57, #99, #101, #103, #104)
- [ ] Kill and reopen the app with quiet mode on. **Pass:** the crab never flashes in. **See:** a screen recording. (#57)

### Haptics

- [ ] The `hermit-haptics` module. **Pass:** Expo autolinking finds it, and the merged manifest asks for no VIBRATE: `aapt dump permissions app-debug.apk` lists none. **See:** the build, `aapt`. (#104)
- [ ] On the phone. **Pass:**
  - a light tick on a primary button, a switch and the segmented control;
  - a confirm on approve after the fingerprint;
  - a reject on Deny;
  - nothing at all with the phone's touch feedback off.

  **See:** by hand. (#104)

### TalkBack

- [ ] **T1** With the app lock engaged, let a turn finish. **Pass:** TalkBack says only "Hermit respondió", never the reply, a question or an outcome, and it doesn't read the text after the unlock either. **See:** TalkBack. (#61)
- [ ] Every control on chat, the menu, settings, appearance and the approval sheet. **Pass:** each is read with a role and a label. Choices read as radios with their state: the language step, the theme, and a web task's login picker. **See:** TalkBack. (#61, #86)
- [ ] A streamed reply. **Pass:** it is read once, when complete. The live row's seconds counter and reasoning are not read every tick. **See:** TalkBack. (#61)
- [ ] Sheets. **Pass:** each reads its title, warnings and each field, then Approve. The payment sheet reads the question, amount, payee, network, fee, cap, your words, then Pagar. **See:** TalkBack. (#61, #99, #104)
- [ ] The chat bar. **Pass:** its button reads the status, then "Abrir Actividad". The crab is skipped, with the label beside it saying the same. A scrolled page's small bar title isn't read twice. **See:** TalkBack. (#103, #104)
- [ ] Rows. **Pass:**
  - a transfer row's facts are one stop, and its log link another;
  - a login's field and its copy button are two stops;
  - each payee reads its name and address together;
  - the QR code reads its label;
  - each history row is one stop, plus its log link.

  **See:** TalkBack. (#84, #85, #104)
- [ ] Web tasks and other new controls. **Pass:** the live line is read as each step starts, every control on HM-WEB-02 by its label, and the import choices and reminder Cancel have labels and 48 dp targets. **See:** TalkBack. (#83, #101)

### Text at 200%

- [ ] Font size and display size at maximum (`adb shell settings put system font_scale 2.0`, plus Settings, Display). **Pass:** every screen scrolls, nothing is clipped, and every button stays on screen, including the chat header, the approval sheet, the permissions step, onboarding and the wallet. **See:** screenshots. (#61, #99)
- [ ] Layout at 200%. **Pass:** the composer keeps its send button, the payment sheet's body scrolls under the pinned actions, the balance wraps its unit under the figures, and a row's time or amount moves under its title. **See:** screenshots. (#104)
- [ ] Long Spanish labels at 200%: the import's segmented choices and the footer buttons. **Pass:** they wrap without clipping. **See:** screenshots. (#101)

### Dark mode

- [ ] Pin Light and Dark against the phone's own scheme. **Pass:** the app follows the pin, `Appearance.setColorScheme` doesn't recreate the activity (`uiMode` is in `configChanges`), and the status bar follows. **See:** screenshots; the chat keeps its state. (#61)

### Battery when idle

- [ ] Leave the empty chat on screen for 10 minutes (hello, breathing, blinking), then background the app for 10 minutes. **Pass:**
  - Hermit is near zero in Settings, Battery;
  - no frames are rendered in the background (`dumpsys gfxinfo` total frames unchanged);
  - on screen, the display drops to its low refresh rate between blinks once the breaths stop, 45 s after the last change.

  **See:** Battery, `dumpsys gfxinfo`, Show refresh rate. (#103)

### No trackers

- [ ] `pnpm check:privacy` on the commit you built. **Pass:** it passes: the dependency denylist, the lockfile, and the native modules' Gradle files. **See:** its output. (#1, #90)
- [ ] The APK's permissions. **Pass:** `aapt dump permissions app-debug.apk` lists the `app.json` permissions plus what the modules declare, and no VIBRATE, READ_SMS, location, storage, RECORD_AUDIO, `c2dm.permission.RECEIVE` or install-referrer permission. **See:** `aapt`. (#14, #65, #104)
- [ ] The merged manifest. **Pass:** no Firebase, Google Analytics, Crashlytics, measurement or Sentry component, provider or meta-data. The only Play services piece is the SMS retriever. **See:** `apkanalyzer manifest print app-debug.apk`. (#90)
- [ ] On the phone. **Pass:** the granted permissions are only the ones you granted. **See:** `adb shell dumpsys package io.dojocoding.hermit`. (#14)
- [ ] Privacy (HM-SET-02) at the end of the session. **Pass:** every host contacted is listed with a count, and nothing appears that you didn't cause. **See:** HM-SET-02. (#52)

## 9. First build triage

The last green Android build was SL-37's branch on 2026-11-15 at 06:44 UTC. From SL-35's job, three minutes later, GitHub refused every Android job; Q99 logged it on 2026-11-17. Expect several compile errors at once (Q154). The goal is to find them before the session, not during it.

### Never compiled: native code merged after #73

| Native piece | What changed | PRs | Compiled before? |
| :---- | :---- | :---- | :---- |
| `modules/hermit-autofill` (Kotlin, `androidx.autofill` 1.1.0) | Profile fills: `FieldKinds`, `PendingFills`, `ProfileFills`, `ProfileIndex`, `Requester`, `Diagnostics`. Logins: `LoginFills`, `LoginIndex`, `OriginMatch.loginsFor`. JVM tests: `FieldKindTest`, `LoginIndexTest`, `OriginMatchTest.sharedLoginVectors` | #74, #78 | Only SL-20's version (#67) |
| `modules/hermit-approval-key` (Kotlin, `androidx.biometric` 1.1.0) | `ApprovalText`: Site and Browser, App and Signing key (#78), the network name (#85), with new `ApprovalTextTest` cases | #72, #78, #85 | #72's code on its branch (`b36ed245`, its JVM tests ran); #78 and #85 never |
| `modules/hermit-vault` (Kotlin) | `CsvDocument` (the picker, #71); `copyPlain` (#84) | #71, #84 | #71 on its branch (`0ea8d1ad`, same module tree as merged); #84 never |
| `modules/hermit-browser` (Kotlin, `androidx.webkit` 1.12.1) | New: one WebView per task, per-site profiles | #83 | Never |
| `modules/hermit-sms-consent` (Kotlin, `play-services-auth-api-phone` 18.1.0, `androidx.core:core-ktx` 1.13.1) | New: SMS User Consent | #90 | Never |
| `modules/hermit-haptics` (Kotlin) | New: `View.performHapticFeedback`, no permission | #104 | Never |
| `worklets/wallet` plus the `./plugins/with-wallet-worklet` app.json plugin | The wallet bundle: 27 addons, 15 the exact versions QVAC links and 12 other versions or new, shipped beside QVAC's (Q110); linked after every other mod; worklet handler changes | #79, #82, #85 | Never in an APK (only under Bare on the Mac) |
| `react-native-svg` 15.16.0 | The icons | #99 | Never |
| `react-native-reanimated` 4.7.1 and `react-native-worklets` 0.13.0 | The crab on the UI thread | #103 | Never |
| `expo-font` ~58.0.11 and its app.json plugin (six TTFs, three families) | The brand fonts | #104 | Never |

`@hermit/payments` became an app dependency in #79; it is pure JavaScript, so Metro covers it. Compiled in CI before the stop: `hermit-notifications`, `hermit-intents`, `hermit-night`, `hermit-contacts`, SL-20's `hermit-autofill`, SL-33's `hermit-vault`, op-sqlite with SQLCipher, and QVAC with bare-kit.

### When it fails

1. **The install step.** `pnpm install --frozen-lockfile` fails: two lockfile entries were added by hand, the `packages/payments` importer (#42, after `pnpm install` crashed with a heap error) and the app's `@hermit/payments` dependency (#79, with no root install run). `pnpm install --offline --frozen-lockfile` accepted the first. If pnpm itself crashes hashing large tarballs, use Node 22 (#17).
2. **The prebuild.**
   - QVAC's bundle step dies silently: Node 22.17 and 24.4 segfault inside `bare-module-lexer` 1.7.0's addon, which bare-pack and bare-link load. Run under the Bare runtime or another Node (#79). `scripts/qvac-bundle.mjs` needs Node 22.21 or later.
   - The wallet plugin fails "if anything already in the folder disappears": read which file and the two-version list (Q110).
   - To build everything else meanwhile, prebuild with `HERMIT_SKIP_WALLET_WORKLET=1` (or the plugin option `{ "skip": true }`). The wallet is then left out of that build (#82).
   - expo-font fails on a font path: the six TTFs live in `apps/mobile/assets/fonts`, made by `scripts/fonts/instance_fonts.py`. `licenses.test.ts` checks that the files, the licenses and the plugin agree (#104).
3. **The Gradle compile.**
   - In `apps/mobile/android`, build module by module to see every error, smallest first: `./gradlew :hermit-haptics:compileDebugKotlin`, then `:hermit-vault:`, `:hermit-approval-key:`, `:hermit-sms-consent:`, `:hermit-browser:` and `:hermit-autofill:` with the same task. Then `:app:assembleDebug`.
   - Keep each first error, with its module, in the evidence folder.
   - Reanimated 4.7 needs the New Architecture (on in `app.json`) and React Native 0.86 to 0.88 (the app is on 0.88.1). The lockfile must hold one copy of each native module (#103).
   - `babel-preset-expo` 58 adds the worklets plugin on its own, so there is no `babel.config.js` (mascot decisions, 3).
   - Expo moves APIs between SDKs: read the SDK 58 docs before changing a config plugin (`apps/mobile/AGENTS.md`).
4. **The JVM tests.**
   - Run `./gradlew :hermit-autofill:testDebugUnitTest :hermit-approval-key:testDebugUnitTest`.
   - They read `packages/core/test/autofill-origin-vectors.json` and `profile-field-vectors.json`, which vitest runs too. If a vector fails on one side only, the Kotlin and TypeScript rules have drifted. It is T1: fix the code, never the vector.
5. **It builds, but fails on the phone.**
   - `CANNOT_LOAD` on `hermit://wallet-debug`: something emptied the addon folder after the prebuild (a `pnpm install` that reinstalls react-native-bare-kit does). Run `node apps/mobile/worklets/wallet/build.mjs`, then rebuild. If it still fails, record the exact library and stop: that is Q109's decision point (`docs/research/wdk-worklet-spike.md`).
   - The phone runs old code: restart Metro with `--clear` and check the log lines a probe should print.
   - A screen shows a line naming a slice instead of working: that adapter isn't wired in this build (`NotWiredError`, #12).
   - A feature says its module is missing: `hermit-autofill`, `hermit-browser`, `hermit-haptics`, `hermit-night` and `hermit-sms-consent` load optionally, so an APK without them still runs. `hermit-approval-key`, `hermit-contacts`, `hermit-intents`, `hermit-notifications` and `hermit-vault` load with `requireNativeModule`, which throws when the module is absent, so they must compile.
6. **Unblock the session.**
   - Run every check whose module did build; the module is named in each group's PRs.
   - Leave a failing optional module out only on a local branch, never on master, after reading the SDK 58 autolinking docs.
   - Fix each module in its own PR. T1 modules (autofill, approval key, vault, SMS consent) get the second review (PRD 3.7).
   - Rerun the CI job, or the local steps, before the phone session continues.
