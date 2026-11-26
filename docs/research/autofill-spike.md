# Android autofill service spike (SL-20)

Date: 2026-11-14. Slice: SL-20 (W2, T2). Assumption under test: ASM-10 (an Expo app can register an Android `AutofillService` through a custom native module). Decisions it feeds: FR-FORM-01, FR-VAULT-04, SL-33 (vault), SL-35 (fill forms from the profile) and SL-36 (log in with an exact-origin credential).

## Verdict

**ASM-10 holds on the build side: GO for SL-35 and SL-36, pending the phone checks below.** A local Expo module (`apps/mobile/modules/hermit-autofill`) declares an `AutofillService` in its own manifest. Expo prebuild merges it into the app, and CI's apk job compiles it with no config plugin and no edit to `app.json`. The service:

- parses the AssistStructure;
- identifies the requester by package and signing certificate and, in a trusted browser, by web origin;
- offers a dataset only on an exact origin match;
- returns no value until a strong biometric succeeds in Hermit's own activity.

What only the phone can show is listed under "Phone checks". The Chrome setting and package visibility are the two that could change the design.

## What was built

- **`packages/core/src/autofill-origin.ts`** (pure, test-first). This is the exact-origin rule, FR-VAULT-04 applied to autofill.
  - Origins are `https://host[:port]`, `http://host[:port]` or `android://<cert>@<package>`. `<cert>` is the SHA-256 of the app's signing certificate, in base64url without padding (the Digital Asset Links and WebAuthn `apk-key-hash` digest).
  - Exact means equal after canonical form only: lowercase scheme and host, no trailing dot, no default port. There are no subdomains, parent domains, wildcards or lookalike folding. Non-ASCII hosts are refused.
  - A package name alone is never an identity: a sideloaded app can reuse any package name, but not its owner's key.
  - A web domain is believed only from a browser whose package **and** certificate are on `TRUSTED_BROWSERS`. Any other app showing a web page is that app (`android://<cert>@<package>`), because it controls the page and could read what is filled.
  - Refusals carry a reason:
    - `bad_package`;
    - `no_signing_cert` (missing, unreadable or malformed);
    - `multiple_signers`;
    - `no_web_scheme` (a domain with no scheme is refused, not guessed);
    - `bad_web_origin`;
    - `mixed_web_origins` (username and password from two frames);
    - `no_match`.
  - `TRUSTED_BROWSERS` holds the release builds of Chrome, Samsung Internet and Firefox from Google's Credential Manager privileged apps list (`https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json`, downloaded and converted 2026-11-14). The userdebug signatures are left out.
- **`packages/core/test/autofill-origin-vectors.json`**: 29 vectors shared by the vitest suite and by `OriginMatchTest.kt`, so the TypeScript rule and the Kotlin mirror cannot drift. CI's apk job runs the Kotlin side (`:hermit-autofill:testDebugUnitTest`). Both suites also assert that their shipped browser allowlist equals `productionBrowsers` in the vectors.
- **`apps/mobile/modules/hermit-autofill`** (Kotlin):
  - `HermitAutofillService`, declared with `BIND_AUTOFILL_SERVICE`, the `android.autofill` meta-data (`res/xml/hermit_autofill_service.xml`: `settingsActivity`, `supportsInlineSuggestions="true"`) and the service intent filter.
  - `StructureParser`. It finds the username and password fields from autofill hints, HTML attributes, input types and ids, plus the nearest web domain and scheme above each field. It never reads a field's current value.
  - `OriginMatch`, the Kotlin mirror of the TypeScript rule.
  - `Spike.certDigests`, which reads `SigningInfo.apkContentsSigners` from `PackageManager`.
  - `Datasets`. The locked dataset carries the item name and fields with no values, plus `setAuthentication`. It uses the Android 13+ `Presentations`/`Field` API, and the deprecated builders on 11 and 12. It adds an `InlineSuggestionUi` v1 chip when the keyboard sends an inline spec.
  - `AutofillAuthActivity`. It re-parses the form from `EXTRA_ASSIST_STRUCTURE` and re-checks the origin (the page may have navigated). It then asks for `BIOMETRIC_STRONG` and only then returns `EXTRA_AUTHENTICATION_RESULT` with values.
  - `AutofillSettingsActivity`, the picker's settings link. It opens `hermit://autofill-debug`.
  - `HermitAutofillModule`: `status`, `openSettings`, `lastRequest`, `trustedOrigins`, `trustLastOrigin`, `resetOrigins`.
- **`apps/mobile/src/app/autofill-debug.tsx`** (dev only, `hermit://autofill-debug`, copy key prefix `HM-DEV-01`). It shows:
  - whether Hermit is the selected service, with a button that opens Android's setting;
  - the last request's diagnostics (package, certificate digests, web domains and schemes, fields found, inline or not, verdict, fingerprint outcome; never a value);
  - a button that trusts that exact origin for the test login.

  The native module is optional (`requireOptionalNativeModule`), so a phone on an older APK with JS from Metro gets a message instead of a crash.
- **Spike data**: one fixed test login. It is the public demo account printed on `https://the-internet.herokuapp.com/login`, so a real login can be seen to succeed; it is not a secret. The trusted origins live in a private preferences file. No vault data is connected.

### Behavior when the service is not selected, and in release builds

Android binds an autofill service only after the user picks it. Until then the merged manifest entries are inert, and no existing code path changed: the Settings autofill row still says "not used in this version", and the eval screens are untouched. The service and the auth activity check `FLAG_DEBUGGABLE`, so a release build answers every request with nothing even if someone selects Hermit.

## What Android allows (Android 14 and 15 on Samsung, and 16 on the S26)

- **Selecting the service.**
  - From Android 14, autofill sits under Settings > Passwords, passkeys and autofill. On Samsung One UI 6 and 7 that is General management > Passwords, passkeys and autofill, where Samsung Pass is the default "preferred service".
  - Only one autofill service is active at a time. Picking Hermit replaces Samsung Pass or Google for autofill, though both can stay as credential (passkey) providers.
  - `Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE` shows Android's "use Hermit?" confirmation. It returns at once when Hermit is already selected, so the debug screen then opens `Settings.ACTION_CREDENTIAL_PROVIDER` (Android 14 and later) instead.
- **Chrome.** Chrome for Android talks to the autofill framework natively only when the user turns on Chrome Settings > Autofill services > "Autofill using another service". Otherwise it keeps Google Password Manager and never calls Hermit. The old compatibility mode (`compatibility-package` in the service XML) is accessibility-based and is not used here. This step belongs in SL-35's onboarding copy.
- **Samsung Internet and Firefox** use the framework as well. That they report `webDomain` and `webScheme` on the S26 is a phone check.
- **Web origin detail.** Android parses what the browser reports into `ViewNode.getWebDomain()` (host only) and `getWebScheme()`. **No port is reported**, so a credential stored for a non-default port can never be released through autofill. The rule fails closed there, and a vector covers it.
- **Package visibility.**
  - Reading the requester's signing certificate needs `PackageManager.getPackageInfo`, which Android 11 and later filter by package visibility.
  - The three browsers are declared in `<queries>`.
  - Whether Android also makes the app being filled visible to its autofill service is a phone check. If it doesn't, every native app gets `no_signing_cert` and nothing is offered (fail closed), and Q80 decides the fix.

## Inline suggestions and the dropdown

- **Inline (Android 11 and later).** The keyboard shows the suggestion in its strip when it supports inline suggestions and sends an `InlineSuggestionsRequest`. Gboard does; Samsung Keyboard's support is a phone check. Hermit declares `supportsInlineSuggestions` and builds an `InlineSuggestionUi` v1 chip only when the keyboard's spec supports v1. Long-pressing the chip opens Hermit's autofill screen (the attribution intent).
- **Dropdown.** Without an inline request, Android shows the menu presentation, a one-line `RemoteViews` with the item's name, under the focused field.
- **Neither shows a value.** Only the item's name ("Hermit test login") appears before the fingerprint.
- **Not used.** The Android 13 fill dialog (`setDialogPresentation`) and save requests (`SaveInfo`) are not used. The vault (SL-33) owns saving.
- The debug screen records whether the last request had an inline spec, so the phone check shows which path ran.

## How authentication gating works

1. The fill response holds one dataset whose fields have **no values**, plus `setAuthentication(IntentSender)`.
2. The PendingIntent is explicit, targets Hermit's non-exported `AutofillAuthActivity`, and is **mutable** on purpose: Android adds `EXTRA_ASSIST_STRUCTURE` when it fires it, and the `Dataset.setAuthentication` docs say not to make it immutable.
3. The user taps the suggestion and Android starts the activity over the other app.
4. The activity parses the structure again and runs the same exact-origin match. It requires the result to equal the origin that was offered. If anything moved, it returns `RESULT_CANCELED` and records `origin_changed`.
5. `BiometricPrompt` with `BIOMETRIC_STRONG` only, with no PIN fallback: the same bar as approvals (Q47, Q51). The subtitle names the origin. With no strong biometric enrolled, nothing is filled (`no_biometric`).
6. On success it returns `EXTRA_AUTHENTICATION_RESULT` with a dataset carrying the values, and Android fills the fields. Hermit never submits the form (FR-FORM-01).

The values exist in Hermit's process only after step 6. Before that, the response holds the item's name only.

## What cannot be verified without the phone

- Which **Chrome version** on the S26 needs the "Autofill using another service" switch, and whether it then reports `webScheme` (without it the rule refuses with `no_web_scheme`).
- Whether Samsung Internet and Firefox report `webDomain` and `webScheme`, and whether the browser certificate digests computed on the phone equal the allowlist.
- **Package visibility** for native apps (see above).
- Inline chips on Samsung Keyboard and on Gboard, and the dropdown fallback.
- That the translucent auth activity and `BiometricPrompt` show over the other app on One UI, and that Android fills both fields from the returned dataset.
- That Samsung's settings page lists Hermit and that the confirmation intent works on One UI.
- Whether anything crashes on a structure we didn't foresee. The service catches exceptions and answers with nothing, so this would show as a missing suggestion, not a crash.

## Phone checks (the S26, a debug APK from this PR's apk job)

1. Open `hermit://autofill-debug`. It says "Hermit isn't the autofill service yet". Tap **Open autofill settings** and confirm Hermit in Android's dialog, or pick it under General management > Passwords, passkeys and autofill. Go back: it now says "Hermit is the autofill service".
2. In Chrome, turn on Settings > Autofill services > "Autofill using another service" and let Chrome restart.
3. In Chrome, open `https://the-internet.herokuapp.com/login` and tap the username field.
   - Expect a "Hermit test login" suggestion: an inline chip on the keyboard, or a dropdown.
   - Tap it, expect the fingerprint prompt "Fill with Hermit, For https://the-internet.herokuapp.com", and confirm.
   - Both fields fill with `tomsmith` and the password, and the login button stays the user's tap. Tapping it logs in ("You logged into a secure area!").
4. Back in `hermit://autofill-debug`, the last request shows:
   - package `com.android.chrome` and Chrome's certificate digest `8P1sW0EPJcslw7UzRsiXL64w-O50Ed-RBICtay1g24M`;
   - web `the-internet.herokuapp.com` with scheme `https`;
   - `match: true`, `offered: true`, `auth: "filled"`, and `inline` true or false.
5. Negative: open another site with a login form (for example `https://github.com/login`). There is no Hermit suggestion, and the debug screen shows `no_match` with that site's origin.
6. Cancel path: on the herokuapp page, tap the suggestion and cancel the fingerprint. Nothing is filled, and the debug screen shows `auth: "canceled"`.
7. A native app: open any installed app's login form (for example a bank or a test app) and tap the username field. In the debug screen the last request shows that package.
   - **Certificate digests present:** package visibility works. Tap **Trust this origin for the test login**, go back to the app, and the suggestion appears with the fingerprint, then fills.
   - **`no_signing_cert`:** record it for Q80.
8. Repeat step 3 in Samsung Internet and in Firefox if installed, and note whether each reports a scheme and whether its digest is the allowlisted one.
9. Repeat step 3 with Samsung Keyboard and with Gboard to see the inline chip and the dropdown.
10. Turn Hermit off as the autofill service (pick Samsung Pass again) and confirm the eval screen and chat behave as before.

## Recommended design for SL-33, SL-35 and SL-36

- **Keep the Kotlin service thin:** parse, identify, match, offer locked datasets. Every value and every decision about releasing it goes through Hermit's JS, so the cage stays the only gate (AGENTS.md rule 1):
  - `AutofillAuthActivity` opens Hermit's approval sheet (HM-APPR-01 for a login, HM-FORM-01 for a profile form);
  - the cage decides `credential` with the biometric (FR-CAGE-02) and writes the audit entry;
  - the native module hands the approved values back to the waiting activity.

  The spike's native `BiometricPrompt` is the stand-in for that sheet (Q79).
- **Origin index.** SL-33's vault keeps a small index of item id, name and origins, without secrets. FR-VAULT-02 already treats names and origins as non-secret. A Keystore key that needs no biometric encrypts the index, so the service can match before unlock and offer only where a credential exists. Secrets stay under the biometric-bound key and are decrypted only after the approval.
- **Stored app origins** are `android://<cert>@<package>`, captured when the user saves a login from an app. A web credential is never offered to a native app in V1.
- **Follow-up: Digital Asset Links.** Fetch `https://<domain>/.well-known/assetlinks.json`, through the app's network adapter, behind an approval and counted on the privacy screen. That would let a web login also serve that site's verified app. It is not needed for SL-36.
- **Key rotation.** The rule binds to the current signer only (`apkContentsSigners`). An app that rotates its key needs the user to trust it again. Accepting the rotation lineage (`PackageManager.hasSigningCertificate`) is a later refinement.
- **Delete everything** (SL-26) must also clear the index and the service's preferences. The spike's file is `hermit_autofill_spike`.
- **Settings row.** HM-SET-01's autofill row becomes live in SL-35: selected or not, with the same open-settings logic as the debug screen and the Chrome switch explained.

## Open questions logged

Q79 (the approval surface for autofill), Q80 (package visibility for native apps) and Q81 (which browsers are trusted and how the list is kept). See `docs/build/open-questions.md`.

## SL-35: the profile replaces the test login (2026-11-15)

The design above is built for profile forms (Q79, recommended option). The test login and its trusted origins are gone; the service now offers only the user's personal profile (HM-FORM-02), in release builds too. The diagnostics stay debug-only.

- **Offering.** The service classifies each text field (`FieldKinds.kt`, the mirror of `classifyField` in `packages/core/src/profile.ts`; both run `packages/core/test/profile-field-vectors.json` and check their tables against it). It keeps the kinds the profile has, from a small index Hermit writes (`hermit_autofill` preferences: kinds and which are sensitive, never a value), computes the exact origin of those fields with the SL-20 rule, drops sensitive kinds for an http page, and offers one locked dataset titled "Fill from your Hermit profile" with no values.
- **Approving.** `AutofillAuthActivity` re-parses, re-checks the origin, keeps the request in memory (`PendingFills`) and opens `hermit://fill?request=<id>` in Hermit's own task. HM-FORM-01 reads the request, the runtime recomputes the origin in TypeScript, plans the fields and the cage decides `fill_form` (a `send` that always asks; the vault's fingerprint when a field is sensitive; denied with nobody on screen). On approve the values go to `completeFill`, the activity returns the dataset, and Hermit moves its task to the back so the user is in the form again. A no, a timeout (2.5 minutes in the activity, 2 in Hermit) or a changed origin returns nothing.
- **Settings.** HM-SET-01's autofill row is live (selected or not, the same open-settings logic) and explains Chrome's switch and Samsung's page. The picker's settings link opens HM-FORM-02 in release builds.

### Phone checks for SL-35 (the S26, a debug APK from this PR's apk job)

1. In Hermit, open the menu, Personal profile. Add a first name, a last name, an email and an ID number (the ID asks for the vault's fingerprint; create the vault first if asked). The ID shows "Saved and protected".
2. Settings, Autofill: it says Off. Tap Open settings and pick Hermit (Samsung: General management > Passwords, passkeys and autofill). Back in Settings it says On. In Chrome, turn on Settings > Autofill services > Autofill using another service.
3. In Chrome, open a page with a name and email form (for example `https://www.w3.org/WAI/tutorials/forms/` examples, or any shop's checkout). Tap the name field: expect "Fill from your Hermit profile" (inline chip or dropdown), with no value shown.
4. Tap it. Hermit opens HM-FORM-01: Website with the exact origin, "Reported by Chrome", each field with its value. Tap Fill. Hermit goes to the back, the fields are filled, and the form is not submitted.
5. On a form that asks for an ID number (or a field named "dni", "cedula" or "national id"), the sheet shows it masked and the button says Fill with fingerprint; the fingerprint prompt is the vault's. Cancel it once: "Fingerprint not confirmed", nothing filled, the preview stays.
6. Tap Don't fill on another try: back in the form, nothing filled. In Activity, the rows read `fill_form` approved, denied, and ran.
7. Open an http page with a form (a router page or `http://` test site): plain fields offer and fill with "This page isn't secure"; the ID field is listed as not filled.
8. A native app with a name or address form (Q80): in `hermit://autofill-debug` the last request shows the package and its certificate digests. With digests, the suggestion appears and HM-FORM-01 names the app by package and signing key. With `no_signing_cert`, nothing is offered; record it for Q80.
9. Lock Hermit (app lock on), then tap a suggestion: the lock screen comes first, then HM-FORM-01. Kill Hermit, then tap a suggestion: Hermit starts cold, shows Reading the form request, then the preview.
10. Repeat step 3 in Samsung Internet and Firefox, and with Samsung Keyboard and Gboard.
11. Settings, Delete everything, then open the same form: no Hermit suggestion.

What could change the design: whether Android delivers the auth result to the form when the auth activity finishes while Hermit's task is in front (step 4; if not, the activity must come to the front before it finishes), and whether Chrome reports HTML labels or only names and ids (the word rules read both).

## SL-36: logging in with a vault login (2026-11-17)

The same flow as SL-35 (the locked dataset, `AutofillAuthActivity`, `PendingFills`, `hermit://fill`, `createFormFill`'s pending map with its atomic claim and the 2 and 2.5 minute timeouts), with a login instead of the profile.

- **Index.** Hermit writes the vault's logins into the `hermit_autofill` preferences (`LoginIndex.kt`, key `logins`): each item's id hash (`vaultItemHash`), its name and its exact origins, never the id, a username, a password or a note. It is rewritten at launch and after every add, edit, delete, import and start over, and Delete everything removes the file.
- **Offering.** `LoginFills` finds the username and password fields (`StructureParser.parse`), computes the requester's exact origin with the SL-20 rule and offers one locked dataset per login that stores exactly that origin (`loginsFor`, at most five), titled "Log in with Hermit: <name>" (Q114). The rule and the cap are in `packages/core/src/autofill-origin.ts` and `OriginMatch.kt`, and both run the `logins` vectors in `autofill-origin-vectors.json`: subdomains, parents, lookalikes, suffix tricks, other ports, http, sideloaded copies, untrusted browsers and malformed entries get nothing.
- **App logins.** An app's login is stored as its exact identity, `android://<cert>@<package>`, pasted on HM-VAULT-02 (Q113). A website's login is never offered to an app.
- **Approving (HM-APPR-01).** The auth activity checks the origin and that the picked login still stores it, then opens `hermit://fill`. The runtime checks both again, builds `fill_login` with the item's id hash, the origin and the requester (`android://<cert>@<package>` of the trusted browser, or of the app), and the cage decides it as a `credential`: denied with nobody on screen or after untrusted content, otherwise asked with the approval key. The sheet shows the login's name, who asks and which fields fill, never their values. Approve shows the approval key's system prompt, which reads the site (or the app and its key) and the browser from the signed payload (`ApprovalText.kt`); the runtime verifies the signature once, then the vault's own prompt opens the login (two fingerprints, Q112). Only then do the values go to the activity.

### Phone checks for SL-36 (the S26, a debug APK built from this branch)

1. Settings, Approval key: set it up with a fingerprint if it isn't ready.
2. Vault: add a login named "Heroku test" for `https://the-internet.herokuapp.com` with `tomsmith` and the page's demo password. In `hermit://autofill-debug`, nothing changes yet; Hermit is the autofill service and Chrome's "Autofill using another service" is on (SL-35 steps 1 and 2).
3. In Chrome, open `https://the-internet.herokuapp.com/login` and tap the username field. Expect "Log in with Hermit: Heroku test" (inline chip or dropdown), and no value shown. The debug screen's last request shows `logins: 1`.
4. Tap it. HM-APPR-01 shows "Log in with Hermit?", the login's name, Website `https://the-internet.herokuapp.com` reported by Chrome, Username and Password masked. Tap Approve with fingerprint: the system prompt says "Approve using this password", "Site: https://the-internet.herokuapp.com" and "Browser: com.android.chrome". Confirm; then the vault's prompt "Confirm it's you to open this login". Confirm. Hermit goes to the back, both fields are filled, and the page is not submitted; tapping Login logs in.
5. Activity: `fill_login` rows read proposed, asked, approved (with the signed payload's hash) and ran. No row shows the username, the password or the login's name.
6. Cancel paths: cancel the approval key's prompt (the sheet stays, "Fingerprint not confirmed"); approve it and cancel the vault's prompt (the sheet stays; the next Approve asks both prompts again). Nothing fills either time.
7. Negatives in Chrome: `https://herokuapp.com`, any other `*.herokuapp.com` page with a login form, and `http://the-internet.herokuapp.com/login` show no Hermit login suggestion (the profile suggestion may still appear for an email field).
8. Two logins for the same site: add a second one; the field shows two suggestions, each with its name; the one picked is the one filled.
9. A native app (Q80, Q113): with a test app whose digest the debug screen shows, add a login whose website is `android://<that digest>@<that package>`; the suggestion appears in the app and HM-APPR-01 names the app by package and key; the system prompt shows "App:" and "Signing key:". A sideloaded copy signed by another key gets nothing.
10. Edit the login (another password) while HM-APPR-01 is open, then approve: "This login changed", nothing filled.
11. Settings, Approval key, with the key lost (add a fingerprint in Android's settings): tapping the suggestion shows the key refusal with Set up the approval key.
12. Delete the login: the suggestion is gone. Delete everything: no Hermit login suggestion anywhere.

What could change the design: whether a second BiometricPrompt right after the first works on One UI without flicker (step 4; if not, Q112's one-prompt options become more urgent), and whether Chrome reports the username field with an autofill hint or only the email type (the parser reads both).
