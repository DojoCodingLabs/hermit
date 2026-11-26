// Dev-only: the on-phone model eval (Q29, FR-MODEL-04). Open with hermit://eval. Logs scores and timings only.
import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { describeNowForModel } from "@hermit/core";
import { FIRST_WIN_CASES, LAB_CLOCK, runEval } from "@hermit/eval";
import { createModelPort, EVAL_PROFILES } from "@hermit/model";
import { firstWinSkills } from "@hermit/skills";
import { allowedCpus, loadPlan, modelFile, verifiedSha256 } from "../adapters/device";
import { qvacEngine } from "../adapters/qvac-engine";
import { Page } from "../components/kit";
import { t } from "../i18n";
import { usePalette } from "../use-palette";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p90 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] ?? 0;

const started = new Set<string>();

/**
 * The Mac lab's clock (mac-eval.ts): Wednesday 2026-11-11, 21:00 in Costa Rica. The cases' times are written for it ("a
 * las 7:30" is 07:30 tomorrow at 21:00). On the live clock, the afternoon of 2026-11-24, the phone set es-remind-4 to
 * 19:30: the normalizer's "next time that clock reading comes around" rule, not the model's argument.
 */
const EVAL_NOW = LAB_CLOCK.now;
const EVAL_ZONE = LAB_CLOCK.timeZone;

export default function Eval() {
  const p = usePalette();
  const [lines, setLines] = useState<string[]>([]);
  // hermit://eval?p=id1,id2 picks the profiles; default: the shipped harness against the old one.
  // threads=N forces N model threads; without it the model gets the app's plan for the cores allowed when it loads.
  // delay=S waits S seconds before each load, so the speed probe can measure with the app in the background.
  const { p: picked, probe, mode, ctx, threads, delay } = useLocalSearchParams<{ p?: string; probe?: string; mode?: string; ctx?: string; threads?: string; delay?: string }>();
  useEffect(() => {
    if (!__DEV__) return;
    // Dev builds run effects twice: two evals at once share the CPU and the cache and spoil both results.
    const key = `${picked ?? ""}|${probe ?? ""}|${mode ?? ""}|${ctx ?? ""}|${threads ?? ""}|${delay ?? ""}`;
    if (started.has(key)) return;
    started.add(key);
    const log = (line: string) => {
      console.log(`[hermit:eval] ${line}`);
      setLines((l) => [...l, line]);
    };
    (async () => {
      if (probe === "time") {
        // Dev-only: what the JS engine says about the clock and the zone (the W1 session saw UTC times, 2026-11-24).
        const now = Date.now();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        log(`time: zone=${tz} offsetMin=${-new Date(now).getTimezoneOffset()} toString=${new Date(now).toString()}`);
        log(`time: CR=${new Intl.DateTimeFormat("en-GB", { timeZone: "America/Costa_Rica", hour: "2-digit", minute: "2-digit" }).format(new Date(now))} zoneFmt=${new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(now))} plain=${new Date(now).toLocaleTimeString()}`);
        log(`time: forModel=${describeNowForModel(now, tz)}`);
        log("done");
        return;
      }
      // The shipped harness (ADR-022) against the old one, each isolated so one failure doesn't stop the rest.
      const only = picked ? String(picked).split(",") : ["botpsy-q4-native-think256", "botpsy-q4-two-stage-nothink"];
      for (const profile of only.map((id) => EVAL_PROFILES.find((p) => p.id === id)!).filter(Boolean)) {
        try {
        const name = profile.file.url.split("/").pop()!;
        if (verifiedSha256(name) !== profile.file.sha256) {
          log(`${profile.id}: skipped (model not on the phone or not verified)`);
          continue;
        }
        if (delay) {
          log(`${profile.id}: loading in ${delay} s (switch away now to measure in the background)`);
          await new Promise((resolve) => setTimeout(resolve, Number(delay) * 1000));
        }
        // Without threads=N, the thread count the app would load with now (the S26's plans have no core mask).
        const plan = threads ? undefined : await loadPlan();
        const runThreads = threads ?? (plan ? `plan ${plan.threads}` : "profile");
        // mode=none|mmap and ctx=<tokens> try runtime variants (memory-pressure work) without new profiles.
        const variant = { ...profile, runtime: { ...profile.runtime, ...(mode === "none" || mode === "mmap" ? { loadMode: mode as "none" | "mmap" } : {}), ...(ctx ? { ctxSize: Number(ctx) } : {}), ...(threads ? { threads: Number(threads) } : plan ? { threads: plan.threads } : {}) } };
        const loadStart = Date.now();
        const engine = await qvacEngine(modelFile(name).uri, variant);
        const loadMs = Date.now() - loadStart;
        const port = createModelPort(engine, profile, firstWinSkills, () => ({ language: "en", now: describeNowForModel(EVAL_NOW, EVAL_ZONE), profile: [], clock: { now: EVAL_NOW, timeZone: EVAL_ZONE } }));
        if (probe === "speed") {
          // One short call, thinking off: how fast this phone generates right now, under whatever load it has.
          const runs: number[] = [];
          for (let i = 0; i < 3; i++) {
            const t0 = Date.now();
            let first = 0;
            let n = 0;
            await engine.complete({ messages: [{ role: "system", content: "You are Hermit." }, { role: "user", content: `Cuenta del 1 al 20 en palabras, intento ${i + 1}.` }], thinking: { enabled: false }, sampling: profile.sampling, maxTokens: 48, onToken: () => { first ||= Date.now(); n++; } });
            runs.push(n && first ? Math.round((n / Math.max(1, Date.now() - first)) * 10000) / 10 : 0);
            const now = allowedCpus();
            log(`${profile.id} speed (mode=${mode ?? "default"}, ctx=${ctx ?? "plan"}, threads=${runThreads}): call ${i + 1} first token ${first ? first - t0 : -1} ms, ${n} pieces, total ${Date.now() - t0} ms, cpuset ${now?.cpuset ?? "unknown"}`);
          }
          log(`${profile.id} speed (mode=${mode ?? "default"}, ctx=${ctx ?? "plan"}, threads=${runThreads}): load ${loadMs} ms, streamed pieces/s ${runs.join(", ")}`);
          await engine.close();
          continue;
        }
        if (probe) {
          const menu = firstWinSkills.map((s) => s.id);
          const t0 = Date.now();
          await port.warm?.({ prefixCacheKey: "probe" });
          const t1 = Date.now();
          const first = await port.pick({ prefixCacheKey: "probe", messages: [{ role: "user", content: "hola, ¿cómo estás?" }], menu });
          const t2 = Date.now();
          await port.pick({ prefixCacheKey: "probe", messages: [{ role: "user", content: "hola, ¿cómo estás?" }, { role: "assistant", content: first.text ?? "¡Bien!" }, { role: "user", content: "¿qué tengo mañana?" }], menu });
          const t3 = Date.now();
          log(`${profile.id} probe: warm ${t1 - t0} ms, first message ${t2 - t1} ms, second message ${t3 - t2} ms`);
          await engine.close();
          continue;
        }
        const r = await runEval([...FIRST_WIN_CASES], port, { now: EVAL_NOW, timeZone: EVAL_ZONE });
        const by = (lang: string) => r.results.filter((x) => FIRST_WIN_CASES.find((c) => c.id === x.id)?.lang === lang);
        const ms = r.results.map((x) => x.ms);
        log(`${profile.id}: ${r.passed}/${r.total} correct | es ${by("es").filter((x) => x.pass).length}/20 | en ${by("en").filter((x) => x.pass).length}/20 | first action median ${median(ms)} ms, p90 ${p90(ms)} ms`);
        log(`${profile.id}: failed ${r.results.filter((x) => !x.pass).map((x) => x.id).join(",") || "none"}`);
        // What each failure got (choice and argument names only: case inputs are synthetic, but keep logs lean).
        for (const x of r.results.filter((y) => !y.pass)) log(`  ${x.id}: ${(x.reason ?? "").slice(0, 90)}`);
        await engine.close();
        } catch (err) {
          log(`${profile.id}: error ${err instanceof Error ? `${err.name} ${(err.message || "").slice(0, 120)}` : "unknown"}`);
        }
      }
      log("done");
    })().catch((err) => log(`error ${err instanceof Error ? err.name : "unknown"}`));
  }, [picked, probe, mode, ctx, threads, delay]);
  return (
    <Page title={t("HM-DEV-03.title")}>
      <View style={styles.body}>
        {lines.map((l, i) => (
          <Text key={i} style={[styles.line, { color: p.text }]}>{l}</Text>
        ))}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({ body: { padding: 16, gap: 8 }, line: { fontSize: 13, fontFamily: "monospace" } });
