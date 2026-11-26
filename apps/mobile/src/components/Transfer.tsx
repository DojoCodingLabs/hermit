// One USD₮ movement as a row (HM-PAY-01's latest movements, HM-PAY-03's list): an arrow in a tile, the user's own name
// for the address (or the direction and the whole address: see transferParty), the time said relative to now, and the
// exact signed amount, tabular, with two decimals so a column lines up. Nothing here is text from the chain: transferRow
// (wallet-view.ts) refuses anything but USD₮ on Stable testnet.
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { formatMoney } from "@hermit/core";
import type { WalletTransfer } from "@hermit/runtime";
import { when } from "../format";
import { currentLocale, t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";
import { transferParty, transferRow } from "../wallet-view";
import { Icon } from "./Icon";
import { Badge, T, Tile, TitleLine, WholeAddress } from "./kit";

export function TransferItem({ item, now, logLink = false, brief = false }: { item: WalletTransfer; now: number; logLink?: boolean; brief?: boolean }) {
  const p = usePalette();
  const router = useRouter();
  const locale = currentLocale();
  const row = transferRow(item, locale, formatMoney);
  const title = t(row.titleKey);
  const who = item.direction === "self" ? "" : t(item.direction === "in" ? "HM-PAY-03.from" : "HM-PAY-03.to", { who: row.who });
  const moment = item.at !== undefined ? when(item.at, now, locale) : undefined;
  const whenText = moment ? t(moment.key, moment.vars) : t("HM-PAY-03.block", { n: row.whenBlock ?? "" });
  // Names first. Address poisoning: with no saved name the direction leads and the address follows whole (mono, in
  // groups of four, wrapping only between groups, never cut), so a look-alike sharing its first and last characters
  // still reads differently.
  const party = transferParty(item);
  const named = !!party.name && item.direction !== "self";
  const headline = named ? party.name! : title;
  const detail = [named ? title : "", whenText].filter(Boolean).join(" · ");
  return (
    <View style={{ flexDirection: "row", gap: s.md, paddingVertical: s.md, paddingHorizontal: s.lg, alignItems: "flex-start" }}>
      <Tile icon={item.direction === "in" ? "arrow-down-left" : item.direction === "out" ? "arrow-up-right" : "refresh-cw"} tone={item.direction === "in" ? "accent" : "plain"} />
      <View style={{ flex: 1, gap: 2 }}>
        {/* One TalkBack stop for the row's facts (the whole address, the exact time); the log link is its own stop. */}
        <View
          style={{ gap: 2 }}
          accessible
          accessibilityLabel={[t("HM-PAY-03.rowLabel", { title, amount: row.amount, who, when: row.when ?? whenText }), row.unknownSender ? `${t("HM-PAY-03.unknownShort")}: ${t("HM-PAY-03.unknownSender")}` : ""].filter(Boolean).join(". ")}
        >
          <TitleLine title={headline} lines={1} aside={row.amount} asideV="bodyStrong" asideColor={item.direction === "in" ? "accent" : "text"} />
          {!named && item.direction !== "self" && party.address ? <WholeAddress address={party.address} /> : null}
          <T v="small" color="soft">{detail}</T>
          {row.unknownSender ? (
            // A real warning, kept whole: never send money back to an address just because it sent you some.
            <View style={{ gap: s.xs, marginTop: s.xs }}>
              <Badge label={t("HM-PAY-03.unknownShort")} tone="amber" />
              <T v="small" color="soft">{t(brief ? "HM-PAY-03.unknownBrief" : "HM-PAY-03.unknownSender")}</T>
            </View>
          ) : null}
        </View>
        {logLink && item.logSeq !== undefined ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t("HM-PAY-03.logLink")}
            onPress={() => router.push({ pathname: "/activity-entry", params: { seq: String(item.logSeq) } })}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: s.xs, minHeight: 48, alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
          >
            <Icon name="shield-check" size={20} color={p.accent} />
            <T v="smallStrong" color="link">{t("HM-PAY-03.byHermit")}</T>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
