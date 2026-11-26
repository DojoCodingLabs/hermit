# Mascot v2: decisions

The crab is the reference drawing (`docs/brand/logo/source/reference-drawing.png`). Until now the app showed it as small static PNGs. Mascot v2 draws it as vectors from the rig's own traced pieces and moves it only by moving, turning and scaling those pieces. Nothing is redrawn, restyled or recolored. The proof is `index.html` next to this file (run `node apps/mobile/preview/mascot/proof.mjs` to fill it).

Design detail, logged as Q153 in `docs/build/open-questions.md`.

## 1. The drawing is generated, never drawn

- **What:** `scripts/brand/mascot_app.py` imports `scripts/brand/mascot.py` and runs its `render()` for every pose with a recording `Layers`. It writes `apps/mobile/src/mascot-rig.ts`: the seven traced paths of `docs/brand/mascot/parts.json` (only whitespace normalized), each pose's transforms (the rig's own strings, as matrices, and as translate, rotate and scale about the piece's pivot), which claws and props cut their paper gap, the carved peek eyes, the closed-eye strokes and the props.
- **Why recorded, not re-implemented:** the generator asserts that render()'s layer order is the app's fixed order and that every transform round-trips, so a change to the rig fails loudly instead of drifting. The module header carries the SHA-256 of `parts.json`, `mascot.py` and the generator; a test fails when they change without regenerating.
- **Rest frames equal the rig:** every pose's numbers reproduce the rig's matrices (three independent ways in `mascot.test.ts`). In the browser, the component's own SVG drawn the way the PNGs were is pixel-identical to the rig's SVG in all 38 renders (19 poses, light and dark).

## 2. Rendering: one SVG, the rig's layers

- The scene (`apps/mobile/src/mascot-scene.ts`) layers the drawing exactly as `Layers` does: a piece that cuts wraps everything drawn before it in a mask that removes the piece grown by its 13-unit paper gap; the peek eyes are carved out of the shell. react-native-svg draws it with `Mask` and `G`.
- **A moving crab keeps one tree for life.** Every layer a cut could need is a group, and a cut only switches its mask on. Pieces never remount mid-motion. A still crab gets only the layers its pose uses.
- **Colors:** ink and sea glass on light, foam and glow on dark, the pearl's paper highlight in both, as in `mascot.py`.

## 3. The animation library: Reanimated, on the UI thread

**Decision:** React Native Reanimated 4.7.1 with React Native Worklets 0.13.0, the versions Expo 58 bundles (`expo/bundledNativeModules.json`). Pieces move through `useAnimatedProps` on react-native-svg; the whole picture moves through `useAnimatedStyle` on a view.

**Why not Animated with the native driver on views wrapping parts:**
- The rig's paper gaps are masks inside one drawing. A claw that moves over the shell must cut its gap into the shell and head under it on every frame, or pieces touch, which the brand forbids ("pieces never touch"). A view cannot cut a hole in a sibling view, so pieces as separate views would lose the gaps while moving, or need a third native module (a masked view) that still could not follow the motion.
- The native driver animates only view transforms and opacity. It cannot drive react-native-svg's `matrix`, `opacity` or `strokeWidth`, which is what a moving piece and its growing gap are.
- With Reanimated the whole move runs on the UI thread: the frame is computed in a worklet from the pure engine (`apps/mobile/src/mascot-motion.ts`), so the crab stays smooth while the chat streams tokens on the JS thread. JS only sends one command per pose change and schedules sparse idle events.

**What it costs, and how each cost is handled:**
- A native dependency: the app needs a new development build (it already uses one for QVAC). Reanimated 4.7 needs the New Architecture, which the app has on (`newArchEnabled`), and React Native 0.86 to 0.88 (the app is on 0.88.1).
- The Babel plugin: `babel-preset-expo` 58 adds `react-native-worklets/plugin` by itself when it resolves from the app, which it now does as a direct dependency. Expo's SDK 58 page says no other configuration is needed, so there is no `babel.config.js`.
- One copy of each native module: the lockfile already carried Worklets 0.13.1 through expo-router's drawer; the app now pins Expo's 0.13.0 and pnpm resolves everything to it.
- The privacy check: neither package is on the deny list (`pnpm check:privacy` passes). Both are credited on the licenses screen (`licenses.ts`, MIT).
- The preview harness (esbuild and react-native-web, no Babel): it never loads Reanimated. `components/mascot-player.web.tsx` draws the same scene with DOM SVG and steps the same engine with `requestAnimationFrame`; esbuild picks it by its `.web.tsx` extension, Metro never does. The shared harness builds and shoots the chat, welcome and refused-card screens with no errors.

## 4. Performance and battery

- **Pieces move only while a pose changes** (about half a second to a second and a half). Only then does react-native-svg redraw the crab every frame.
- **Loops move the whole picture as a view transform** (breathing, the bob). That is a compositor property: the drawing is not redrawn for them.
- **When nothing moves, nothing runs.** Every clock is a Reanimated timing that ends with its motion. Idle life is a few short events (a breath, a blink) scheduled by JS timers, with nothing running between them. Breaths stop 45 s after the last pose change; blinks go on, a few hundred milliseconds of work every few seconds.
- **Still crabs start no player.** A crab that has not changed pose is a plain drawing. Rows of small crabs (wallet history) never touch Reanimated.
- **Background and unmount:** `AppState` leaving `active` stops every animation and timer and rests the crab on its pose; returning restarts only the loops. Unmounting cancels everything.
- **Size:** the moving drawing is the header crab at 64 dp; heroes (96 to 148 dp) move only on a change. The phone checks below measure it.

## 5. Who moves

- **Live** (`useAppearance().motion` and `animate` not false): pose changes spring.
- **Ambient** (live and at least 56 dp wide: the header, empty states, onboarding, the wallet): also breathes, blinks and bobs. Smaller crabs are marks in a row, a sheet or a card: they only change pose. A list that remounts its rows would otherwise replay arrivals while scrolling.
- **Reduced motion and Quiet mode** follow Q52 and HM-SET-06 through the app's own `useAppearance()`, which reads `AccessibilityInfo.isReduceMotionEnabled` and its change listener: Quiet mode hides the crab; reduced motion keeps it, still, in the rig's rest pose, and pose changes swap. `animate={false}` asks for the same stillness.

## 6. The motion, pose by pose

Every number is in `mascot-motion.ts`; `mascot.test.ts` checks the bounds.

| Pose | Change into it | On arrival | While it lasts |
|---|---|---|---|
| idle | `pose` spring | nothing | breaths, blinks |
| hello | `pose` spring: the left claw rises to WAVE_L | two swings of the claw, then rest | breaths, blinks |
| thinking | `pose` spring: eyes look up, dots rise in | nothing | slow bob, blinks |
| working | `pose` spring: the claw lifts the note | nothing | quicker bob with a slight rock, blinks |
| asking | `pose` spring: the claw holds the envelope up | a lean toward it, then still | rare blinks, no breath |
| done | `pose` spring: eyes close, the envelope is set down | a short settle | breaths |
| error | `pose` spring: the claw droops, the envelope falls, eyes look at it | one recoil | rare blinks |
| blocked | `tuck` spring: the head slides into the shell, the claws shut the door | one recoil | nothing |
| offline | `tuck` spring, the plane rises in | nothing | nothing |

**Springs** (a spring is how long it takes and how much it settles):
- `pose`: response 0.52 s, damping ratio 0.86 (stiffness 146, damping 20.8, mass 1). About 1% overshoot: a soft landing, no visible bounce. Settles in about a second.
- `tuck`: response 0.38 s, damping ratio 0.9 (stiffness 273, damping 29.8). Pulling in is a reflex.
- An interrupted move keeps its velocity: a pose change mid-flight bends the path instead of restarting it.

**Follow-through and fades:**
- Claws start 30 ms after the head, from rest. A prop already shown follows its claw by 40 ms.
- A piece coming into view waits 90 ms, then fades in over 240 ms, ease-out quint. A prop coming into view waits 200 ms for the claw that holds it, rises 10 units into place and fades in the same way. Going out of view: at once, 160 ms, ease-in cubic. These are the app's motion tokens (`duration.medium`, `duration.short`, `easing.standard`, `easing.exit` in the polish round's `src/motion.ts`).
- Eyes closing or opening in a change: 110 ms after 40 ms.
- A hidden piece waits inside the shell at opacity 0 (the head 26 units back and 30 up, at 90%), so a rest frame shows exactly the rig, and a change passes through it: the head slides into the shell instead of vanishing.

**The hello wave:** two swings of 16 degrees about the claw's wrist, 620 ms each, starting 260 ms in, eased in over the first 30% of a swing and out over the last half. About 1.5 s in all, then exactly the rig's hello.

**Body moves** (the whole picture, about its feet; full size from 112 dp, proportionally less below; never more than 2 dp, 3 degrees or 2% scale):
- Breath: 3.4 s, 1 minus cosine: 1.2% taller and 0.6% wider, then back. A pause of 0.7 to 2.4 s between breaths.
- Blink: the rig's closed-eye strokes for 120 ms. Every 2.8 to 6.2 s at rest, 2.6 to 5.6 s thinking, 3 to 6.5 s working, 4.2 to 8.5 s asking or after an error. One in eight is double (120 shut, 110 open, 120 shut).
- Bob: thinking rises 1.6 dp and back every 2.8 s; working every 2 s with a 0.6 degree rock. It eases in over its first cycle.
- Lean (asking): 2.2 degrees and 1 dp toward the raised claw, ease-out over 280 ms, held to 700 ms, eased back by 1.4 s.
- Settle (done): a 1.6 dp dip with a 0.8% squash, a damped spring (response 0.42 s, damping 0.55) starting 260 ms in, gone by 900 ms.
- Recoil (error, blocked): back and up 1.4 dp with a 2.4 degree tilt, one damped kick (response 0.34 s, damping 0.6), gone by 800 ms. It never loops.

## 7. Two motion choices

- **Asking: an attentive, still lean.** The rest frame must equal the rig's asking pose, so a lean held forever would break that rule. The crab leans in as it raises the envelope, then comes back to the rig's pose and holds perfectly still (no breathing), with rare blinks: attentive, waiting for you.
- **Thinking and working: a bob, not a peek loop.** The peek pose pulls the crab into its shell; looping it would read as hiding, and would redraw the drawing on every frame while the model runs on the same phone. The bob is a compositor move that costs no redraw. The peek pose stays available as a rig pose.

## 8. Phone checks (native code, checked on a phone)

1. **Smooth while streaming:** on the S26, send a message that streams a long answer and uses a tool, so the header crab goes thinking, working, done while tokens arrive. Expect no dropped frames in the crab (Android GPU profiling bars, or `adb shell dumpsys gfxinfo io.dojocoding.hermit framestats`); the springs must not stall when the JS thread is busy.
2. **Pose changes look right on device:** the claw's paper gap follows it over the shell (working, asking, hello), the tuck closes the door, the envelope falls on error. Compare with the clips on the proof page.
3. **Reduced motion:** turn on the phone's Remove animations (on the S26: Settings, Accessibility, Visibility enhancements, Remove animations), then return to Hermit without restarting it. The crab must stop at once, rest on its pose, and swap poses without moving. Quiet mode must still hide it.
4. **No battery drain when idle:** leave the empty chat (hello, breathing and blinking) on screen for 10 minutes, then background the app for 10 minutes. Expect Hermit near zero in Settings, Battery, and no frames rendered in the background (`dumpsys gfxinfo` total frames unchanged). On screen, the display should drop to its low refresh rate between blinks once breaths stop (after 45 s).
5. **First frame:** opening a screen with a crab must never flash a piece out of place (each moving piece gets its first position as plain props).
6. **TalkBack** skips the crab; the label beside it says the same.

## 9. Files

- Generator: `scripts/brand/mascot_app.py`. Output: `apps/mobile/src/mascot-rig.ts`.
- Engine and scene: `apps/mobile/src/mascot-motion.ts`, `apps/mobile/src/mascot-scene.ts`, `apps/mobile/src/mascot.ts`.
- Components: `apps/mobile/src/components/Mascot.tsx` (props unchanged, adds optional `animate`), `MascotArt.tsx` (the director), `mascot-player.tsx` (phone), `mascot-player.web.tsx` (preview).
- Tests: `apps/mobile/src/mascot.test.ts`.
- Proof: `apps/mobile/preview/mascot/` (page, build, proof), `docs/design/mascot/index.html`, outputs in `docs/design/mascot/out/` (gitignored).
