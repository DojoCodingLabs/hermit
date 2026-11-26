// A tool's or an operation's risk at a glance (HM-CONN-03, HM-CONN-04), always next to its words: reading is plain,
// sending amber ("needs you"), a write that can delete amber with the trash, and what the cage blocks coral.
import type { IconName } from "./Icon";
import { Tile, type TileTone } from "./kit";

const RISK_TILE: Record<string, { icon: IconName; tone: TileTone }> = {
  network: { icon: "eye", tone: "plain" },
  remote_write: { icon: "pen-line", tone: "plain" },
  send: { icon: "send", tone: "amber" },
  credential: { icon: "key-round", tone: "coral" },
  spend: { icon: "wallet", tone: "coral" },
};

export function RiskTile({ risk, destructive }: { risk: string; destructive?: boolean }) {
  const look = destructive && risk === "remote_write" ? { icon: "trash-2" as IconName, tone: "amber" as TileTone } : RISK_TILE[risk] ?? { icon: "plug" as IconName, tone: "plain" as TileTone };
  return <Tile icon={look.icon} tone={look.tone} />;
}
