// The harness results (lib/harness.ts) as a dumbbell chart: one row per task set, the generic setup's score and the
// harness's score on a shared 0 to 100% axis. Plain HTML and SVG, no script: each row's text carries its numbers, an
// sr-only sentence reads them out, and a native <details> table holds them all. Colors are fixed because the chart
// always sits on the Deep sea band (#06121D), where they were validated.
import { EVAL_SETS, FIRST_ACTION_SECONDS, MODEL_CALLS, gain, share, type EvalSet } from "../lib/harness";
import { LOCALE, type Lang, type T } from "../lib/i18n";

const TICKS = [0, 25, 50, 75, 100];

function Track({ set }: { set: EvalSet }) {
  const from = share(set.generic, set.total);
  const to = share(set.harness, set.total);
  return (
    <svg className="dumbbell" aria-hidden="true" focusable="false">
      {TICKS.map((x) => (
        <line key={x} className="tick" x1={`${x}%`} x2={`${x}%`} y1="0" y2="100%" />
      ))}
      <rect className="span" x={`${from}%`} y="50%" width={`${to - from}%`} height="4" rx="2" transform="translate(0 -2)" />
      <circle className="dot generic" cx={`${from}%`} cy="50%" r="7" />
      <circle className="dot harness" cx={`${to}%`} cy="50%" r="7" />
    </svg>
  );
}

export function HarnessChart({ t }: { t: T }) {
  const k = (key: string, vars?: Record<string, string>) => t(`HM-SITE-01.${key}`, vars);
  return (
    <figure className="chart" aria-labelledby="chart-title">
      <svg className="chart-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="harness-span" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#0A7397" />
            <stop offset="1" stopColor="#01AA8E" />
          </linearGradient>
        </defs>
      </svg>
      <div className="chart-head">
        <h3 id="chart-title" className="chart-title">{k("chartTitle")}</h3>
        <ul className="chart-legend">
          <li><span className="key generic" aria-hidden="true" />{k("legendGeneric")}</li>
          <li><span className="key harness" aria-hidden="true" />{k("legendHarness")}</li>
        </ul>
      </div>
      <div className="chart-body">
        {EVAL_SETS.map((set) => {
          const vars = { from: String(set.generic), to: String(set.harness), total: String(set.total) };
          return (
            <div key={set.id} className="chart-row">
              <p className="chart-label">
                <span className="chart-set">{k(`set${set.id}`)}</span>
                <span className="chart-note">{k(`set${set.id}Note`)}</span>
              </p>
              <p className="chart-value">
                <span className="chart-gain">{k("chartGain", { points: String(gain(set)) })}</span>
                <span className="chart-score" aria-hidden="true">{k("chartScore", vars)}</span>
                <span className="sr-only">{k("chartSr", vars)}</span>
              </p>
              <div className="chart-track">
                <Track set={set} />
              </div>
            </div>
          );
        })}
        <div className="chart-row chart-axis" aria-hidden="true">
          <div className="chart-track">
            <svg className="axis" focusable="false">
              {TICKS.map((x) => (
                <text key={x} x={`${x}%`} y="16" textAnchor="middle">{`${x}%`}</text>
              ))}
            </svg>
          </div>
        </div>
      </div>
      <figcaption className="chart-caption">{k("chartNote")}</figcaption>
      <details className="chart-table">
        <summary>{k("tableToggle")}</summary>
        <div className="table-scroll" role="region" aria-label={k("chartTitle")} tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">{k("tableSet")}</th>
                <th scope="col">{k("legendGeneric")}</th>
                <th scope="col">{k("legendHarness")}</th>
                <th scope="col">{k("tableTasks")}</th>
              </tr>
            </thead>
            <tbody>
              {EVAL_SETS.map((set) => (
                <tr key={set.id}>
                  <th scope="row">{k(`set${set.id}`)}</th>
                  <td>{set.generic}</td>
                  <td>{set.harness}</td>
                  <td>{set.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** The two figures beside the chart: fewer model calls, and the median time to Hermit's first action. */
export function HarnessStats({ t, lang }: { t: T; lang: Lang }) {
  const k = (key: string, vars?: Record<string, string>) => t(`HM-SITE-01.${key}`, vars);
  const seconds = FIRST_ACTION_SECONDS.toLocaleString(LOCALE[lang].tag);
  return (
    <dl className="stats">
      <div className="stat">
        <dt className="stat-label">{k("statCallsLabel")}</dt>
        <dd className="stat-value">{k("statCallsValue", { n: String(MODEL_CALLS.fewerPercent) })}</dd>
        <dd className="stat-note">{k("statCallsNote", { count: String(MODEL_CALLS.conversations) })}</dd>
      </div>
      <div className="stat">
        <dt className="stat-label">{k("statFirstLabel")}</dt>
        <dd className="stat-value">{k("statFirstValue", { s: seconds })}</dd>
        <dd className="stat-note">{k("statFirstNote")}</dd>
      </div>
    </dl>
  );
}
