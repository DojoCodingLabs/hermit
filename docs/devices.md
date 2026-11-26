# Hermit on your phone: the preview APK and the Device lab

Hermit runs a small model on the phone itself, so how fast and how well it works depends on the phone. The Device lab
measures that: it runs a fixed benchmark offline and builds a short report with device and benchmark facts only. You
read the report, and if you like, you file it on GitHub, where it joins the table at the end of this page. Reports from
many phones are how Hermit's speed and accuracy get tuned for each one.

Nothing is ever sent on its own. There is no server and no telemetry: the report leaves the phone only when you file
it, copy it or share it.

## 1. Install the preview APK

Preview APKs are published on the [Releases page](https://github.com/DojoCodingLabs/hermit/releases), newest first.
Each one is a release APK with the app's code inside, signed with the project's preview key. You can also build it
yourself (below).

**What the phone needs:** Android 13 or later on a 64-bit ARM processor (arm64-v8a). Hermit is built for phones with
8 GB of memory or more. With less, the app says so and lets you continue; those reports help the most.

1. **Download** `hermit-<version>.apk` from the release, on the phone or on a computer.
2. **Check the file.** The release notes give the APK's SHA-256. Compare it with the file you have:
   - macOS: `shasum -a 256 hermit-<version>.apk`
   - Linux: `sha256sum hermit-<version>.apk`
   - Windows (PowerShell): `Get-FileHash hermit-<version>.apk -Algorithm SHA256`

   If the two don't match, don't install it. The notes also give the SHA-256 of the signing certificate; with the
   Android SDK you can compare it with `apksigner verify --print-certs hermit-<version>.apk`.
3. **Install it.** Open the APK on the phone. Android asks you to allow installs from the app that opened it (your
   browser or file manager): allow it for that app, then go back and tap Install. Play Protect may warn that it
   doesn't know the app, because it isn't from the Play Store; choose to install anyway. From a computer,
   `adb install hermit-<version>.apk` does the same. Android keeps some settings restricted for apps installed this
   way: when Hermit asks for notification access and Android says the setting is restricted, open Hermit's App info,
   tap the three dots, then **Allow restricted settings**.
4. **First run.** Hermit downloads its model once, about 530 MB (Wi-Fi is best), and checks it against a pinned
   SHA-256 before using it. The model isn't in the APK. After that, Hermit works offline.

A newer preview installs over an older one and keeps everything, because both carry the same key. Uninstalling
erases Hermit's data, including the downloaded model.

### Or build it yourself

The preview APK is an ordinary release build of `apps/mobile`. Set up as [CONTRIBUTING.md](../CONTRIBUTING.md) says
for the Android app, then build `:app:assembleRelease` instead of `:app:assembleDebug`. A release build carries the
app's code, so it runs without Metro. It signs with the key you name when Gradle runs, in the environment or as Gradle
properties (for example in `~/.gradle/gradle.properties`), never in a file in the repository:

| Environment | Gradle property |
| :---- | :---- |
| `HERMIT_RELEASE_STORE_FILE` | `hermitReleaseStoreFile` |
| `HERMIT_RELEASE_STORE_PASSWORD` | `hermitReleaseStorePassword` |
| `HERMIT_RELEASE_KEY_ALIAS` | `hermitReleaseKeyAlias` |
| `HERMIT_RELEASE_KEY_PASSWORD` | `hermitReleaseKeyPassword` |

Without them the release build is signed with the debug key and Gradle says so: fine on your own phone. An APK
signed with a key other than the preview's won't install over the preview: Android asks you to uninstall it first,
which erases Hermit's data.

### Run it on an iPhone (development build)

There is no iPhone release yet, but you can build Hermit for your own iPhone, chat with it and run the Device lab.
You need a Mac with Xcode, an Apple developer team and an iPhone with Developer Mode on. From the
repository root:

```sh
pnpm install
(cd apps/mobile && npx expo prebuild -p ios)
node scripts/qvac-bundle.mjs                 # required: without it the QVAC worker aborts with CANNOT_READ
(cd apps/mobile/ios && pod install)
(cd apps/mobile/ios && xcodebuild -workspace Hermit.xcworkspace -scheme Hermit -configuration Release \
  -destination generic/platform=iOS -derivedDataPath build -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=<your team id> PRODUCT_BUNDLE_IDENTIFIER=<your own id>)
xcrun devicectl device install app --device <device id> \
  apps/mobile/ios/build/Build/Products/Release-iphoneos/Hermit.app
```

The Release configuration puts the app's code inside, so it runs without Metro. Set the team and, if the bundle id is
already taken for your team, your own bundle id on the command line as above, never in a file. `xcrun devicectl list
devices` gives the device id. The first time, trust your developer account on the iPhone: Settings, General, VPN &
Device Management.

On an iPhone, Hermit is still missing pieces. Today:

- Payments and logins are refused, because there is no Secure Enclave approval key yet. The vault and the wallet are
  off.
- There is no WhatsApp capture and no night shift.
- **Delete everything** before you delete the app: iOS keeps an app's Keychain entries (Hermit's database key and
  tokens) after the app is gone.
- A stopped model download starts again from zero.
- The Device lab report has the Android shape, so on an iPhone you copy or share it; it isn't filed into the device
  table yet.
- iOS thermal states are mapped onto Android's scale: nominal 0, fair 1, serious 3, critical 4.

## 2. Run the Device lab

Open **Settings**, then **Device lab**, and tap **Start the lab**. We expect about 10 minutes on a mid-range phone;
none has run it yet, so your report sets the real number.

- Keep Hermit open on that screen. The screen stays on while the lab runs; leaving the screen stops the lab, because
  Android gives an app in the background fewer cores and the numbers would no longer compare.
- If the phone gets hot (Android's thermal status reaches severe), the lab pauses until it cools down, then carries
  on. The report counts the pauses.
- Battery saver slows the phone down. The lab runs anyway and the report says it was on.

What it runs, in order:

1. **The phone's facts:** maker and model, chip, memory, Android version, processor cores and their top clocks, the
   CPU features llama.cpp uses, the cores Android lets the app use on screen, the thermal status and battery saver.
2. **The speed probe:** the same fixed prompt at the thread count Hermit plans for this phone, then at 2 and 4
   threads (never more than the cores the app may use). Each count loads the model, makes one warm-up call and two
   measured ones: tokens per second while writing, tokens per second while reading the prompt, and the time to the
   first token.
3. **The accuracy pass:** 12 of Hermit's public first-win cases (6 in Spanish, 6 in English: reminders, notes,
   calendar, messages, a question back and a request Hermit can't do), on the lab's fixed clock (Wednesday
   2026-11-11, 21:00, America/Costa_Rica) so every phone answers the same questions at the same "now". Each case
   checks the first action Hermit picks and times it.

The model runs the way the app runs it on this phone: the shipped profile with this phone's plan (threads, context,
thinking budget), and the same settings whatever the heat, so the runs compare.

## 3. File the report

When the lab ends, the screen shows the report in plain words first, then the exact text that would be shared.

- **File it on GitHub** opens the project's
  [Device report form](https://github.com/DojoCodingLabs/hermit/issues/new?template=device_report.yml) in your
  browser with the report filled in. Sign in to GitHub, tick the box that says the report contains no personal data,
  add a note if you like, and press Submit. Nothing is filed until you do. If the report is too long for a link, the
  app copies it and opens the empty form: paste it into the Report field.
- **Copy** and **Share** give you the same text, to file it later or from another device.

Then a workflow in this repository checks the report against [the schema](devices/schema.json) and the privacy rules
below. It never runs anything from the issue: it reads the report as data. If the report passes, the workflow commits
it as `data/devices/<phone>-<hash>.json` to the `device-data` branch and comments on your issue with the link. A
maintainer merges that branch through a pull request, and then your report appears in the table below. If something
is wrong, the comment says what; edit the issue to fix it and the check runs again.

To check a report yourself: `node scripts/devices/validate.mjs report.json`.

## What a report holds

| Part | Fields |
| :---- | :---- |
| `schema`, `app`, `model` | The report format (`hermit-device-report/1`), the app version, and the model profile the lab ran |
| `device` | Maker (`Build.MANUFACTURER`) and model code (`Build.MODEL`), chip (`Build.SOC_MODEL` on Android 12 and later, else the `Hardware` line of `/proc/cpuinfo`, else `Build.HARDWARE`) and its vendor, total memory in GB, Android version and API level, primary ABI, core count, each core's top clock, and the CPU features dotprod, i8mm, SVE2 and SME2 |
| `runtime` | Hermit's plan for the phone (tier, threads, core mask, context, batch, thinking budget, fast route), the cores Android allowed the app on screen and its cpuset, the thermal status at the start and the highest during the run, and whether battery saver was on |
| `speed` | Tokens per second writing and reading, the time to the first token and the model's load time at the plan's thread count, and the same for each other count tried |
| `eval` | Cases right out of cases run, the median and 90th percentile time to the first action, and for each case its id, whether it was right, its time and the action picked; never the case's text |
| `run` | How long the run took, how many times and how long it paused for heat, and the day (UTC), never the time |

**Never in a report:** your name, accounts, contacts, messages, calendar, notes, location, photos, or anything you
typed; the device name you set; and no number that identifies the phone (serial, IMEI, Android ID, advertising ID).
The schema lists every field a report may have and refuses any other, and the check also refuses any text that looks
like an email address, a web address, a phone number or an identifier. Your GitHub issue is public, like any issue:
the account you file it with shows there.

## The device table

Generated from `data/devices` by `node scripts/devices/table.mjs`; don't edit it by hand. Tokens per second, the first
token and the threads are at the thread count Hermit plans for each phone; "Right" counts the 12 accuracy cases.
To compare each phone's planned thread count with the other counts its report timed, run
`node scripts/devices/plans.mjs`; it only prints, and marks a row where another count was more than 10 percent faster.

<!-- device-table:start -->
No reports yet. Run the Device lab and file yours: the steps are above.
<!-- device-table:end -->
