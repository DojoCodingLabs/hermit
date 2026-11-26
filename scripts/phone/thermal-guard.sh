#!/bin/bash
# Samples the phone's thermal state every 5 s into a CSV and force-stops Hermit at status >= 4 (severe),
# the standing rule for phone evals. Usage: scripts/phone/thermal-guard.sh [out.csv]
out=${1:-/tmp/hermit-thermal.csv}
pkg=io.dojocoding.hermit
[ -f "$out" ] || echo "time,status,skin_c,cpu_max_c" > "$out"
while true; do
  dump=$(adb shell dumpsys thermalservice 2>/dev/null) || { sleep 5; continue; }
  status=$(echo "$dump" | grep -m1 "Thermal Status:" | awk '{print $3}')
  skin=$(echo "$dump" | grep -A40 "Current temperatures from HAL" | grep -m1 -i "skin" | sed -E 's/.*mValue=([0-9.]+).*/\1/')
  cpu=$(echo "$dump" | grep -A80 "Current temperatures from HAL" | grep -i "cpu" | sed -E 's/.*mValue=([0-9.]+).*/\1/' | sort -n | tail -1)
  echo "$(date +%H:%M:%S),${status:-?},${skin:-?},${cpu:-?}" >> "$out"
  if [ "${status:-0}" -ge 4 ] 2>/dev/null; then
    adb shell am force-stop "$pkg"
    echo "$(date +%H:%M:%S) SAFETY STOP at status $status skin $skin" >> "$out"
  fi
  sleep 5
done
