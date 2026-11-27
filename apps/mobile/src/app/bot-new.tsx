// HM-BOT-03: a new bot. Templates first (the roster's "＋"), or prefilled from Hermit's proposal (/bot-new?offer=<id>,
// read through bots.proposal): a name, a look (a shell and a color), a role, permissions in plain words, sources and the
// mode. Routines come later, from the bot's settings. The form is the review: Create from here is `reviewed: true`, and
// a proposal drafted after Hermit read other people's text says so above every field. The fingerprint is asked by the
// runtime when the grants or the mode need it; this screen only says so beforehand.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { PermissionMode } from "@hermit/core";
import type { BotProposalView } from "@hermit/runtime";
import { BOT_TEMPLATES, capBotName, fromProposal, fromTemplate, formNeedsFingerprint, formProblems, toNewBot, type BotForm, type BotTemplateId } from "../bot-form-view";
import { BLANK_LOOK, TEMPLATE_LOOKS } from "../bot-templates";
import { BotAvatar } from "../components/BotAvatar";
import { ModeSheet } from "../components/ModeSheet";
import { ConnectorsList, GroupsList, LookPicker, Refusal, modeLine, useSourceChoices } from "../components/BotFormParts";
import { Btn, Card, Footer, Group, Input, Label, Loading, Note, Page, Row, T } from "../components/kit";
import { useHermit } from "../hermit-context";
import { t } from "../i18n";
import { s } from "../theme";
import { usePalette } from "../use-palette";

type Stage =
  | { kind: "loading" }
  | { kind: "templates"; gone?: true }
  | { kind: "form"; form: BotForm; offerId?: string; tainted?: true };

export default function BotNew() {
  const p = usePalette();
  const router = useRouter();
  const { status } = useHermit();
  const hermit = status.kind === "ready" ? status.hermit : undefined;
  const { offer } = useLocalSearchParams<{ offer?: string }>();
  const offerId = typeof offer === "string" && offer ? offer : undefined;
  const [stage, setStage] = useState<Stage>(offerId ? { kind: "loading" } : { kind: "templates" });
  const [globalMode, setGlobalMode] = useState<PermissionMode>("ask");
  const [typed, setTyped] = useState<string>();
  const [modeOpen, setModeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string>();
  const choices = useSourceChoices();

  useEffect(() => {
    if (!hermit) return;
    void hermit.modes.global().then(setGlobalMode).catch(() => {});
    if (!offerId) return;
    const proposal: BotProposalView | undefined = hermit.bots.proposal(offerId);
    setStage(proposal ? { kind: "form", form: fromProposal(proposal), offerId, ...(proposal.tainted ? { tainted: true as const } : {}) } : { kind: "templates", gone: true });
  }, [hermit, offerId]);

  const form = stage.kind === "form" ? stage.form : undefined;
  const problems = useMemo(() => (form ? formProblems(form) : []), [form]);
  const edit = (patch: Partial<BotForm>) => {
    setRefused(undefined);
    setStage((st) => (st.kind === "form" ? { ...st, form: { ...st.form, ...patch } } : st));
  };

  const pick = (id: BotTemplateId | "blank") =>
    setStage({ kind: "form", form: id === "blank" ? { name: "", role: "", look: BLANK_LOOK, grants: ["notes"], sites: "", connectors: [], mode: null } : fromTemplate(id, t, TEMPLATE_LOOKS[id]) });

  const create = async () => {
    if (!hermit || !form || stage.kind !== "form") return;
    setBusy(true);
    setRefused(undefined);
    try {
      const r = await hermit.bots.create(toNewBot(form), { reviewed: true, ...(typed ? { typed } : {}), ...(stage.offerId ? { offerId: stage.offerId } : {}) });
      if (r.kind === "refused") return setRefused(r.reason);
      router.replace({ pathname: "/chat", params: { bot: r.bot.id } });
    } catch {
      // A create that threw failed; it isn't passed off as a busy bot.
      setRefused("failed");
    } finally {
      setBusy(false);
    }
  };

  if (stage.kind === "loading") {
    return (
      <Page title={t("HM-BOT-03.title")}>
        <Loading text={t("HM-BOT-03.loading")} />
      </Page>
    );
  }

  if (stage.kind === "templates") {
    return (
      <Page title={t("HM-BOT-03.title")} subtitle={<T v="body" color="soft">{t("HM-BOT-03.templatesIntro")}</T>}>
        <View style={{ gap: s.lg }}>
          {stage.gone ? <Note icon="info" text={t("HM-BOT-03.proposalGone")} /> : null}
          <Group>
            {BOT_TEMPLATES.map((tpl) => (
              <Row
                key={tpl.id}
                leading={<BotAvatar bot={{ primary: false, look: TEMPLATE_LOOKS[tpl.id], name: t(`HM-BOT-03.template.${tpl.id}.name`) }} size={40} dark={p.dark} />}
                title={t(`HM-BOT-03.template.${tpl.id}.name`)}
                sub={<T v="small" color="soft" lines={2}>{t(`HM-BOT-03.template.${tpl.id}.role`)}</T>}
                chevron
                a11y={`${t(`HM-BOT-03.template.${tpl.id}.name`)}, ${t("HM-BOT-03.templateSub")}`}
                onPress={() => pick(tpl.id)}
              />
            ))}
          </Group>
          <Group>
            <Row icon="plus" title={t("HM-BOT-03.blank")} sub={t("HM-BOT-03.blankSub")} chevron onPress={() => pick("blank")} />
          </Group>
        </View>
      </Page>
    );
  }

  const { form: f } = stage;
  const needsFinger = formNeedsFingerprint(f);
  const mode = modeLine(f.mode, globalMode);
  const shown = problems.filter((x) => x !== "name_empty");
  return (
    <Page
      title={stage.offerId ? t("HM-BOT-03.fromProposal") : t("HM-BOT-03.title")}
      footer={
        <Footer>
          <View style={{ flex: 1, gap: s.sm }}>
            {refused ? <Refusal reason={refused} name={f.name.trim()} /> : null}
            {needsFinger ? <Note icon="fingerprint" text={t("HM-BOT-03.fingerprintNote")} /> : null}
            <Btn label={t("HM-BOT-03.create")} icon="check" full disabled={problems.length > 0} busy={busy} onPress={() => void create()} />
          </View>
        </Footer>
      }
    >
      <View style={{ gap: s.lg }}>
        {stage.tainted ? (
          <Card tone="amber">
            <Note icon="triangle-alert" tone="amber" textColor="text" text={t("HM-BOT-03.taintedProposal")} />
          </Card>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: s.lg }}>
          <BotAvatar bot={{ primary: false, look: f.look, name: f.name.trim() || t("HM-BOT-03.title") }} size={64} dark={p.dark} />
          <Input
            label={t("HM-BOT-03.name")}
            value={f.name}
            onChange={(name) => edit({ name: capBotName(name) })}
            invalid={problems.includes("name_too_long")}
            style={{ flex: 1 }}
            field={{ autoCapitalize: "words" }}
          />
        </View>
        {problems.includes("name_too_long") ? <Refusal reason="name_too_long" name={f.name.trim()} /> : null}

        <View>
          <Label style={{ marginTop: 0 }}>{t("HM-BOT-03.look")}</Label>
          <LookPicker look={f.look} onChange={(look) => edit({ look })} />
        </View>

        <Input
          label={t("HM-BOT-03.role")}
          hint={t("HM-BOT-03.roleHint")}
          value={f.role}
          onChange={(role) => edit({ role })}
          invalid={problems.includes("role_too_long")}
          field={{ multiline: true, autoCapitalize: "sentences" }}
        />
        {problems.includes("role_too_long") ? <Refusal reason="role_too_long" name={f.name.trim()} /> : null}

        <View>
          <Label style={{ marginTop: s.sm }}>{t("HM-BOT-03.permissions")}</Label>
          <T v="small" color="soft" style={{ paddingHorizontal: s.lg, marginBottom: s.md }}>{t("HM-BOT-03.permissionsHint")}</T>
          <GroupsList grants={f.grants} onChange={(grants) => edit({ grants })} />
        </View>

        <View>
          <Label style={{ marginTop: s.sm }}>{t("HM-BOT-03.sources")}</Label>
          <T v="small" color="soft" style={{ paddingHorizontal: s.lg, marginBottom: s.md }}>{t("HM-BOT-03.sourcesHint")}</T>
          <View style={{ gap: s.lg }}>
            <Input label={t("HM-BOT-03.sites")} hint={t("HM-BOT-03.sitesHint")} value={f.sites} onChange={(sites) => edit({ sites })} invalid={shown.includes("bad_site")} mono field={{ multiline: true, keyboardType: "url" }} />
            {shown.includes("bad_site") ? <Refusal reason="bad_site" name={f.name.trim()} /> : null}
            <View style={{ gap: s.sm }}>
              <T v="footnoteStrong" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-BOT-03.connectors")}</T>
              <ConnectorsList choices={choices} on={f.connectors} onChange={(connectors) => edit({ connectors })} />
            </View>
          </View>
        </View>

        <View>
          <Label style={{ marginTop: s.sm }}>{t("HM-BOT-03.mode")}</Label>
          <Group>
            <Row title={mode.title} sub={mode.sub} chevron a11y={`${t("HM-BOT-03.mode")}: ${mode.title}. ${mode.sub}`} onPress={() => setModeOpen(true)} />
          </Group>
        </View>

        <Note icon="info" text={t("HM-BOT-03.routinesLater")} />
      </View>
      {/* A new bot has no mode before: an own Don't ask takes the sheet and the word each time it is chosen (bots.create). */}
      <ModeSheet
        open={modeOpen}
        current={f.mode}
        from={null}
        global={globalMode}
        allowInherit
        onConfirm={(next, word) => {
          setTyped(word);
          edit({ mode: next });
        }}
        onClose={() => setModeOpen(false)}
      />
    </Page>
  );
}
