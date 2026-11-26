#!/bin/bash
# The W1 gate (PRD 2.6): the first-win journey on the S26, guided. It drives what adb can (airplane mode, the
# chat through the dev-only hermit://?say= link, the activity screen), pauses for what needs a person (the
# test contact's WhatsApp message, the fingerprint), checks each step from logcat and the screen, and keeps
# screenshots and logs as evidence.
#
# Needs: the dev build installed and onboarded (model verified, notification and calendar access granted),
# Metro running (`pnpm --filter @hermit/mobile start`), adb reverse tcp:8081, the phone unlocked.
# Usage: scripts/phone/w1-journey.sh [contact name as WhatsApp shows it]
set -u
# Start Metro with a clean cache first (pnpm --filter @hermit/mobile start -- --clear): on 2026-11-14 its file
# watcher kept serving an old eval screen to the phone while serving the new one to curl.
pkg=io.dojocoding.hermit
contact=${1:-}
out=/tmp/w1-journey-$(date +%Y%m%d-%H%M%S)
mkdir -p "$out"
pass=0; fail=0; results=()

note() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { results+=("PASS  $1"); pass=$((pass + 1)); echo "  PASS  $1"; }
bad() { results+=("FAIL  $1"); fail=$((fail + 1)); echo "  FAIL  $1"; }
ask() { local a; read -r -p "  $1 [y/N] " a; [[ "$a" =~ ^[yYsS] ]]; }
shot() { adb exec-out screencap -p > "$out/$1.png" 2>/dev/null; }
screen_has() { adb shell uiautomator dump /sdcard/hermit-ui.xml > /dev/null 2>&1; adb shell cat /sdcard/hermit-ui.xml 2>/dev/null | grep -qi -- "$1"; }

# Send one chat message and wait for the turn to finish (the app logs "[hermit:journey] turn <kind>").
say() {
  local text=$1 n=$RANDOM
  local q; q=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$text")
  adb logcat -c
  adb shell am start -a android.intent.action.VIEW -d "hermit://?say=$q\&n=$n" "$pkg" > /dev/null
  for _ in $(seq 1 90); do
    adb logcat -d | grep -q "\[hermit:journey\] turn" && break
    sleep 2
  done
  adb logcat -d > "$out/log-$n.txt"
  grep -o "\[hermit\] step .*" "$out/log-$n.txt" | sed 's/^/    /'
  grep -o "\[hermit:journey\] turn .*" "$out/log-$n.txt" | tail -1 | sed 's/^/    /'
}
last_log() { ls -t "$out"/log-*.txt | head -1; }
step_ok() { grep -q "\[hermit\] step executed $1 true" "$(last_log)"; }

note "W1 journey on $(adb shell getprop ro.product.model | tr -d '\r'), evidence in $out"
adb get-state > /dev/null 2>&1 || { echo "No phone over adb."; exit 1; }
adb shell svc power stayon usb
adb shell input keyevent KEYCODE_WAKEUP
adb shell pidof "$pkg" > /dev/null || adb shell monkey -p "$pkg" 1 > /dev/null 2>&1
sleep 3

note "1. Install, verified model, permissions"
if ask "Is Hermit onboarded on this phone (model downloaded and verified, notification and calendar access granted)?"; then ok "onboarded with a verified model"; else bad "onboarding"; fi

note "2. Airplane mode on"
adb shell cmd connectivity airplane-mode enable > /dev/null 2>&1
sleep 3
if [ "$(adb shell settings get global airplane_mode_on | tr -d '\r')" = "1" ]; then ok "airplane mode on"; else bad "airplane mode (turn it on by hand and rerun)"; fi

note "3. \"recuerda que mi pasaporte vence en marzo\""
say "recuerda que mi pasaporte vence en marzo"; shot 03-remember
step_ok remember && ok "remember saved offline" || bad "remember"

note "4. \"recuérdame en 2 minutos tomar agua\" (fires offline) and the PRD's 9 PM reminder"
say "recuérdame en 2 minutos tomar agua"; shot 04-remind
step_ok remind && ok "reminder set offline" || bad "reminder set"
say "recuérdame llamar a mamá a las 9 de la noche"
step_ok remind && ok "9 PM reminder set" || bad "9 PM reminder"

note "5. \"¿qué tengo mañana?\""
say "¿qué tengo mañana?"; shot 05-agenda
step_ok calendar_read && ok "agenda read offline" || bad "agenda"

note "   Waiting for the 2-minute reminder to fire (still offline)"
fired=0
for _ in $(seq 1 30); do
  adb shell dumpsys notification --noredact 2>/dev/null | grep -A3 "pkg=$pkg" | grep -qi "agua" && { fired=1; break; }
  sleep 8
done
shot 05b-reminder-fired
[ $fired = 1 ] && ok "reminder fired offline" || { ask "No notification seen by adb. Did the 'tomar agua' reminder fire on screen?" && ok "reminder fired offline (seen by a person)" || bad "reminder fired offline"; }

note "6. Radio on, a WhatsApp message from the test contact"
adb shell cmd connectivity airplane-mode disable > /dev/null 2>&1
sleep 5
[ -z "$contact" ] && read -r -p "  Test contact's name as WhatsApp shows it: " contact
read -r -p "  From $contact's phone, send this phone a WhatsApp message now. Press Enter once it has arrived. " _
say "¿Me escribió $contact?"; shot 06-read
step_ok read_messages && ok "message read" || bad "message read"
screen_has "$contact" && ok "the reply names $contact" || bad "the reply names $contact"

note "7. \"dile que voy 10 minutos tarde\": approval sheet, fingerprint, reply arrives"
echo "  On the phone: check the sheet shows $contact and the warning that the chat read outside content, then approve with your fingerprint."
say "dile que voy 10 minutos tarde"; shot 07-replied
step_ok reply_message && ok "reply approved and sent" || bad "reply sent"
ask "Did 'voy 10 minutos tarde' arrive in WhatsApp on $contact's phone?" && ok "reply arrived in WhatsApp" || bad "reply arrived in WhatsApp"

note "8. Activity log: every step and \"Chain verified\""
adb shell am start -a android.intent.action.VIEW -d "hermit://activity" "$pkg" > /dev/null
sleep 4; shot 08-activity
(screen_has "Chain verified" || screen_has "Cadena verificada") && ok "chain verified" || bad "chain verified"

note "Result"
printf '%s\n' "${results[@]}" | tee "$out/result.txt"
echo "$pass passed, $fail failed. Evidence: $out"
[ $fail = 0 ] && echo "W1 GATE: PASS" || echo "W1 GATE: NOT YET"
