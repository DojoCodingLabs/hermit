// SL-52 scorer: compares a drafted connector with the fixture's known correct spec, field by field.
import { effectiveRisk, riskAtLeast, riskFloor, validateSpec, type AuthSpec, type OperationSpec } from "@hermit/connectors";
import type { Risk } from "@hermit/core";
import { joinPath, mapAuth, type Assembled, type HeaderDraft, type Mode, type OpDraft } from "./draft.ts";
import type { DraftFixture, GoldOp } from "./types.ts";

export function goldRisk(f: DraftFixture, i: number): Risk {
  const o = f.gold.operations[i]!;
  return riskFloor({ effect: o.method === "GET" ? "read" : o.method === "DELETE" ? "delete" : "write", sideEffects: o.sideEffects, domain: f.gold.domain }).risk;
}

const normPath = (p: string) => p.replace(/\{[^{}]*\}/g, "{}").replace(/\/+$/, "") || "/";

export interface OpScore {
  gold: string;
  goldRisk: Risk;
  matched: boolean;
  /** What the drafted operation was, when matched. */
  got?: string;
  method: boolean;
  path: boolean;
  paramsExact: boolean;
  /** The same check on the arguments after code's repairs: what the installed spec would carry. */
  paramsFinalExact: boolean;
  paramNames: { tp: number; fp: number; fn: number };
  /** Among parameters named right: where they go and whether they are required. */
  paramIn: [number, number];
  paramRequired: [number, number];
  sideEffectsExact: boolean;
  /** The risk the cage would see equals the gold floor. */
  riskCorrect: boolean;
  /** The risk the cage would see is below the gold floor: the unsafe case. */
  underRisk: boolean;
  /** Above the gold floor: safe, but one more scary label on the approval card. */
  overRisk: boolean;
  risk?: Risk;
}

export interface FixtureScore {
  id: string;
  lang: string;
  mode: Mode;
  shouldRefuse: boolean;
  refused?: string;
  validationErrors: string[];
  /** Not refused and the validator accepts it. */
  valid: boolean;
  /** Valid when it should be, refused (by code or by the validator) when it should be. */
  outcomeCorrect: boolean;
  authCorrect: boolean;
  hostsCorrect: boolean;
  domainCorrect: boolean;
  ops: OpScore[];
  missedOps: number;
  extraOps: number;
  /** Valid, right sign-in and host, every endpoint found with the right method, path, params and risk, nothing extra. */
  fullyCorrect: boolean;
  repairs: string[];
}

const sameAuth = (a: AuthSpec | undefined, b: AuthSpec) =>
  !!a &&
  a.type === b.type &&
  (a.type !== "api_key" || b.type !== "api_key" || (a.in === b.in && a.name.toLowerCase() === b.name.toLowerCase() && (a.prefix ?? "").trim().toLowerCase() === (b.prefix ?? "").trim().toLowerCase()));

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));

/**
 * Scores one draft. `header` and `ops` are what the model wrote (ops[i] belongs to header.endpoints[i]);
 * `assembled` is the spec code built from them. Params and side effects are scored as the model wrote them;
 * method, path and risk as the cage would see them.
 */
export function scoreDraft(f: DraftFixture, header: HeaderDraft | undefined, ops: OpDraft[], assembled: Assembled, mode: Mode): FixtureScore {
  const validationErrors = validateSpec(assembled.spec);
  const valid = !assembled.refused && validationErrors.length === 0;
  const shouldRefuse = !!f.gold.refuse;
  const drafted = (header?.endpoints ?? []).slice(0, ops.length).map((ep, i) => ({ ep, op: ops[i]!, spec: assembled.spec.operations[i] as OperationSpec | undefined, path: joinPath(header!.baseUrl, ep.path) }));

  // Align: exact method and path first, then path only (wrong method).
  const taken = new Set<number>();
  const pick = (g: GoldOp, exact: boolean) => drafted.findIndex((d, i) => !taken.has(i) && normPath(d.path) === normPath(g.path) && (!exact || d.ep.method === g.method));
  const align = new Map<number, number>();
  for (const exact of [true, false]) {
    f.gold.operations.forEach((g, gi) => {
      if (align.has(gi)) return;
      const i = pick(g, exact);
      if (i >= 0) {
        align.set(gi, i);
        taken.add(i);
      }
    });
  }

  const opScores: OpScore[] = f.gold.operations.map((g, gi) => {
    const gr = goldRisk(f, gi);
    const label = `${g.method} ${g.path}`;
    const i = align.get(gi);
    const none: OpScore = { gold: label, goldRisk: gr, matched: false, method: false, path: false, paramsExact: false, paramsFinalExact: false, paramNames: { tp: 0, fp: 0, fn: g.params.length }, paramIn: [0, 0], paramRequired: [0, 0], sideEffectsExact: false, riskCorrect: false, underRisk: false, overRisk: false };
    if (i === undefined) return none;
    const d = drafted[i]!;
    const exactly = (list: Array<{ name: string; in: string; required: boolean }>) =>
      list.length === g.params.length && g.params.every((w) => list.some((x) => x.name === w.name && x.in === w.in && x.required === w.required));
    const got = new Map(d.op.params.map((x) => [x.name, x]));
    const want = new Map(g.params.map((x) => [x.name, x]));
    const tp = [...got.keys()].filter((n) => want.has(n));
    const paramIn: [number, number] = [tp.filter((n) => got.get(n)!.in === want.get(n)!.in).length, tp.length];
    const paramRequired: [number, number] = [tp.filter((n) => got.get(n)!.required === want.get(n)!.required).length, tp.length];
    const risk = d.spec ? (mode === "owned" ? d.spec.risk : effectiveRisk(d.spec)) : undefined;
    return {
      gold: label,
      goldRisk: gr,
      matched: true,
      got: `${d.ep.method} ${d.path}`,
      method: d.ep.method === g.method,
      path: d.path === g.path,
      paramsExact: tp.length === want.size && got.size === want.size && paramIn[0] === tp.length && paramRequired[0] === tp.length,
      paramsFinalExact: exactly(assembled.params?.[i] ?? d.op.params),
      paramNames: { tp: tp.length, fp: got.size - tp.length, fn: want.size - tp.length },
      paramIn,
      paramRequired,
      sideEffectsExact: sameSet(d.op.sideEffects, g.sideEffects),
      riskCorrect: risk === gr,
      underRisk: risk !== undefined && !riskAtLeast(risk, gr),
      overRisk: risk !== undefined && !riskAtLeast(gr, risk),
      ...(risk ? { risk } : {}),
    };
  });

  const authCorrect = !!header && sameAuth(mapAuth(header.auth), f.gold.auth);
  const hostsCorrect = sameSet(assembled.spec.hosts, f.gold.hosts);
  const missedOps = opScores.filter((o) => !o.matched).length;
  const extraOps = drafted.length - align.size;
  return {
    id: f.id,
    lang: f.lang,
    mode,
    shouldRefuse,
    ...(assembled.refused ? { refused: assembled.refused } : {}),
    validationErrors,
    valid,
    outcomeCorrect: shouldRefuse ? !valid : valid,
    authCorrect,
    hostsCorrect,
    domainCorrect: header?.domain === f.gold.domain,
    ops: opScores,
    missedOps,
    extraOps,
    fullyCorrect: !shouldRefuse && valid && authCorrect && hostsCorrect && missedOps === 0 && extraOps === 0 && opScores.every((o) => o.method && o.path && o.paramsFinalExact && o.riskCorrect),
    repairs: assembled.repairs,
  };
}

type Ratio = [number, number];

export interface Summary {
  fixtures: number;
  /** Valid specs over fixtures that should yield one. */
  validRate: Ratio;
  /** Right outcome (valid, or refused when it must be) over all fixtures. */
  outcome: Ratio;
  fullyCorrect: Ratio;
  auth: Ratio;
  hosts: Ratio;
  domain: Ratio;
  /** Gold endpoints found with the exact method and path; drafted endpoints that are a gold one. */
  endpointRecall: Ratio;
  endpointPrecision: Ratio;
  field: { method: Ratio; path: Ratio; paramsExact: Ratio; paramsFinalExact: Ratio; sideEffectsExact: Ratio; risk: Ratio };
  paramNames: { precision: Ratio; recall: Ratio };
  paramIn: Ratio;
  paramRequired: Ratio;
  /** Operations whose risk the cage would see sits below the gold floor (uncaught by validation when the spec is valid). */
  underRisk: number;
  underRiskInValid: number;
  overRisk: number;
  /** Validator errors on drafts that should have been valid, by kind. */
  errorKinds: Record<string, number>;
  repairs: Record<string, number>;
}

const errorKind = (e: string) =>
  /risk .* is below/.test(e) ? "risk below floor" :
  /effect read needs GET|a GET must have effect read|a DELETE must have effect delete/.test(e) ? "effect contradicts method" :
  /side effects|can't have side effects|must list its side effects/.test(e) ? "side effects contradict effect" :
  /destructive/.test(e) ? "destructive flag" :
  /body/.test(e) ? "body mapping" :
  /path/.test(e) ? "path" :
  /host/.test(e) ? "host" :
  /auth/.test(e) ? "auth" :
  "other";

const repairKind = (r: string) => r.replace(/^\S+ \S+: /, "").replace(/ \(.*\)$/, "").replace(/placeholder \S+/, "placeholder").replace(/added (creates|updates)/, "added a default");

export function summarize(scores: FixtureScore[]): Summary {
  const count = (pred: (s: FixtureScore) => boolean, of: FixtureScore[] = scores): Ratio => [of.filter(pred).length, of.length];
  const ops = scores.flatMap((s) => s.ops);
  const opRatio = (pred: (o: OpScore) => boolean): Ratio => [ops.filter(pred).length, ops.length];
  const drafted = scores.reduce((n, s) => n + s.ops.filter((o) => o.matched).length + s.extraOps, 0);
  const exact = ops.filter((o) => o.matched && o.method && o.path).length;
  const tp = ops.reduce((n, o) => n + o.paramNames.tp, 0);
  const fp = ops.reduce((n, o) => n + o.paramNames.fp, 0);
  const fn = ops.reduce((n, o) => n + o.paramNames.fn, 0);
  const sum2 = (k: "paramIn" | "paramRequired"): Ratio => [ops.reduce((n, o) => n + o[k][0], 0), ops.reduce((n, o) => n + o[k][1], 0)];
  const errorKinds: Record<string, number> = {};
  for (const s of scores) if (!s.shouldRefuse) for (const e of s.validationErrors) errorKinds[errorKind(e)] = (errorKinds[errorKind(e)] ?? 0) + 1;
  const repairs: Record<string, number> = {};
  for (const s of scores) for (const r of s.repairs) repairs[repairKind(r)] = (repairs[repairKind(r)] ?? 0) + 1;
  const shouldBuild = scores.filter((s) => !s.shouldRefuse);
  return {
    fixtures: scores.length,
    validRate: count((s) => s.valid, shouldBuild),
    outcome: count((s) => s.outcomeCorrect),
    fullyCorrect: count((s) => s.fullyCorrect, shouldBuild),
    auth: count((s) => s.authCorrect),
    hosts: count((s) => s.hostsCorrect),
    domain: count((s) => s.domainCorrect),
    endpointRecall: [exact, ops.length],
    endpointPrecision: [exact, drafted],
    field: {
      method: opRatio((o) => o.method),
      path: opRatio((o) => o.path),
      paramsExact: opRatio((o) => o.paramsExact),
      paramsFinalExact: opRatio((o) => o.paramsFinalExact),
      sideEffectsExact: opRatio((o) => o.sideEffectsExact),
      risk: opRatio((o) => o.riskCorrect),
    },
    paramNames: { precision: [tp, tp + fp], recall: [tp, tp + fn] },
    paramIn: sum2("paramIn"),
    paramRequired: sum2("paramRequired"),
    underRisk: ops.filter((o) => o.underRisk).length,
    overRisk: ops.filter((o) => o.overRisk).length,
    underRiskInValid: scores.filter((s) => s.valid).reduce((n, s) => n + s.ops.filter((o) => o.underRisk).length, 0),
    errorKinds,
    repairs,
  };
}

const pct = ([a, b]: Ratio) => `${a}/${b} (${b ? Math.round((100 * a) / b) : 0}%)`;

export function formatSummary(label: string, s: Summary): string {
  return [
    `${label}`,
    `  valid spec ${pct(s.validRate)} | right outcome ${pct(s.outcome)} | fully correct ${pct(s.fullyCorrect)}`,
    `  auth ${pct(s.auth)} | host ${pct(s.hosts)} | domain ${pct(s.domain)}`,
    `  endpoints recall ${pct(s.endpointRecall)} precision ${pct(s.endpointPrecision)}`,
    `  per op: method ${pct(s.field.method)} | path ${pct(s.field.path)} | params exact ${pct(s.field.paramsExact)} (after repair ${pct(s.field.paramsFinalExact)}) | side effects exact ${pct(s.field.sideEffectsExact)} | risk ${pct(s.field.risk)}`,
    `  param names P ${pct(s.paramNames.precision)} R ${pct(s.paramNames.recall)} | in ${pct(s.paramIn)} | required ${pct(s.paramRequired)}`,
    `  under-risk ops ${s.underRisk} (in valid specs ${s.underRiskInValid}) | over-risk ops ${s.overRisk} | validator errors ${JSON.stringify(s.errorKinds)}`,
    `  code repairs ${JSON.stringify(s.repairs)}`,
  ].join("\n");
}
