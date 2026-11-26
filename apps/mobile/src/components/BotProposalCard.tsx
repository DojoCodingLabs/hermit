// Hermit's bot proposal, in the chat (HM-CHAT-01, HM-BOT-03): a card the app draws, not a message. Its labels are code's
// words; what Hermit proposed (the name, the role, the sites) sits under them as data, the role quoted under "Rol
// propuesto por Hermit". The permissions are the groups in plain words. Create is one tap (the runtime asks for the
// fingerprint when the grants or the mode need it); Review opens the whole form. A proposal drafted after Hermit read
// other people's text offers only Review: the user looks at every field before anything is created (proposalCard).
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { BotProposalView } from "@hermit/runtime";
import { fromProposal, proposalCard, toNewBot } from "../bot-form-view";
import { useHermit } from "../hermit-context";
import { quoted } from "../format";
import { t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";
import { BotAvatar } from "./BotAvatar";
import { Refusal, modeName } from "./BotFormParts";
import { Icon } from "./Icon";
import { Btn, Card, Note, T } from "./kit";

type Result = { kind: "idle" } | { kind: "busy" } | { kind: "created"; botId: string } | { kind: "refused"; reason: string };

export function BotProposalCard({ proposal }: { proposal: BotProposalView }) {
  const p = usePalette();
  const router = useRouter();
  const { status } = useHermit();
  const hermit = status.kind === "ready" ? status.hermit : undefined;
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const create = async () => {
    if (!hermit) return;
    setResult({ kind: "busy" });
    try {
      const r = await hermit.bots.create(toNewBot(fromProposal(proposal)), { offerId: proposal.offerId });
      setResult(r.kind === "done" ? { kind: "created", botId: r.bot.id } : { kind: "refused", reason: r.reason });
    } catch {
      // A create that threw failed; it isn't passed off as a busy bot.
      setResult({ kind: "refused", reason: "failed" });
    }
  };
  const review = () => router.push({ pathname: "/bot-new", params: { offer: proposal.offerId } });
  const card = proposalCard(proposal);

  return (
    <Card tone={proposal.tainted ? "amber" : undefined} style={{ alignSelf: "stretch", gap: s.md }}>
      <View accessible accessibilityLabel={t("HM-CHAT-01.proposal.a11y", { name: proposal.name })} style={{ flexDirection: "row", alignItems: "center", gap: s.md }}>
        <BotAvatar bot={{ primary: false, look: proposal.look, name: proposal.name }} size={40} dark={p.dark} />
        <T v="footnoteStrong" color="soft" role="header">{t("HM-CHAT-01.proposal.kicker")}</T>
      </View>

      <View style={{ gap: 2 }}>
        <T v="footnoteStrong" color="soft">{t("HM-CHAT-01.proposal.name")}</T>
        <T v="bodyStrong">{proposal.name}</T>
      </View>
      <View style={{ gap: 2 }}>
        <T v="footnoteStrong" color="soft">{t("HM-CHAT-01.proposal.role")}</T>
        <T v="body" lines={5}>{quoted(proposal.role)}</T>
      </View>
      <View style={{ gap: s.xs }}>
        <T v="footnoteStrong" color="soft">{t("HM-CHAT-01.proposal.grants")}</T>
        {proposal.grants.map((g) => (
          <View key={g} style={{ flexDirection: "row", alignItems: "center", gap: s.sm }}>
            <Icon name="check" size={20} color={p.accent} />
            <T v="small" style={{ flex: 1 }}>{t(`HM-BOT-04.group.${g}`)}</T>
          </View>
        ))}
      </View>
      {proposal.sources.sites.length ? (
        <View style={{ gap: 2 }}>
          <T v="footnoteStrong" color="soft">{t("HM-CHAT-01.proposal.sites")}</T>
          {proposal.sources.sites.map((site) => <T key={site} v="monoSmall">{site}</T>)}
        </View>
      ) : null}

      <View style={{ gap: 2 }}>
        <T v="footnoteStrong" color="soft">{t("HM-CHAT-01.proposal.mode")}</T>
        <T v="small">{t("HM-CHAT-01.proposal.modeValue", { mode: modeName(card.mode) })}</T>
      </View>
      {card.modeNote ? <Note icon="triangle-alert" tone={card.mode === "dont_ask" ? "coral" : "amber"} textColor="text" text={t(card.modeNote)} /> : null}
      {card.note === "tainted" ? <Note icon="triangle-alert" tone="amber" textColor="text" text={t("HM-CHAT-01.proposal.tainted")} /> : null}
      {card.note === "fingerprint" ? <Note icon="fingerprint" text={t("HM-CHAT-01.proposal.fingerprint")} /> : null}
      {result.kind === "refused" ? <Refusal reason={result.reason} name={proposal.name} /> : null}

      {result.kind === "created" ? (
        <View style={{ gap: s.xs }}>
          <Note icon="circle-check" text={t("HM-CHAT-01.proposal.created")} />
          <Btn label={t("HM-CHAT-01.proposal.open")} kind="secondary" small onPress={() => router.push({ pathname: "/chat", params: { bot: result.botId } })} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: s.sm }}>
          {card.actions.includes("create") ? <Btn label={t("HM-CHAT-01.proposal.create")} icon="check" small busy={result.kind === "busy"} onPress={() => void create()} /> : null}
          <Btn label={t("HM-CHAT-01.proposal.review")} kind={card.actions.includes("create") ? "secondary" : "primary"} small disabled={result.kind === "busy"} onPress={review} />
        </View>
      )}
    </Card>
  );
}
