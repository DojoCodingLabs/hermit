# Building the Android app on the Mac

Q154 (2026-11-21): the native code also compiles on a local Mac. The steps mirror
`.github/workflows/android.yml`: `expo prebuild`, QVAC's worker bundle from the workspace root, the wallet worklet,
then Gradle. The result is the debug APK, the dev build: it loads JavaScript from Metro on the Mac over `adb reverse`,
so a JS change needs no rebuild. The first local build ran on 2026-11-21; its results are at the end.

## Prerequisites

- **Disk:** 15 GB free before a first build (`df -h /`). Hold under 10 GB, stop under 6 GB. Swap files grow on the same
  disk when memory runs short.
- **Memory:** the build machine has 16 GB. Run heavy commands one at a time.
- **JDK 17:** `/opt/homebrew/opt/openjdk@17`. `/usr/libexec/java_home` doesn't see it: export `JAVA_HOME` yourself.
- **Android SDK:** `$ANDROID_HOME` is `/opt/homebrew/share/android-commandlinetools`, with `platforms;android-37.0`,
  `build-tools;37.0.0`, `cmake;3.22.1` and `platform-tools`.
- **NDK 29.0.14206865** and no other. QVAC's Expo plugin writes it into the generated `android/build.gradle` (React
  Native 0.88's own default is 27.1.12297006), and Expo applies the root project's version to every native module.
  Check it after a prebuild: `grep ndkVersion apps/mobile/android/build.gradle`.
- **Node 22.21 or later, or 24.9 or later,** first on `PATH` for every Node step. QVAC's bundler refuses an older Node,
  such as 24.4.1, during the prebuild (`BARE_PACK_NODE_UNSUPPORTED`: bare-pack needs Node ^22.21.0 or 24.9.0 and
  later). CI's Node 24 is a later 24.x, so CI is not affected.
- **Network** for the first build: Gradle downloads its distribution and the dependencies (dl.google.com, Maven
  Central, the Gradle plugin portal), and the wallet worklet's build runs `npm ci` from the npm registry at every
  prebuild.

## One-time setup

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH
df -h /
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install "ndk;29.0.14206865"
pnpm install --frozen-lockfile --prefer-offline
```

Gradle's memory limits go on the command line, not in a `gradle.properties`: every prebuild rewrites
`apps/mobile/android/gradle.properties`, and the limits are for the build machine only. Nothing goes in `~/.gradle`.

- `--max-workers=2`: two Gradle tasks at a time.
- `-Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=1g"`: Gradle's own heap (the template asks for 2 GB, which a
  first build outgrows).
- `-Pkotlin.daemon.jvmargs=-Xmx1536m`: the Kotlin daemon would otherwise take Gradle's heap size again.
- `--init-script scripts/android/limit-native-jobs.init.gradle`: Ninja runs one clang per core in every native
  module's CMake build, and two workers doubled that (18 compilers at once on the first try). The script caps each
  CMake build at 3 compiles and 1 link. CI doesn't use it.

## Build

From the repository root:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH
df -h /
bash -c '
  set -e
  (cd apps/mobile && CI=1 npx expo prebuild --platform android --no-install)
  node scripts/qvac-bundle.mjs
  node apps/mobile/worklets/wallet/build.mjs
  cd apps/mobile/android
  ./gradlew --no-daemon --continue --max-workers=2 \
    -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8" \
    -Pkotlin.daemon.jvmargs=-Xmx1536m \
    --init-script ../../../scripts/android/limit-native-jobs.init.gradle \
    :app:assembleDebug :hermit-autofill:testDebugUnitTest :hermit-approval-key:testDebugUnitTest
'
```

What the three steps before Gradle do, in this order:

1. **`expo prebuild`** regenerates `apps/mobile/android` from `app.json` and the config plugins. QVAC's plugin bundles
   its worker, empties react-native-bare-kit's addon folder and links its worker's addons (37 files). The wallet plugin
   then packs the wallet bundle and adds its addons (44 files), and checks that it only added.
2. **`scripts/qvac-bundle.mjs`** rebuilds QVAC's worker bundle with the workspace root as project root, so the worker
   finds its plugin under pnpm's layout (from `apps/mobile` it fails on the phone with `CANNOT_READ`).
3. **`apps/mobile/worklets/wallet/build.mjs`** packs the wallet bundle again and adds its addons. It only adds files,
   so running it last keeps the wallet's addons whatever ran before it. CI runs the same step in the same place.
   On 2026-11-21 the addon folder held the same 81 files after each of the three steps: with `@qvac/sdk` 0.23.0,
   `qvac-bundle.mjs` doesn't touch it. A `pnpm install` that reinstalls react-native-bare-kit does empty it.

`--continue` lets every module report its compile errors in one run. After a change to Kotlin in
`apps/mobile/modules` only, Gradle alone is enough: skip the three steps. Run them again after a change to `app.json`,
a config plugin or a native dependency, and after a `pnpm install`.

## Where the APK lands

`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, arm64-v8a only. The module test reports are in
`apps/mobile/modules/<module>/android/build/test-results/testDebugUnitTest/`.

## Check the APK

From `apps/mobile/android`:

```sh
APK=app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/build-tools/37.0.0/aapt2" dump permissions "$APK"   # no VIBRATE
unzip -l "$APK" 'lib/arm64-v8a/libbare-*'                          # QVAC's and the wallet's addons
unzip -l "$APK" 'res/font/*'                                       # the six brand faces and three families
"$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer" dex packages --defined-only "$APK" \
  | awk '$1 == "P" { print $NF }' | grep -E '^(com\.google\.(firebase|android\.gms)|com\.android\.installreferrer|io\.sentry)'
```

To check that every addon of the wallet is in the APK, compare the folder with the APK's `lib/arm64-v8a`:

```sh
ADDONS=$(node -p "require('path').join(require('fs').realpathSync(require('path').dirname(require.resolve('react-native-bare-kit/package.json', { paths: ['../'] }))), 'android/src/main/addons/arm64-v8a')")
for f in $(ls "$ADDONS"); do unzip -l "$APK" "lib/arm64-v8a/$f" > /dev/null || echo "missing: $f"; done
```

## Install on the phone

```sh
adb devices                       # the phone listed as "device"
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
pnpm --filter @hermit/mobile start -- --clear
```

`-r` replaces the app and keeps its data (the downloaded model, the database, the Keystore keys). Every prebuild
copies the template's debug keystore, so local and CI debug builds share one signature. If `adb` answers
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the installed app was signed with another key, and uninstalling it erases its
data. The phone runbook (`docs/build/phone-runbook.md`, 1.2) has the rest of the session setup.

## Clean up

Sizes after the first build (2026-11-21):

| What | Size | How to remove it |
| :---- | :---- | :---- |
| `apps/mobile/android` (generated, the APK inside) | 2.3 GB | `rm -rf apps/mobile/android`; the next prebuild recreates it |
| Native modules' outputs under `node_modules/.pnpm` (`android/build`, `android/.cxx`) | 2.8 GB | the `find` below |
| Gradle's caches and its distribution (`~/.gradle/caches`, `~/.gradle/wrapper`) | 3.6 GB and 0.15 GB | `rm -rf ~/.gradle/caches ~/.gradle/wrapper`; the next build downloads them again |
| NDK 29.0.14206865 | 3.1 GB | `"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --uninstall "ndk;29.0.14206865"` |
| The wallet worklet's scratch install (`$TMPDIR/hermit-wallet-worklet`) | 0.36 GB | `rm -rf "$TMPDIR/hermit-wallet-worklet"`; every prebuild reinstalls it |

The native modules' outputs, from the repository root (only each package's top `android/build` and `android/.cxx`;
the addon folder the prebuild fills is under `android/src` and stays):

```sh
find node_modules/.pnpm -mindepth 3 -maxdepth 6 -type d \( -name build -o -name .cxx \) -path '*/android/*' -prune -exec rm -rf {} +
```

The build runs with `--no-daemon`, so no Gradle or Kotlin daemon is left behind; `pgrep -fl GradleDaemon` shows none.

## The first local build (2026-11-21)

- **It compiled with no source change.** The ten Hermit modules (approval key, autofill, browser, contacts, haptics,
  intents, night, notifications, SMS consent, vault) and the native libraries merged since the last green APK
  (2026-11-15 06:44 UTC): Reanimated 4.7.1 and Worklets 0.13.0 with their C++, react-native-svg 15.16.0, expo-font
  58.0.11 with the six faces, QVAC fabric 0.25.0, react-native-bare-kit 0.16.0 and the wallet worklet. All ten
  modules are in Expo's generated module list and in the APK's code.
- **Module JVM tests:** `hermit-autofill` 11 of 11 (FieldKindTest 4, LoginIndexTest 3, OriginMatchTest 4),
  `hermit-approval-key` 10 of 10 (ApprovalTextTest). No other module has JVM tests.
- **The APK:** 295,510,984 bytes. The largest parts: QVAC's Vulkan backend (76.5 MB), Bare Kit (62.5 MB), React Native
  (22.9 MB) and the debug build's unshrunk code.
- **The wallet's addons are in the APK:** all 54 arm64-v8a files of the addon folder, with the wallet's versions next
  to QVAC's (Q110), for example `libbare-tls` 3.2.1 and 4.1.0 and `libbare-crypto` 1.15.4 and 1.16.0.
- **Permissions:** VIBRATE was in every APK so far. Expo's prebuild template declares it and SYSTEM_ALERT_WINDOW as
  optional permissions, and `app.json`'s `permissions` only adds to the template, so `app.json` now blocks both
  (`apps/mobile/src/permissions.test.ts`). The debug APK keeps SYSTEM_ALERT_WINDOW: the template's `app/src/debug`
  manifest declares it for React Native's developer tools and outranks the main manifest; release builds have
  neither. React Native's debug library also adds ACCESS_LOCAL_NETWORK, for Metro.
- **Trackers:** `pnpm check:privacy` passes, and the APK has no analytics, crash reporting or attribution SDK: no
  `com.google.android.gms.measurement`, Crashlytics, Sentry or any other name on the denylist. It still carries what
  expo-notifications and expo-application bring: Firebase Cloud Messaging 25.0.1 with Firebase Installations 18.0.0,
  Firebase's data transport 18.2.0 (with `transport-backend-cct` 3.1.9), the measurement connector 19.0.0 (an
  interface only), `play-services-cloud-messaging` 17.2.0, `play-services-stats` 17.0.2, and the Play Install Referrer
  library 2.2. They stay idle: there is no `google-services.json`, so Firebase never starts, and `app.json` blocks the
  c2dm and install referrer permissions. A scanner that matches package names may still list Firebase
  (`com.google.firebase.analytics.connector`). Taking them out is the W1 item on expo-notifications in
  `docs/build/open-questions.md`.
- **Warnings, not errors:** the prebuild says `userInterfaceStyle` needs expo-system-ui (the template's theme already
  follows the phone's dark mode), and one Kotlin deprecation in `HermitNotificationListener` (`Bundle.get`).

## First checks on the phone for this build

The runbook has every check; these come first, because nothing here has run on a phone yet:

1. It installs and starts: no `FATAL EXCEPTION` or `UnsatisfiedLinkError` in `adb logcat` (libreanimated, libworklets,
   libreact_codegen_rnsvg, libop-sqlite, libbare-kit).
2. The brand faces render: titles in Newsreader, the interface in Instrument Sans, addresses in JetBrains Mono (runbook 8).
3. The crab moves (Reanimated and Worklets) and the icons draw (react-native-svg).
4. Haptics: a tick, a confirm and a reject, and nothing with the phone's touch feedback off; `aapt2 dump permissions`
   above already shows no VIBRATE.
5. The model loads and answers a turn (QVAC's worker bundle from the workspace root, no `CANNOT_READ`).
6. `hermit://wallet-debug`: the wallet worklet starts with no `CANNOT_LOAD` or `UNSUPPORTED_ENGINE`, then both worklets
   together (runbook 3, WDK in the worklet).
7. The in-app browser (SL-53), the SMS consent dialog at a code step (SL-56b), autofill and the approval key's prompts
   (SL-35 to SL-37): the Kotlin written since 2026-11-15 (runbook 5 and 6).

## The second local build (2026-11-24, `fix/model-threads`)

The branch sits on `w2/sl-48-49-imap` (PR #113), so this build compiled `hermit-tls` for the first time, together with
the allowed-cores code in `hermit-notifications`. Same recipe, plus `:hermit-notifications:testDebugUnitTest`; Gradle
ran 622 tasks in 6 min 45 s.

- **Gradle's caches were gone:** `~/.gradle/caches` had been deleted after the first build (only the wrapper was
  left), so this build downloaded them again: 3.9 GB.
- **It compiled with no source change:** `:hermit-tls:compileDebugKotlin` with no warning, and
  `:hermit-notifications:compileDebugKotlin` with the known `Bundle.get` deprecation in `HermitNotificationListener`.
- **Module JVM tests:** `hermit-autofill` 11 of 11, `hermit-approval-key` 10 of 10, `hermit-notifications` 4 of 4
  (CpuAffinityTest, new).
- **The APK:** 295,560,228 bytes. Permissions as on 2026-11-21, with no VIBRATE. The 36 `libbare-*` files, the wallet's
  versions next to QVAC's, and all 54 files of the addon folder. The six faces and three families. The same dex
  packages as before: Firebase Messaging and Installations and the install referrer, idle, and no measurement,
  Crashlytics or Sentry. `io.dojocoding.hermit.tls.HermitTlsModule` and `io.dojocoding.hermit.notifications.CpuAffinity`
  are in the dex.
- **Disk:** free space fell from 15 GB to 5.7 GB by the end of Gradle (other jobs ran meanwhile), under the 6 GB
  floor as the build finished. Right after, the native outputs (the `find` above), `app/build/intermediates` and
  `app/.cxx` were deleted, keeping the APK, and free space came back to 9.6 GB. Gradle's caches (3.9 GB) stay for the
  next build; without them, keep 15 GB free before building.

## The release APK (the Device lab's preview build)

The preview APK on GitHub Releases is a release build: the JavaScript bundle is inside (the React Native Gradle
plugin runs Expo CLI's `export:embed`), so it runs without Metro. Two things differ from the debug build:

- **R8 is on.** QVAC's Expo plugin sets `enableMinifyInReleaseBuilds` and `enableShrinkResourcesInReleaseBuilds`
  through expo-build-properties, so release builds shrink the code and resources. Expo modules ship keep rules for
  their `Module` classes, Hermit's included.
- **Signing comes from the environment.** `apps/mobile/plugins/with-release-signing.js` edits the generated
  `app/build.gradle` so the release build signs with the key in `HERMIT_RELEASE_STORE_FILE`,
  `HERMIT_RELEASE_STORE_PASSWORD`, `HERMIT_RELEASE_KEY_ALIAS` and `HERMIT_RELEASE_KEY_PASSWORD` (or the Gradle
  properties `hermitReleaseStoreFile` and so on). Without them it signs with the debug key and Gradle warns. The
  public repository's `release-apk.yml` decodes the preview key from its secrets into the runner's temp folder.

For a local check, sign with a throwaway key made in `/tmp` and deleted afterwards, never the preview key. The same
three steps as the debug build, then `assembleRelease`:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH
KS=$(mktemp -d /tmp/hermit-throwaway-XXXXXX); openssl rand -hex 16 > "$KS/pw"
keytool -genkeypair -keystore "$KS/release.jks" -storetype PKCS12 -alias throwaway -keyalg RSA -keysize 2048 \
  -validity 2 -dname "CN=Throwaway local test key" -storepass:file "$KS/pw" -keypass:file "$KS/pw"
df -h /
bash -c "
  set -e
  (cd apps/mobile && CI=1 npx expo prebuild --platform android --no-install)
  node scripts/qvac-bundle.mjs
  node apps/mobile/worklets/wallet/build.mjs
  cd apps/mobile/android
  HERMIT_RELEASE_STORE_FILE=$KS/release.jks HERMIT_RELEASE_STORE_PASSWORD=\$(cat $KS/pw) \
  HERMIT_RELEASE_KEY_ALIAS=throwaway HERMIT_RELEASE_KEY_PASSWORD=\$(cat $KS/pw) \
  ./gradlew --no-daemon --max-workers=2 \
    -Dorg.gradle.jvmargs='-Xmx3g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8' \
    -Pkotlin.daemon.jvmargs=-Xmx1536m \
    --init-script ../../../scripts/android/limit-native-jobs.init.gradle \
    :app:assembleRelease
"
APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify --print-certs "$APK"   # the throwaway key's certificate
unzip -l "$APK" 'assets/index.android.bundle'                              # the JavaScript inside
unzip -l "$APK" | grep -c '\.gguf$'                                          # 0: the model is downloaded, never packed
shasum -a 256 "$APK"; stat -f %z "$APK"
rm -rf "$KS"
```

### First attempt (2026-11-25, `launch/devicelab`)

Stopped by the disk before the APK was written. Free space fell from 16 GB to 5 GB while Gradle ran (other jobs
ran meanwhile), and the build was stopped at the 6 GB floor during `:app:minifyReleaseWithR8`, the last step before
packaging. By then 1,221 tasks had run: every native module's release CMake build, every Hermit module's
`compileReleaseKotlin` (the Device lab's new `hermit-notifications` calls included), and the release JavaScript
bundle (`index.android.bundle`, 34 MB). Gradle's caches grew from 3.9 GB to 5.6 GB with the release tools (R8 and
the release dependencies). Keep at least 18 GB free before a release build. Afterwards `apps/mobile/android`, the
modules' `android/build` folders and the native outputs under `node_modules/.pnpm` were deleted (the checkout went
from 8.5 GB to 3.5 GB), and the throwaway key with them.
