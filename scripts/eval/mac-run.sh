#!/bin/bash
# One Mac eval run against llama-server on :8090 (see "The Mac lab" in docs/evals.md), at low priority.
# HERMIT_HEAVY is an optional command prefix, for example a lock that runs one heavy job at a time. It is empty by
# default, so the run starts directly.
# Usage: PROFILE=<id> scripts/eval/mac-run.sh <outname> [--set va|holdout|holdout2|messaging|memdec]
root=$(cd "$(dirname "$0")/../.." && pwd)
out=$1; shift
mkdir -p /tmp/hermit-eval
cd "$root/packages/eval"
start=$(date +%s)
${HERMIT_HEAVY:-} nice -n 10 node --experimental-transform-types --no-warnings src/mac-eval.ts ${PROFILE:-botpsy-q4-native-think256} "$@" --out /tmp/hermit-eval/$out.jsonl 2>&1 | grep -v "^pass\|^FAIL" | tail -5
echo "  ($out, $(( $(date +%s)-start ))s)"
