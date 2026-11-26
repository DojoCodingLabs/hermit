#!/bin/bash
# Start Metro with a clean cache first (pnpm --filter @hermit/mobile start -- --clear): on 2026-11-14 its file
# watcher kept serving an old eval screen to the phone while serving the new one to curl.
# Runs the on-phone eval one profile at a time (hermit://eval?p=<id>), cooling down between runs until
# thermal status <= 1 and skin < 40 C. Needs the dev build and Metro, and thermal-guard.sh running.
# Usage: scripts/phone/eval-runs.sh <profile-id>... ; results: [hermit:eval] lines in logcat and $LOG.
LOG=${LOG:-/tmp/hermit-eval-runs.out}
pkg=io.dojocoding.hermit
cool() {
  while true; do
    dump=$(adb shell dumpsys thermalservice)
    s=$(echo "$dump" | grep -m1 "Thermal Status:" | awk '{print $3}')
    skin=$(echo "$dump" | grep -A40 "Current temperatures from HAL" | grep -m1 -i skin | sed -E 's/.*mValue=([0-9.]+).*/\1/')
    if [ "${s:-9}" -le 1 ] && [ "$(echo "${skin:-99} < 40" | bc)" = 1 ]; then return; fi
    echo "$(date +%H:%M:%S) cooling: status $s skin $skin" >> "$LOG"; sleep 30
  done
}
# The eval link only runs in the foreground: keep the screen on over USB and refuse to start on a locked phone.
adb shell svc power stayon usb
awake() {
  adb shell input keyevent KEYCODE_WAKEUP
  adb shell wm dismiss-keyguard
  sleep 2
  if adb shell dumpsys window | grep -q "mCurrentFocus=.*\(Bouncer\|Keyguard\|NotificationShade\)"; then
    echo "$(date +%H:%M:%S) phone is locked: unlock it, waiting" >> "$LOG"
    until ! adb shell dumpsys window | grep -q "mCurrentFocus=.*\(Bouncer\|Keyguard\|NotificationShade\)"; do sleep 10; done
  fi
}
for p in "$@"; do
  cool
  awake
  adb logcat -c
  echo "=== $p start $(date +%H:%M:%S)" >> "$LOG"
  adb shell am start -a android.intent.action.VIEW -d "hermit://eval?p=$p" "$pkg" > /dev/null
  until adb logcat -d | grep -q "\[hermit:eval\] done"; do
    sleep 20
    adb shell pidof "$pkg" > /dev/null || { echo "=== $p app stopped (safety stop?)" >> "$LOG"; break; }
  done
  adb logcat -d | grep -E "\[hermit:eval\]|\[hermit:S1\].*completion" >> "$LOG"
  echo "=== $p end $(date +%H:%M:%S)" >> "$LOG"
  adb shell am force-stop "$pkg"
done
echo "all done" >> "$LOG"
