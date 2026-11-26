// Dev-only mascot test page (docs/design/mascot). The real components from src/components, in a browser:
//   ?mode=still&pose=04-asking&theme=dark   any rig pose, still, 512 wide (the proof's pixel diff)
//   ?mode=rest&pose=asking&from=idle        an app pose reached by a real transition, at rest, 512 wide
//   ?mode=clip&clip=flow&theme=light        a scripted run of poses, for the clips
//   ?mode=demo&quiet=1 | &reduce=1          the full <Mascot> with Quiet mode or the phone's reduced motion
import { useEffect, useState } from "react";
import { AppRegistry, Text, View } from "react-native";
import { Mascot } from "../../src/components/Mascot";
import { MascotArt, MascotStill } from "../../src/components/MascotArt";
import type { Pose } from "../../src/mascot";
import type { RigPoseName } from "../../src/mascot-rig.ts";

const q = new URLSearchParams(location.search);
const mode = q.get("mode") ?? "still";
const dark = q.get("theme") === "dark";
const ground = dark ? "#06121D" : "#F5EDE1";
const ink = dark ? "#E7F1F0" : "#2B221B";
const soft = dark ? "#8FA9B5" : "#6B5E52";
// Videos are recorded in CSS pixels: the clips draw the page twice as large (?zoom=2) to stay sharp.
if (q.get("zoom")) document.documentElement.style.setProperty("zoom", q.get("zoom"));
const w = window as unknown as { __ready?: boolean; __done?: boolean; __errors?: string[] };
w.__errors = [];
window.addEventListener("error", (e) => w.__errors!.push(String(e.error?.stack ?? e.message)));

/** A scripted run: [ms after start, pose]. The page says it is done at `end`. */
const CLIPS: Record<string, { steps: [number, Pose][]; end: number; seed: number; title: string }> = {
  // Seed 24 blinks twice near 3.9 s, then once near 8.5 s.
  idle: { steps: [[0, "idle"]], end: 9200, seed: 24, title: "Idle: breathing and blinks" },
  hello: { steps: [[0, "hello"]], end: 4200, seed: 3, title: "Hello: two waves, then rest" },
  flow: {
    steps: [[0, "idle"], [1200, "thinking"], [3900, "working"], [6600, "done"]],
    end: 9400,
    seed: 5,
    title: "Idle, thinking, working, done",
  },
  "asking-error": { steps: [[0, "idle"], [1000, "asking"], [4100, "error"]], end: 7000, seed: 9, title: "Asking, then an error" },
  tuck: { steps: [[0, "idle"], [1000, "blocked"], [3600, "offline"], [6000, "idle"]], end: 8200, seed: 4, title: "Blocked, offline, back out" },
};

const caption: Record<Pose, string> = {
  idle: "idle",
  hello: "hello",
  thinking: "thinking",
  working: "working",
  asking: "asking",
  done: "done",
  error: "error",
  blocked: "blocked",
  offline: "offline",
};

function afterPaint(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function Still() {
  useEffect(() => afterPaint(() => (w.__ready = true)), []);
  return <MascotStill rig={(q.get("pose") ?? "01-idle") as RigPoseName} dark={dark} width={512} />;
}

function Rest() {
  const target = (q.get("pose") ?? "idle") as Pose;
  const [pose, setPose] = useState<Pose>((q.get("from") ?? "idle") as Pose);
  useEffect(() => {
    const change = setTimeout(() => setPose(target), 60);
    // The longest change settles in under two seconds (mascot.test.ts); then the frame is the rest frame.
    const ready = setTimeout(() => afterPaint(() => (w.__ready = true)), 2600);
    return () => {
      clearTimeout(change);
      clearTimeout(ready);
    };
  }, [target]);
  return <MascotArt pose={pose} dark={dark} width={512} live ambient={false} />;
}

function Stage({ pose, title, children }: { pose: Pose | null; title: string; children: React.ReactNode }) {
  return (
    <View style={{ width: 400, height: 340, backgroundColor: ground, alignItems: "center", justifyContent: "center", gap: 10 }}>
      <View style={{ width: 240, height: 208, alignItems: "center", justifyContent: "center" }}>{children}</View>
      <Text style={{ color: ink, fontSize: 15, fontWeight: "600", fontFamily: "system-ui, sans-serif" }}>{pose ? caption[pose] : " "}</Text>
      <Text style={{ color: soft, fontSize: 12, fontFamily: "system-ui, sans-serif" }}>{title}</Text>
    </View>
  );
}

function useScript(steps: [number, Pose][], end: number): Pose {
  const [pose, setPose] = useState<Pose>(steps[0]![1]);
  useEffect(() => {
    const timers = steps.slice(1).map(([at, p]) => setTimeout(() => setPose(p), at));
    timers.push(setTimeout(() => (w.__done = true), end));
    w.__ready = true;
    return () => timers.forEach(clearTimeout);
  }, [steps, end]);
  return pose;
}

function Clip() {
  const clip = CLIPS[q.get("clip") ?? "flow"]!;
  const pose = useScript(clip.steps, clip.end);
  return (
    <Stage pose={pose} title={clip.title}>
      <MascotArt pose={pose} dark={dark} width={240} live ambient seed={clip.seed} />
    </Stage>
  );
}

const QUIET: [number, Pose][] = [[0, "idle"]];
const REDUCED: [number, Pose][] = [[0, "idle"], [1200, "thinking"], [3200, "done"]];

/** The full component, as a screen uses it, with the appearance rules: Quiet mode hides it, reduced motion stills it. */
function Demo() {
  const quiet = q.get("quiet") === "1";
  const pose = useScript(quiet ? QUIET : REDUCED, quiet ? 1500 : 5200);
  const title = quiet ? "Quiet mode: no crab, the words stay" : "Reduced motion: still, poses swap";
  return (
    <Stage pose={pose} title={title}>
      <Mascot state={pose} dark={dark} width={240} />
    </Stage>
  );
}

const pages: Record<string, () => React.ReactElement> = { still: Still, rest: Rest, clip: Clip, demo: Demo };
AppRegistry.registerComponent("mascot", () => pages[mode] ?? Still);
AppRegistry.runApplication("mascot", { rootTag: document.getElementById("root") });
