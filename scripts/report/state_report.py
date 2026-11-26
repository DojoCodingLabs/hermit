"""Builds the branded "State of Hermit" report (HTML), printed to PDF with headless Chrome.

Usage: python3 scripts/report/state_report.py  ->  docs/reports/hermit-state-2026-11-13.{html,pdf}
Numbers are the measured ones from docs/build/*.md, the PRD linter and the eval runs of 2026-11-12/13.
"""
import math
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "reports"
B = "../brand"  # brand assets, relative to docs/reports

PAPER, SHELL, STONE, SAND, INK, INK_SOFT = "#F5EDE1", "#EBDDCB", "#D3C2AE", "#D5B893", "#2B221B", "#6B5E52"
SEA, SEA_DEEP, CORAL, AMBER = "#4F7C6D", "#3B6456", "#B4483A", "#8A5912"
ABYSS, TRENCH, CURRENT, KELP, FOAM, GLOW = "#06121D", "#0D2233", "#1A4A5E", "#8FA9B5", "#E7F1F0", "#5EF0CF"


def ring(pct: float, size: int = 150, stroke: int = 14, color: str = SEA_DEEP, track: str = SHELL, label: str = "", sub: str = "", fg: str = INK) -> str:
    r = (size - stroke) / 2
    c = 2 * math.pi * r
    dash = c * pct / 100
    return f"""<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <circle cx="{size/2}" cy="{size/2}" r="{r}" fill="none" stroke="{track}" stroke-width="{stroke}"/>
  <circle cx="{size/2}" cy="{size/2}" r="{r}" fill="none" stroke="{color}" stroke-width="{stroke}" stroke-linecap="round"
    stroke-dasharray="{dash:.1f} {c:.1f}" transform="rotate(-90 {size/2} {size/2})"/>
  <text x="50%" y="{size/2 + 2}" text-anchor="middle" font-family="Newsreader" font-size="{size*0.27:.0f}" fill="{fg}">{label}</text>
  <text x="50%" y="{size/2 + size*0.17:.0f}" text-anchor="middle" font-family="Instrument Sans" font-size="{size*0.075:.0f}" fill="{INK_SOFT if fg == INK else KELP}" letter-spacing="1">{sub}</text>
</svg>"""


def bar(value: float, total: float, color: str = SEA_DEEP, track: str = SHELL, h: int = 12) -> str:
    pct = 100 * value / total
    return f'<div class="bar" style="background:{track};height:{h}px"><div style="width:{pct:.1f}%;background:{color}"></div></div>'


def before_after(label: str, before: int, after: int, total: int, unit: str = "") -> str:
    return f"""<div class="ba">
  <div class="ba-label">{label}</div>
  <div class="ba-row"><span class="ba-tag">Before</span>{bar(before, total, STONE, SHELL, 14)}<span class="ba-num muted">{before}{unit}</span></div>
  <div class="ba-row"><span class="ba-tag">Now</span>{bar(after, total, SEA_DEEP, SHELL, 14)}<span class="ba-num">{after}<small>/{total}</small></span></div>
</div>"""


def chip(text: str, kind: str) -> str:
    return f'<span class="chip {kind}">{text}</span>'


def mascot(name: str, cls: str = "mascot", dark: bool = False) -> str:
    return f'<img class="{cls}" src="{B}/mascot/png/{name}{"-dark" if dark else ""}.png" alt="">'


def page(body: str, cls: str = "", n: int | None = None, section: str = "") -> str:
    foot = "" if n is None else f'<footer><img src="{B}/logo/symbol-ink.svg" alt=""><span>State of Hermit · 13 November 2026</span><span class="sec">{section}</span><span class="pn">{n:02d}</span></footer>'
    return f'<section class="page {cls}">{body}{foot}</section>'


pages: list[str] = []

# 1. Cover
pages.append(page(f"""
<div class="cover">
  <img class="cover-lockup" src="{B}/logo/lockup-ink.svg" alt="Hermit">
  <div class="cover-kicker">State of the project · 13 November 2026</div>
  <h1 class="cover-title">Does everything.<br>Tells no one.</h1>
  <p class="cover-sub">Progress, achievements and the road to V1 of the open-source AI agent that lives entirely on your phone.</p>
  <div class="cover-stats">
    <div><b>22</b><span>pull requests merged</span></div>
    <div><b>366</b><span>automated tests passing</span></div>
    <div><b>95<small>/100</small></b><span>best blind-eval score</span></div>
    <div><b>39<small>/40</small></b><span>on the Galaxy S26</span></div>
  </div>
  <img class="cover-mascot" src="{B}/mascot/png/01-idle.png" alt="">
  <div class="cover-by">Built by <b>Dojo Coding</b> · Apache 2.0 · Project report</div>
</div>""", "cover-page"))

# 2. Hermit in one page
pages.append(page(f"""
<div class="kicker">01 · What Hermit is</div>
<h2>A personal agent that never leaves your phone.</h2>
<div class="grid3">
  <div class="card"><img class="cicon" src="{B}/mascot/png/08-offline.png" alt=""><h3>Fully on-device</h3><p>The model runs on the phone through Tether's QVAC runtime. No server sees your messages, your memory or your calendar.</p></div>
  <div class="card"><img class="cicon" src="{B}/mascot/png/07-blocked.png" alt=""><h3>The cage</h3><p>Every action has a risk class. Anything that sends, pays or signs in waits for your fingerprint, and every step lands in a signed log.</p></div>
  <div class="card"><img class="cicon" src="{B}/mascot/png/01-idle.png" alt=""><h3>Open source</h3><p>Apache 2.0, built in the open. Anyone can read exactly what Hermit does with their data.</p></div>
</div>
<div class="split">
  <div>
    <h3 class="h3s">The bet</h3>
    <p class="lead">Cloud agents (Claude Duet, ChatGPT Dots, Grok bot, Muse, Instinct) run frontier models in data centers. Hermit runs a <b>0.8 billion parameter model</b> on a phone and closes the gap with a <b>state-of-the-art harness</b>: the code around the model does the routing, the time math and the safety, so the small model only decides what code can't.</p>
  </div>
  <div class="stack">
    <div class="pill"><span>Model</span><b>BotPsy-0.8B (Qwen3.5 fine-tune), Q4_K_M, about 530 MB</b></div>
    <div class="pill"><span>Runtime</span><b>QVAC SDK 0.23 (llama.cpp) on Android</b></div>
    <div class="pill"><span>App</span><b>Expo / React Native, SQLCipher, Keystore</b></div>
    <div class="pill"><span>Test phone</span><b>Samsung Galaxy S26</b></div>
  </div>
</div>
{mascot("14-listening", "corner-mascot")}""", "", 2, "What Hermit is"))

# 3. Completion at a glance
pages.append(page(f"""
<div class="kicker">02 · Completion at a glance</div>
<h2>The foundation is done; the first win is close.</h2>
<div class="rings">
  <div class="ringbox">{ring(100, label="100%", sub="FOUNDATION")}<p><b>Wave 0</b><br>Research, architecture, brand, PRD, scaffold, contracts</p></div>
  <div class="ringbox">{ring(85, label="85%", sub="BUILT", color=SEA)}<p><b>Wave 1 · the first win</b><br>12 slices, 30 stories. Code built; phone gate not yet passed</p></div>
  <div class="ringbox">{ring(20, label="20%", sub="OF V1", color=SAND)}<p><b>V1 overall</b><br>59 slices, 120 stories. Waves 2 to 6 are next</p></div>
  <div class="ringbox">{ring(95, label="95", sub="BLIND /100", color=SEA_DEEP)}<p><b>Harness quality</b><br>Best score on 100 cases the harness never saw</p></div>
</div>
<div class="note">How these are measured: wave progress counts slices and stories from the PRD (not effort). "Built" means merged on master with tests; "verified" means proven on the Galaxy S26.</div>
{mascot("03-working", "corner-mascot")}""", "", 3, "Completion"))

# 4. Phases
waves = [
    ("W0", "Preflight and contracts", "CI, dev build, contracts, schema", 100, "done"),
    ("W1", "The first win", "Chat, memory, reminders, calendar, WhatsApp read and reply, approvals, signed log", 85, "now"),
    ("W2", "Voice, email, connectors", "Model proven on device, turn control, de-risking spikes", 3, "next"),
    ("W3", "Eyes", "Web reading, night shift, other apps, settings, accessibility", 4, "later"),
    ("W4", "Hands I", "Vault, form fill, logins, web tasks, MCP client", 0, "later"),
    ("W5", "Hands II", "USD₮ wallet, caps, Keystore approvals, x402", 0, "later"),
    ("W6", "Changing phones and distribution", "Phone transfer, Play internal track, reproducible APK, website", 0, "later"),
]
rows = "".join(
    f"""<div class="wave {s}"><div class="wid">{w}</div><div class="wbody"><div class="wtitle">{t}</div><div class="wdesc">{d}</div>{bar(p, 100, SEA_DEEP if p == 100 else SEA if p > 50 else SAND)}</div><div class="wpct">{p}%</div></div>"""
    for w, t, d, p, s in waves
)
pages.append(page(f"""
<div class="kicker">03 · Phases</div>
<h2>V1 ships in seven waves, then V2 and V3.</h2>
<div class="waves">{rows}</div>
<div class="bands">
  <div class="band"><b>V1</b> The full phone-only agent · 120 stories</div>
  <div class="band v2"><b>V2</b> Boost (a bigger shell), fine-tuned Hermit models, iOS, agent-to-agent · 44 stories</div>
  <div class="band v3"><b>V3</b> Keep watch, Mac powers, family sharing, confidential-cloud Boost · 11 stories</div>
</div>""", "", 4, "Phases"))

# 5. First win slice by slice
slices = [
    ("SL-09", "Spike S1: BotPsy runs on the S26", "verified"),
    ("SL-10", "Spike S2: encrypted database (op-sqlite, SQLCipher)", "verified"),
    ("SL-11", "Spike S3: model bundle and loader in the Expo build", "verified"),
    ("SL-02", "Chat on the phone's model, streaming, offline", "built"),
    ("SL-03", "Clarifying questions and failed turns", "built"),
    ("SL-04", "Remember, recall and forget with provenance", "built"),
    ("SL-05", "Reminders fire offline; calendar reads and adds", "built"),
    ("SL-07", "Exact reply approved with a fingerprint, then sent", "built"),
    ("SL-08", "Activity log verifies its signed chain", "built"),
    ("SL-01", "First launch, verified model download, permissions", "built"),
    ("SL-06", "WhatsApp messages captured as untrusted", "built"),
    ("SL-12", "Spike S4: notification listener reply action", "device"),
]
label = {"verified": ("Proven on the S26", "ok"), "built": ("Built · phone check pending", "mid"), "device": ("Built · untested on device", "warn")}
items = "".join(f'<div class="slice"><span class="sid">{i}</span><span class="stitle">{t}</span>{chip(*label[s])}</div>' for i, t, s in slices)
pages.append(page(f"""
<div class="kicker">04 · Wave 1, the first win</div>
<h2>Twelve slices: every one built, three already proven on the phone.</h2>
<div class="slices">{items}</div>
<div class="gate"><b>The W1 gate:</b> the first-win journey script passes end to end on the Galaxy S26. What remains is device verification, chiefly the WhatsApp listener (spike S4) and the full journey.</div>
{mascot("04-asking", "corner-mascot")}""", "", 5, "First win"))

# 6. Harness journey
pages.append(page(f"""
<div class="kicker">05 · The harness</div>
<h2>Same small model, a much smarter agent.</h2>
<p class="lead narrow">Instead of a bigger model, Hermit wraps BotPsy in code: a deterministic router, time parsing in Spanish and English, argument normalizers, constrained fallbacks, a clause planner and fixed clarifying questions. The model only decides what code cannot.</p>
<div class="ba-grid">
  {before_after("Blind holdout · 100 cases the harness never saw", 73, 95, 100)}
  {before_after("First-win suite · 40 cases (Mac)", 22, 40, 40)}
  {before_after("Same harness on the untrained base Qwen3.5-0.8B · blind", 60, 87, 100)}
  {before_after("On the Galaxy S26 · first-win 40", 31, 39, 40)}
</div>
<div class="callout"><b>Model-agnostic:</b> the harness lifts an untrained model 27 points, so the gains come from Hermit's design, not from one model's quirks.</div>""", "", 6, "Harness"))

# 7. Eval scoreboard
evals = [
    ("Virtual-assistant set", 122, 124, "time, memory, calendar, messaging, chat, ask, decline"),
    ("Development holdout", 85, 90, "written blind, now used for development"),
    ("Messaging set", 50, 50, "WhatsApp read, reply, groups, contacts"),
    ("Memory and decline set", 58, 60, "remember, recall, forget, and saying no"),
    ("Multi-turn trajectories (4 seeds)", 116, 120, "30 whole conversations through the real runtime"),
    ("Parity scenarios", 7, 7, "matching Instinct, Grok bot and Muse on the VA menu"),
    ("Privacy scenarios", 6, 6, "injections, leaks and approvals"),
]
erows = "".join(f'<div class="erow"><div class="ename"><b>{n}</b><span>{d}</span></div>{bar(a, t, SEA_DEEP if a == t else SEA, SHELL, 16)}<div class="escore">{a}<small>/{t}</small></div></div>' for n, a, t, d in evals)
pages.append(page(f"""
<div class="kicker">06 · Eval scoreboard</div>
<h2>Measured, not assumed: about 430 cases and 30 conversations.</h2>
<div class="evals">{erows}</div>
<div class="note">The blind holdout is the honest judge: its cases are never read or tuned on. Every other set is development data. Numbers from the Mac eval lab, which runs the exact phone model file.</div>
{mascot("05-done", "corner-mascot")}""", "", 7, "Evals"))

# 8. On the phone
pages.append(page(f"""
<div class="kicker">07 · On the Galaxy S26</div>
<h2>Real phone, real heat, real numbers.</h2>
<div class="phone-grid">
  <div class="big"><b>39<small>/40</small></b><span>first-win cases correct on the phone</span></div>
  <div class="big"><b>7.0 s</b><span>median first action, fast route (11.3 s with full thinking)</span></div>
  <div class="big"><b>7 to 13×</b><span>fewer prompt tokens with the new stable prompt prefix (Mac)</span></div>
  <div class="big"><b>61 °C</b><span>chip peak in a sustained eval; the thermal guard stops runs automatically</span></div>
</div>
<div class="split">
  <div><h3 class="h3s">Speed work done</h3><ul class="ticks">
    <li>Device-adaptive runtime: threads, batch and thinking budget per phone and per temperature</li>
    <li>KV cache on, with a byte-stable prompt prefix and a warm-up when a chat opens</li>
    <li>Live progress: instant intent, a "Pensando" panel, streamed answers</li>
  </ul></div>
  <div><h3 class="h3s">Still to prove on the phone</h3><ul class="dots">
    <li>The in-chat cache gain (second message in the same conversation)</li>
    <li>Why fast-route calls run to their token cap on QVAC</li>
    <li>The WhatsApp listener reply action (spike S4)</li>
  </ul></div>
</div>
{mascot("10-boost", "corner-mascot")}""", "", 8, "On the phone"))

# 9. Architecture
pages.append(page(f"""
<div class="kicker">08 · Architecture</div>
<h2>Everything runs inside the phone.</h2>
<div class="arch">
  <div class="arow"><div class="abox ui">Chat UI<br><small>streaming · Pensando panel · approval sheets</small></div></div>
  <div class="arrow">▼</div>
  <div class="arow"><div class="abox">Runtime<br><small>sessions · history window · live events</small></div><div class="abox">Agent loop<br><small>pick → validate → normalize → cage → execute</small></div></div>
  <div class="arrow">▼</div>
  <div class="arow">
    <div class="abox harness">Harness<br><small>router · clause planner · time parser · normalizers · fixed questions · constrained fallback</small></div>
    <div class="abox cage">The cage<br><small>risk classes · fingerprint approvals · untrusted seal · signed log</small></div>
  </div>
  <div class="arrow">▼</div>
  <div class="arow"><div class="abox model">QVAC (llama.cpp) · BotPsy-0.8B<br><small>native tool calls · thinking budget · KV cache</small></div><div class="abox data">Encrypted SQLite<br><small>memory · reminders · messages · audit chain</small></div></div>
</div>
<div class="guar"><div><b>Model never on the network</b><small>QVAC runs it on the phone's CPU or GPU</small></div><div><b>A fingerprint for every send</b><small>exact text and recipient on the sheet</small></div><div><b>Untrusted content sealed</b><small>messages and pages can inform, never command</small></div><div><b>Signed hash chain</b><small>every step, verifiable on the phone</small></div></div>
<div class="arch-legend"><span>9 packages</span><span>core · cage · skills · agent · model · runtime · copy · eval · sql-node</span><span>about 7,500 lines of product code, 2,900 lines of tests</span></div>""", "", 9, "Architecture"))

# 10. Built features
feats = [
    ("12-remember", "Memory", "Remember, recall and forget, with provenance; forgetting also scrubs the chat the model sees"),
    ("14-listening", "Reminders", "Fire offline; list and cancel; times understood in Spanish and English"),
    ("03-working", "Calendar", "Read a day, add events with real start and end times"),
    ("04-asking", "WhatsApp", "Messages read as untrusted content; replies sent only after a fingerprint approval"),
    ("07-blocked", "Approvals", "Exact text and recipient shown; stale or changed replies are blocked"),
    ("05-done", "Signed log", "Every step recorded and the hash chain verified on the phone"),
    ("02-thinking", "Live progress", "Instant intent, a live reasoning panel and streamed answers"),
    ("10-boost", "Multi-request", "Several asks in one message are planned and done in order"),
    ("15-quiet", "Bilingual", "Latin American Spanish, voseo included, and English"),
]
fhtml = "".join(f'<div class="feat"><img class="ficon" src="{B}/mascot/png/{i}.png" alt=""><div><b>{t}</b><p>{d}</p></div></div>' for i, t, d in feats)
pages.append(page(f"""
<div class="kicker">09 · What works today</div>
<h2>The first-win feature set, built and tested.</h2>
<div class="feats">{fhtml}</div>""", "", 10, "Features"))

# 11. Achievements timeline
days = [
    ("8 Nov", "Research, architecture spec, brand palette and type; QVAC, WDK, vault and P2P studied"),
    ("9 Nov", "Brand book; Wave 0 scaffold with the core contracts, the cage, skills and the eval harness"),
    ("10 Nov", "Agent core merged; the crab becomes the logo and mascot; the agentic-first PRD (175 stories)"),
    ("11 Nov", "Phone spikes: BotPsy runs on the S26; model layer, approvals, onboarding and listener merged"),
    ("12 Nov", "Harness overhaul: blind 73 → 95; parity skills; thermal-guarded phone evals; live streaming"),
    ("13 Nov", "Prompt-cache work, harness fixes and research merged (PRs #21, #22); 366 tests green"),
]
tl = "".join(f'<div class="day"><div class="dot"></div><div class="ddate">{d}</div><div class="dtext">{t}</div></div>' for d, t in days)
pages.append(page(f"""
<div class="kicker">10 · Achievements</div>
<h2>Six days from first commit to a working agent on a phone.</h2>
<div class="timeline">{tl}</div>
<div class="leaps"><div><span>Biggest leaps</span></div><div><b>73 → 95</b><small>blind score, harness overhaul</small></div><div><b>31 → 39</b><small>of 40 on the S26, old harness vs new</small></div><div><b>7 to 13×</b><small>fewer prompt tokens per call</small></div><div><b>7 / 7</b><small>competitor-parity scenarios passing</small></div></div>
<div class="counters">
  <div><b>136</b><span>commits</span></div><div><b>22</b><span>PRs merged</span></div><div><b>22</b><span>research reports</span></div>
  <div><b>175</b><span>user stories mapped</span></div><div><b>47</b><span>decision records</span></div><div><b>366</b><span>tests passing</span></div>
</div>""", "", 11, "Achievements"))

# 12. The map
pages.append(page(f"""
<div class="kicker">11 · The product map</div>
<h2>An exhaustive PRD keeps every agent on the same page.</h2>
<div class="mapgrid">
  <div class="m"><b>27</b><span>epics</span></div><div class="m"><b>175</b><span>user stories</span></div><div class="m"><b>64</b><span>screens with stable IDs</span></div>
  <div class="m"><b>85</b><span>functional requirements</span></div><div class="m"><b>21</b><span>architecture decisions</span></div><div class="m"><b>26</b><span>product decisions</span></div>
  <div class="m"><b>59</b><span>V1 slices</span></div><div class="m"><b>12</b><span>cross-cutting contracts</span></div><div class="m"><b>37</b><span>questions decided</span></div>
</div>
<div class="split">
  <div><h3 class="h3s">Stories by release</h3>
    <div class="stackbar"><div style="flex:120;background:{SEA_DEEP}">V1 · 120</div><div style="flex:44;background:{SEA}">V2 · 44</div><div style="flex:11;background:{SAND};color:{INK}">V3 · 11</div></div>
  </div>
  <div><h3 class="h3s">V1 slices by wave</h3>
    <div class="stackbar"><div style="flex:12;background:{SEA_DEEP}">W1 12</div><div style="flex:15;background:{SEA}">W2 15</div><div style="flex:13;background:#6E9488">W3 13</div><div style="flex:9;background:{SAND};color:{INK}">W4 9</div><div style="flex:5;background:{STONE};color:{INK}">W5 5</div><div style="flex:5;background:{SHELL};color:{INK}">W6 5</div></div>
  </div>
</div>
<h3 class="h3s flowh">How the work flows</h3>
<div class="flow"><div>PRD<small>175 stories, stable IDs</small></div><i>→</i><div>Waves<small>first win, then W2 to W6</small></div><i>→</i><div>Slices<small>vertical, one packet each</small></div><i>→</i><div>Coding agents<small>parallel, narrow context</small></div><i>→</i><div>CI + review<small>tests, typecheck, lint, APK</small></div><i>→</i><div class="last">Merged<small>22 PRs so far</small></div></div>
{mascot("12-remember", "corner-mascot")}""", "", 12, "Product map"))

# 13. Competitive position
comp = [
    ("Claude Duet", "Cloud VM", "Frontier"), ("ChatGPT Dots", "Cloud", "Frontier"), ("Grok bot", "Cloud", "Frontier"),
    ("Meta Muse", "Cloud", "Frontier"), ("Instinct", "Cloud", "Proprietary"), ("Atomic", "Local + cloud planner", "Local"),
]
crow = "".join(f"<tr><td>{n}</td><td>{w}</td><td>{m}</td><td class='no'>No</td></tr>" for n, w, m in comp)
pages.append(page(f"""
<div class="kicker">12 · Where Hermit stands</div>
<h2>The only one that is private by construction.</h2>
<table class="comp"><thead><tr><th>Assistant</th><th>Where it runs</th><th>Model</th><th>Fully on-device</th></tr></thead>
<tbody>{crow}<tr class="hermit"><td>Hermit</td><td>Your phone</td><td>BotPsy-0.8B + harness</td><td class="yes">Yes</td></tr></tbody></table>
<div class="split">
  <div><h3 class="h3s">Parity goal (Q31)</h3><p>Match the best competitor in each feature family and beat all of them on privacy. Reminder list and cancel, multi-request planning and catch-up summaries already match Instinct, Grok bot and Muse on the assistant menu.</p></div>
  <div><h3 class="h3s">The on-phone bet (PDR-026)</h3><p>Open-ended web tasks and purchases run on Boost for now. Doing them fully on the phone with a sub-1B model is a standing goal. Nobody has published that result yet.</p></div>
</div>""", "", 13, "Position"))

# 14. Risks and decisions
pages.append(page(f"""
<div class="kicker">13 · Open items</div>
<h2>What needs a decision or a proof.</h2>
<div class="risks">
  <div class="risk warn"><b>Q14 · Tether logo approval</b><p>Written OK on the QVAC and Tether logos before anything public (site, X posts).</p></div>
  <div class="risk"><b>Q38 · Tainted turns on Boost</b><p>An open web task is untrusted from its first page; the PRD forbids sending those to Boost. It blocks V2 web work only.</p></div>
  <div class="risk"><b>Opt-in cloud path</b><p>Whether to offer the hardest few percent of requests to the cloud with explicit consent. Logged; to be asked with data.</p></div>
  <div class="risk mid"><b>Phone verification</b><p>WhatsApp listener (S4), the full first-win journey, the in-chat cache gain and the fast-route token cap.</p></div>
  <div class="risk mid"><b>Cross-language recall</b><p>A fact saved in English is not always found by a Spanish question.</p></div>
  <div class="risk"><b>Parallel eval runs</b><p>Two crashes from parallel load; evals now run one at a time behind a lock.</p></div>
</div>
{mascot("07-blocked", "corner-mascot")}""", "", 14, "Open items"))

# 15. Next steps
pages.append(page(f"""
<div class="kicker">14 · Next</div>
<h2>From "built" to "proven", then the hands.</h2>
<div class="steps">
  <div class="step"><span>1</span><div><b>Pass the W1 gate</b><p>The first-win journey end to end on the S26, the WhatsApp listener, the in-chat cache probe.</p></div></div>
  <div class="step"><span>2</span><div><b>Ship the faster prompt</b><p>The stable prefix becomes the default once the phone shows the in-chat gain.</p></div></div>
  <div class="step"><span>3</span><div><b>Wave 2</b><p>Voice notes, email, the connector catalog and the spikes that de-risk wallet, web tasks and Play policy.</p></div></div>
  <div class="step"><span>4</span><div><b>Train a Hermit model</b><p>Distill the harness into the weights: on-policy distillation and preference training on act, ask and decline.</p></div></div>
</div>
<div class="checklist"><b>W1 gate checklist</b>
<span class="ck done">Model on the S26</span><span class="ck done">Encrypted database</span><span class="ck done">Bundle and loader</span><span class="ck done">39/40 on the phone</span>
<span class="ck">WhatsApp listener (S4)</span><span class="ck">First-win journey end to end</span><span class="ck">In-chat cache probe</span></div>
{mascot("02-thinking", "corner-mascot")}""", "", 15, "Next"))

# 16. Back cover
pages.append(page(f"""
<div class="back">
  <img class="back-lockup" src="{B}/logo/lockup-foam.svg" alt="Hermit">
  <p class="back-tag">Does everything. Tells no one.</p>
  <img class="back-mascot" src="{B}/mascot/png/09-sleeping-dark.png" alt="">
  <div class="back-by">
    <div class="dojo"><span>Built by</span><img src="{B}/partners/dojocoding-lockup-white.png" alt="Dojo Coding"></div>
    <div class="qvac"><span>Runs on QVAC by Tether</span></div>
  </div>
  <p class="fine">Project report. Hermit is an independent open-source project by Dojo Coding and is not affiliated with or endorsed by Tether. QVAC and Tether names are used descriptively; logo use awaits Tether's written approval (Q14).</p>
</div>""", "back-page"))

CSS = f"""
@import url('{B}/fonts/fonts.css');
@page {{ size: 297mm 210mm; margin: 0; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ background: {PAPER}; color: {INK}; font-family: 'Instrument Sans', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.page {{ width: 297mm; height: 210mm; padding: 15mm 18mm 18mm; position: relative; overflow: hidden; page-break-after: always; background: {PAPER}; }}
footer {{ position: absolute; left: 18mm; right: 18mm; bottom: 8mm; display: flex; align-items: center; gap: 10px; font-size: 9pt; color: {INK_SOFT}; border-top: 1px solid {STONE}; padding-top: 3mm; }}
footer img {{ height: 14px; }} footer .sec {{ margin-left: auto; text-transform: uppercase; letter-spacing: 1.5px; font-size: 8pt; }} footer .pn {{ font-family: 'JetBrains Mono'; color: {INK}; }}
.kicker {{ font-size: 9.5pt; letter-spacing: 2.5px; text-transform: uppercase; color: {SEA_DEEP}; font-weight: 600; margin-bottom: 3mm; }}
h2 {{ font-family: 'Newsreader', serif; font-weight: 500; font-size: 30pt; line-height: 1.08; letter-spacing: -0.5px; max-width: 220mm; margin-bottom: 8mm; }}
h3 {{ font-size: 13pt; margin-bottom: 2mm; }} .h3s {{ font-size: 10pt; text-transform: uppercase; letter-spacing: 1.5px; color: {INK_SOFT}; margin-bottom: 3mm; }}
p {{ font-size: 10.5pt; line-height: 1.5; color: {INK_SOFT}; }} .lead {{ font-size: 12.5pt; color: {INK}; line-height: 1.55; }} .narrow {{ max-width: 215mm; margin: -3mm 0 7mm; }}
b {{ color: {INK}; }}
.corner-mascot {{ position: absolute; right: 14mm; top: 11mm; width: 30mm; opacity: .95; }}
.note {{ position: absolute; bottom: 20mm; left: 18mm; right: 18mm; font-size: 9pt; color: {INK_SOFT}; background: {SHELL}; border-radius: 10px; padding: 3mm 4mm; }}
.callout {{ margin-top: 7mm; background: {SEA_DEEP}; color: {PAPER}; border-radius: 14px; padding: 5mm 6mm; font-size: 11pt; }} .callout b {{ color: {PAPER}; }}
.bar {{ border-radius: 999px; overflow: hidden; flex: 1; }} .bar > div {{ height: 100%; border-radius: 999px; }}
.chip {{ font-size: 8.5pt; padding: 1.2mm 3mm; border-radius: 999px; white-space: nowrap; font-weight: 600; }}
.chip.ok {{ background: {SEA_DEEP}; color: {PAPER}; }} .chip.mid {{ background: {SHELL}; color: {INK}; border: 1px solid {STONE}; }} .chip.warn {{ background: #F3DEC0; color: {AMBER}; }}
/* cover */
.cover-page {{ padding: 0; }}
.cover {{ height: 100%; padding: 18mm 20mm; position: relative; background: radial-gradient(circle at 85% 70%, {SHELL} 0, {PAPER} 55%); }}
.cover-lockup {{ height: 17mm; }}
.cover-kicker {{ margin-top: 20mm; font-size: 10pt; letter-spacing: 3px; text-transform: uppercase; color: {SEA_DEEP}; font-weight: 600; }}
.cover-title {{ font-family: 'Newsreader'; font-weight: 500; font-size: 58pt; line-height: 1; letter-spacing: -1.5px; margin-top: 5mm; }}
.cover-sub {{ font-size: 14pt; max-width: 145mm; margin-top: 7mm; color: {INK_SOFT}; }}
.cover-stats {{ position: absolute; left: 20mm; bottom: 26mm; display: flex; gap: 12mm; }}
.cover-stats div {{ display: flex; flex-direction: column; }} .cover-stats b {{ font-family: 'Newsreader'; font-size: 30pt; font-weight: 500; }} .cover-stats small {{ font-size: 15pt; color: {INK_SOFT}; }}
.cover-stats span {{ font-size: 9pt; color: {INK_SOFT}; text-transform: uppercase; letter-spacing: 1px; max-width: 34mm; }}
.cover-mascot {{ position: absolute; right: 14mm; top: 34mm; width: 108mm; }}
.cover-by {{ position: absolute; left: 20mm; bottom: 11mm; font-size: 9pt; color: {INK_SOFT}; }}
/* grids */
.grid3 {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; margin-bottom: 9mm; }}
.card {{ background: {SHELL}; border-radius: 16px; padding: 6mm; }} .cicon {{ width: 18mm; margin-bottom: 2mm; }}
.split {{ display: grid; grid-template-columns: 1.15fr 1fr; gap: 12mm; }}
.stack {{ display: flex; flex-direction: column; gap: 3mm; }}
.pill {{ display: flex; flex-direction: column; border-left: 3px solid {SEA}; padding: 1.5mm 4mm; }} .pill span {{ font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1.5px; color: {INK_SOFT}; }} .pill b {{ font-size: 11pt; font-weight: 500; }}
/* rings */
.rings {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm; margin-top: 6mm; }}
.ringbox {{ background: {SHELL}; border-radius: 18px; padding: 7mm 5mm; text-align: center; }} .ringbox p {{ margin-top: 4mm; font-size: 10pt; }}
/* waves */
.waves {{ display: flex; flex-direction: column; gap: 2.6mm; }}
.wave {{ display: grid; grid-template-columns: 14mm 1fr 16mm; align-items: center; gap: 5mm; background: {SHELL}; border-radius: 12px; padding: 2.4mm 5mm; }}
.wave.now {{ background: {SEA_DEEP}; }} .wave.now * {{ color: {PAPER} !important; }} .wave.now .bar {{ background: rgba(245,237,225,.25) !important; }} .wave.now .bar > div {{ background: {PAPER} !important; }}
.wid {{ font-family: 'JetBrains Mono'; font-size: 13pt; font-weight: 600; }} .wtitle {{ font-weight: 600; font-size: 11pt; }} .wdesc {{ font-size: 9pt; color: {INK_SOFT}; margin: .5mm 0 1.5mm; }} .wpct {{ font-family: 'Newsreader'; font-size: 17pt; text-align: right; }}
.wave .bar {{ height: 7px !important; }}
.bands {{ display: grid; grid-template-columns: 1fr 1.6fr 1.6fr; gap: 4mm; margin-top: 4mm; }}
.band {{ font-size: 9pt; padding: 3mm 4mm; border-radius: 10px; background: {SEA}; color: {PAPER}; }} .band b {{ color: {PAPER}; margin-right: 2mm; }}
.band.v2 {{ background: {SAND}; color: {INK}; }} .band.v2 b {{ color: {INK}; }} .band.v3 {{ background: {STONE}; color: {INK}; }} .band.v3 b {{ color: {INK}; }}
/* slices */
.slices {{ display: grid; grid-template-columns: 1fr 1fr; gap: 2.6mm 6mm; }}
.slice {{ display: flex; align-items: center; gap: 3mm; background: {SHELL}; border-radius: 10px; padding: 2.8mm 4mm; }}
.sid {{ font-family: 'JetBrains Mono'; font-size: 9pt; color: {SEA_DEEP}; font-weight: 600; }} .stitle {{ flex: 1; font-size: 10pt; }}
.gate {{ margin-top: 6mm; font-size: 10.5pt; border: 1.5px dashed {SEA}; border-radius: 12px; padding: 4mm 5mm; color: {INK_SOFT}; }}
/* before after */
.ba-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 6mm 12mm; }}
.ba {{ background: {SHELL}; border-radius: 14px; padding: 5mm; }} .ba-label {{ font-weight: 600; font-size: 10.5pt; margin-bottom: 3mm; }}
.ba-row {{ display: flex; align-items: center; gap: 3mm; margin-top: 2mm; }} .ba-tag {{ width: 13mm; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1px; color: {INK_SOFT}; }}
.ba-num {{ width: 18mm; text-align: right; font-family: 'Newsreader'; font-size: 17pt; }} .ba-num small {{ font-size: 10pt; color: {INK_SOFT}; }} .muted {{ color: {INK_SOFT}; }}
/* evals */
.evals {{ display: flex; flex-direction: column; gap: 3.2mm; }}
.erow {{ display: grid; grid-template-columns: 95mm 1fr 24mm; align-items: center; gap: 6mm; }}
.ename b {{ display: block; font-size: 11pt; font-weight: 600; }} .ename span {{ font-size: 8.8pt; color: {INK_SOFT}; }}
.escore {{ font-family: 'Newsreader'; font-size: 19pt; text-align: right; }} .escore small {{ font-size: 11pt; color: {INK_SOFT}; }}
/* phone */
.phone-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 5mm; margin-bottom: 10mm; height: 52mm; }}
.big {{ background: {ABYSS}; border-radius: 16px; padding: 6mm 5mm; display: flex; flex-direction: column; gap: 2mm; }}
.big b {{ font-family: 'Newsreader'; font-size: 34pt; font-weight: 500; color: {GLOW}; }} .big small {{ font-size: 15pt; color: {KELP}; }} .big span {{ font-size: 10.5pt; color: {FOAM}; line-height: 1.45; }}
ul {{ list-style: none; display: flex; flex-direction: column; gap: 3.5mm; }} li {{ font-size: 11.5pt; line-height: 1.45; padding-left: 7mm; position: relative; color: {INK}; }}
.ticks li::before {{ content: '✓'; position: absolute; left: 0; color: {SEA_DEEP}; font-weight: 700; }}
.dots li::before {{ content: '○'; position: absolute; left: 0; color: {AMBER}; font-weight: 700; }}
/* arch */
.arch {{ display: flex; flex-direction: column; align-items: stretch; gap: 2mm; max-width: 245mm; }}
.arow {{ display: flex; gap: 6mm; }} .abox {{ flex: 1; text-align: center; background: {SHELL}; border-radius: 14px; padding: 5.5mm 4mm; font-weight: 600; font-size: 13pt; }}
.abox small {{ display: block; font-weight: 400; font-size: 9.8pt; color: {INK_SOFT}; margin-top: 1.2mm; }}
.abox.ui {{ background: {SAND}; }} .abox.harness {{ background: {SEA_DEEP}; color: {PAPER}; }} .abox.harness small {{ color: {SHELL}; }}
.abox.cage {{ background: {INK}; color: {PAPER}; }} .abox.cage small {{ color: {STONE}; }} .abox.model {{ background: {ABYSS}; color: {GLOW}; flex: 1.4; }} .abox.model small {{ color: {KELP}; }}
.abox.data {{ border: 2px solid {SEA}; background: {PAPER}; }}
.arrow {{ text-align: center; color: {SEA}; font-size: 13pt; line-height: 1; }}
.arch-legend {{ margin-top: 5mm; display: flex; gap: 6mm; font-size: 9pt; color: {INK_SOFT}; }} .arch-legend span:first-child {{ font-weight: 700; color: {INK}; }}
/* features */
.feats {{ display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 1fr; gap: 5mm; height: 128mm; }}
.feat {{ display: flex; gap: 5mm; align-items: center; background: {SHELL}; border-radius: 16px; padding: 5mm 6mm; }} .ficon {{ width: 21mm; flex: none; }} .feat b {{ font-size: 13.5pt; }} .feat p {{ font-size: 10pt; margin-top: 1.5mm; }}
/* timeline */
.timeline {{ position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 4mm; margin: 4mm 0 10mm; }}
.timeline::before {{ content: ''; position: absolute; left: 3mm; right: 3mm; top: 2.6mm; height: 2px; background: {STONE}; }}
.day {{ position: relative; }} .dot {{ width: 5.5mm; height: 5.5mm; border-radius: 50%; background: {SEA_DEEP}; border: 3px solid {PAPER}; position: relative; }}
.ddate {{ font-family: 'Newsreader'; font-size: 16pt; margin: 3mm 0 1.5mm; }} .dtext {{ font-size: 10pt; color: {INK_SOFT}; line-height: 1.45; }}
.counters {{ display: grid; grid-template-columns: repeat(6, 1fr); gap: 4mm; }}
.counters div {{ background: {INK}; border-radius: 14px; padding: 5mm 4mm; display: flex; flex-direction: column; }}
.counters b {{ font-family: 'Newsreader'; font-size: 26pt; font-weight: 500; color: {PAPER}; }} .counters span {{ font-size: 9pt; color: {STONE}; text-transform: uppercase; letter-spacing: 1px; }}
/* map */
.mapgrid {{ display: grid; grid-template-columns: repeat(9, 1fr); gap: 3mm; margin-bottom: 9mm; }}
.m {{ background: {SHELL}; border-radius: 12px; padding: 4mm 3mm; display: flex; flex-direction: column; }} .m b {{ font-family: 'Newsreader'; font-size: 22pt; font-weight: 500; }} .m span {{ font-size: 8.5pt; color: {INK_SOFT}; line-height: 1.3; }}
.stackbar {{ display: flex; height: 12mm; border-radius: 10px; overflow: hidden; }} .stackbar div {{ display: flex; align-items: center; justify-content: center; color: {PAPER}; font-size: 9pt; font-weight: 600; white-space: nowrap; }}
/* comp */
.comp {{ width: 100%; border-collapse: separate; border-spacing: 0 1.6mm; margin-bottom: 7mm; font-size: 10.5pt; }}
.comp th {{ text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1.5px; color: {INK_SOFT}; font-weight: 600; padding: 0 4mm; }}
.comp td {{ background: {SHELL}; padding: 2.4mm 4mm; }} .comp td:first-child {{ border-radius: 10px 0 0 10px; font-weight: 600; }} .comp td:last-child {{ border-radius: 0 10px 10px 0; }}
.comp td.no {{ color: {CORAL}; font-weight: 600; }} .comp tr.hermit td {{ background: {SEA_DEEP}; color: {PAPER}; font-weight: 600; }} .comp td.yes {{ color: {GLOW} !important; }}
/* risks */
.risks {{ display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 1fr; gap: 6mm; height: 118mm; }}
.risk {{ background: {SHELL}; border-radius: 14px; padding: 5mm; border-top: 4px solid {STONE}; }} .risk.warn {{ border-top-color: {CORAL}; }} .risk.mid {{ border-top-color: {AMBER}; }}
.risk {{ padding: 7mm 6mm; }} .risk b {{ font-size: 13pt; }} .risk p {{ margin-top: 3mm; font-size: 11pt; }}
/* steps */
.steps {{ display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 6mm; max-width: 245mm; height: 92mm; }}
.step {{ display: flex; gap: 5mm; background: {SHELL}; border-radius: 16px; padding: 6mm; }}
.step span {{ font-family: 'Newsreader'; font-size: 30pt; color: {SEA_DEEP}; line-height: 1; }} .step b {{ font-size: 13pt; }} .step p {{ margin-top: 1.5mm; }}
.checklist {{ margin-top: 7mm; display: flex; flex-wrap: wrap; gap: 2.5mm; align-items: center; max-width: 245mm; }} .checklist b {{ font-size: 10pt; text-transform: uppercase; letter-spacing: 1.5px; color: {INK_SOFT}; margin-right: 3mm; }}
.ck {{ font-size: 9.5pt; padding: 1.8mm 3.5mm; border-radius: 999px; border: 1.5px solid {AMBER}; color: {AMBER}; }} .ck::before {{ content: '○ '; }} .ck.done {{ border-color: {SEA_DEEP}; background: {SEA_DEEP}; color: {PAPER}; }} .ck.done::before {{ content: '✓ '; }}
.flowh {{ margin-top: 9mm; }} .flow {{ display: flex; align-items: stretch; gap: 2mm; }} .flow > div {{ flex: 1; background: {SHELL}; border-radius: 12px; padding: 4mm; font-weight: 600; font-size: 11pt; }}
.flow small {{ display: block; font-weight: 400; font-size: 8.8pt; color: {INK_SOFT}; margin-top: 1mm; }} .flow i {{ align-self: center; color: {SEA}; font-style: normal; font-size: 14pt; }} .flow .last {{ background: {SEA_DEEP}; color: {PAPER}; }} .flow .last small {{ color: {SHELL}; }}
.guar {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 7mm; max-width: 245mm; }} .guar div {{ border-left: 3px solid {SEA}; padding: 1mm 4mm; }} .guar b {{ font-size: 10.5pt; display: block; }} .guar small {{ font-size: 9pt; color: {INK_SOFT}; }}
.leaps {{ display: grid; grid-template-columns: .7fr 1fr 1fr 1fr 1fr; gap: 4mm; margin-bottom: 6mm; align-items: center; }} .leaps span {{ font-size: 10pt; text-transform: uppercase; letter-spacing: 1.5px; color: {SEA_DEEP}; font-weight: 600; }}
.leaps div:not(:first-child) {{ background: {SHELL}; border-radius: 14px; padding: 4mm 5mm; }} .leaps b {{ font-family: 'Newsreader'; font-size: 21pt; font-weight: 500; display: block; }} .leaps small {{ font-size: 9pt; color: {INK_SOFT}; }}
/* back */
.back-page {{ background: {ABYSS}; padding: 0; }}
.back {{ height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: radial-gradient(circle at 50% 40%, {TRENCH} 0, {ABYSS} 60%); }}
.back-lockup {{ height: 20mm; }} .back-tag {{ font-family: 'Newsreader'; font-size: 24pt; color: {FOAM}; margin-top: 5mm; }}
.back-mascot {{ width: 46mm; margin: 6mm 0; }}
.back-by {{ display: flex; gap: 14mm; align-items: center; }} .dojo {{ display: flex; flex-direction: column; align-items: center; gap: 2mm; }}
.dojo span, .qvac span {{ font-size: 8.5pt; color: {KELP}; text-transform: uppercase; letter-spacing: 2px; }} .dojo img {{ height: 14mm; }}
.qvac {{ border-left: 1px solid {CURRENT}; padding-left: 14mm; }}
.fine {{ position: absolute; bottom: 10mm; left: 30mm; right: 30mm; font-size: 8pt; color: {KELP}; }}
"""

html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>State of Hermit · 13 November 2026</title><style>{CSS}</style></head>
<body>{''.join(pages)}</body></html>"""

OUT.mkdir(parents=True, exist_ok=True)
html_path = OUT / "hermit-state-2026-11-13.html"
pdf_path = OUT / "hermit-state-2026-11-13.pdf"
html_path.write_text(html, encoding="utf-8")
chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
subprocess.run([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=8000",
                f"--print-to-pdf={pdf_path}", html_path.as_uri()], check=True, capture_output=True)
print(pdf_path)
