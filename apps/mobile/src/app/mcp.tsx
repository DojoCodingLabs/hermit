// HM-CONN-03: add an MCP server (US-CONN-03, SL-54). The rules live in @hermit/connectors (McpServers) behind the
// runtime; this screen draws its states: ST-LOAD, ST-EMPTY-FIRST, ST-IDEAL (servers with per-tool toggles and risks),
// the address the user types or pastes, ST-PENDING while it is checked, the sign-in hand-off to the browser, the review
// sheet (verified host, scopes, each tool with its code-derived risk, never the server's text) and ST-ERROR.
// Design pass: the address field and Check as the primary action; each server one grouped list: its host and scopes,
// then its tools (the raw name in mono, a tile and the risk in words, a switch; the read claim as one short line with
// its own switch; coral notes when the code overrules the server or a tool changed), then Remove as a coral row. The
// sign-in hand-off and the review show host, sign-in host and scopes in a card, with the action pinned at the foot.
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Linking, View } from "react-native";
import type { McpAddProblem, McpReview, McpServerView } from "@hermit/runtime";
import { Btn, Card, Failed, Field, Footer, Group, Input, Loading, Note as NoteLine, Page, Row, T, Toggle } from "../components/kit";
import { RiskTile } from "../components/Risk";
import { useHermit } from "../hermit-context";
import { currentDraft, startDraft, takeResult } from "../mcp-flow";
import { t, tCount } from "../i18n";
import { s } from "../theme";

type Screen =
  | { kind: "loading" }
  | { kind: "list"; servers: McpServerView[] }
  | { kind: "checking" }
  | { kind: "sign_in"; host: string; signInHost: string; scopes: string[]; url: string }
  | { kind: "review"; review: McpReview; enabled: string[]; confirmRead: string[] }
  | { kind: "error"; problem: McpAddProblem | "failed" };

const scopesText = (scopes: string[]) => (scopes.length ? scopes.join(", ") : t("HM-CONN-03.noScopes"));

export default function McpServers() {
  const { status } = useHermit();
  const mcp = status.kind === "ready" ? status.hermit.mcp : undefined;
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  // SL-55: HM-CONN-04 can prefill an official server from the bundled list; the user still taps to check it.
  const params = useLocalSearchParams<{ url?: string }>();
  const [url, setUrl] = useState(typeof params.url === "string" ? params.url : "");
  // A change that adds more than one character at once is a paste; either way it is the user's own act.
  const origin = useRef<"typed" | "pasted" | "suggested">(typeof params.url === "string" ? "suggested" : "typed");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!mcp) return;
    const back = takeResult();
    if (back) return setScreen(back.kind === "review" ? reviewScreen(back.review) : { kind: "error", problem: back.problem });
    try {
      setScreen({ kind: "list", servers: await mcp.list() });
    } catch {
      setScreen({ kind: "error", problem: "failed" });
    }
  }, [mcp]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const check = async () => {
    if (!mcp) return;
    setScreen({ kind: "checking" });
    try {
      const r = await mcp.begin({ url, origin: origin.current });
      if (r.kind === "refused") return setScreen({ kind: "error", problem: r.problem });
      if (r.kind === "review") return setScreen(reviewScreen(r.review));
      startDraft(r.draftId);
      setScreen({ kind: "sign_in", host: r.host, signInHost: r.signInHost, scopes: r.scopes, url: r.authorizationUrl });
    } catch {
      setScreen({ kind: "error", problem: "failed" });
    }
  };

  const cancel = async (draftId: string | undefined) => {
    if (draftId) await mcp?.cancel(draftId).catch(() => {});
    startDraft(undefined);
    setUrl("");
    await load();
  };

  const approve = async (sc: Extract<Screen, { kind: "review" }>) => {
    setBusy(true);
    try {
      const r = await mcp!.approve(sc.review.draftId, { enabled: sc.enabled, confirmRead: sc.confirmRead });
      if (!r.ok) return setScreen({ kind: "error", problem: r.problem });
      startDraft(undefined);
      setUrl("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = (server: McpServerView) =>
    Alert.alert(t("HM-CONN-03.removeTitle", { host: server.host }), t("HM-CONN-03.removeBody"), [
      { text: t("HM-CONN-03.cancel"), style: "cancel" },
      {
        text: t("HM-CONN-03.remove"),
        style: "destructive",
        onPress: () => void (async () => {
          const r = await mcp!.remove(server.id);
          if (r.revoked === "failed") Alert.alert(t("HM-CONN-03.removedNotRevoked"));
          await load();
        })(),
      },
    ]);

  const setTool = async (serverId: string, name: string, change: { enabled?: boolean; readConfirmed?: boolean }) => {
    await mcp!.setTool(serverId, name, change);
    await load();
  };

  if (!mcp || screen.kind === "loading" || screen.kind === "checking") {
    return (
      <Page title={t("HM-CONN-03.title")}>
        <Loading text={t(screen.kind === "checking" ? "HM-CONN-03.checking" : "HM-CONN-03.loading")} />
      </Page>
    );
  }

  if (screen.kind === "error") {
    return (
      <Page title={t("HM-CONN-03.title")}>
        <Failed text={t(`HM-CONN-03.error.${screen.problem}`)} onRetry={() => void cancel(currentDraft())} />
      </Page>
    );
  }

  if (screen.kind === "sign_in") {
    return (
      <Page
        title={t("HM-CONN-03.signInTitle", { host: screen.host })}
        footer={
          <Footer>
            <Btn label={t("HM-CONN-03.signIn")} icon="log-in" style={{ flexGrow: 1 }} onPress={() => void Linking.openURL(screen.url)} />
            <Btn label={t("HM-CONN-03.cancel")} kind="text" onPress={() => void cancel(currentDraft())} />
          </Footer>
        }
      >
        <Card>
          <Field label={t("HM-CONN-03.host")} value={screen.host} mono />
          <Field label={t("HM-CONN-03.signInAt")} value={screen.signInHost} mono />
          <Field label={t("HM-CONN-03.scopes")} value={scopesText(screen.scopes)} mono />
        </Card>
        <View style={{ marginTop: s.lg }}><NoteLine icon="globe" text={t("HM-CONN-03.browserNote", { host: screen.signInHost })} textColor="text" v="body" /></View>
      </Page>
    );
  }

  if (screen.kind === "review") {
    const sc = screen;
    const toggle = (list: "enabled" | "confirmRead", name: string, on: boolean) =>
      setScreen({ ...sc, [list]: on ? [...sc[list], name] : sc[list].filter((n) => n !== name) });
    return (
      <Page
        title={t("HM-CONN-03.reviewTitle")}
        footer={
          <Footer>
            <Btn label={t("HM-CONN-03.add")} icon="plus" busy={busy} style={{ flexGrow: 1 }} onPress={() => void approve(sc)} />
            <Btn label={t("HM-CONN-03.cancel")} kind="text" onPress={() => void cancel(sc.review.draftId)} />
          </Footer>
        }
      >
        <Card>
          <Field label={t("HM-CONN-03.host")} value={sc.review.host} mono />
          {sc.review.signInHost ? <Field label={t("HM-CONN-03.signInAt")} value={sc.review.signInHost} mono /> : null}
          <Field label={t("HM-CONN-03.scopes")} value={sc.review.auth === "none" ? t("HM-CONN-03.noSignIn") : scopesText(sc.review.scopes)} mono />
        </Card>
        <View style={{ marginVertical: s.lg, paddingHorizontal: s.lg }}><NoteLine icon="shield-check" text={t("HM-CONN-03.reviewNote")} /></View>
        <Group lead="tile">
          {sc.review.tools.map((tool) => (
            <ToolRow
              key={tool.name}
              name={tool.name}
              risk={sc.confirmRead.includes(tool.name) && tool.readProposal ? "network" : tool.risk}
              destructive={tool.destructive && !(sc.confirmRead.includes(tool.name) && tool.readProposal)}
              overruled={tool.conflicts.length > 0}
              enabled={sc.enabled.includes(tool.name)}
              onEnabled={(on) => toggle("enabled", tool.name, on)}
              {...(tool.readProposal ? { readConfirmed: sc.confirmRead.includes(tool.name), onReadConfirmed: (on: boolean) => toggle("confirmRead", tool.name, on) } : {})}
            />
          ))}
        </Group>
        {sc.review.skipped.length ? <T v="small" color="soft" style={{ marginTop: s.md, paddingHorizontal: s.lg }}>{tCount("HM-CONN-03.skipped", sc.review.skipped.length)}</T> : null}
      </Page>
    );
  }

  return (
    <Page title={t("HM-CONN-03.title")} subtitle={<T v="body" color="soft">{t("HM-CONN-03.intro")}</T>}>
      <View style={{ gap: s.md }}>
        <Input
          label={t("HM-CONN-03.urlLabel")}
          value={url}
          mono
          onChange={(v) => {
            origin.current = v.length - url.length > 1 ? "pasted" : "typed";
            setUrl(v);
          }}
          field={{ placeholder: "https://", keyboardType: "url" }}
        />
        <Btn label={t("HM-CONN-03.check")} icon="search" full disabled={!url.trim()} onPress={() => void check()} />
      </View>
      {screen.servers.length === 0 ? <View style={{ marginTop: s.xl, paddingHorizontal: s.lg }}><NoteLine icon="server" text={t("HM-CONN-03.empty")} /></View> : null}
      {screen.servers.map((server) => (
        <Group key={server.id} style={{ marginTop: s.xl }}>
          {/* The host and the scopes as the server sent them: raw, in mono. */}
          <Row
            icon="server"
            title={<T v="mono" role="header" style={{ fontWeight: "600" }}>{server.host}</T>}
            sub={`${t("HM-CONN-03.scopes")}: ${server.auth === "none" ? t("HM-CONN-03.noSignIn") : scopesText(server.scopes)}`}
          />
          {server.tools.map((tool) => (
            <ToolRow
              key={tool.name}
              name={tool.name}
              risk={tool.risk}
              destructive={tool.destructive && tool.risk !== "network"}
              overruled={false}
              enabled={tool.enabled}
              changed={tool.changed}
              onEnabled={(on) => void setTool(server.id, tool.name, { enabled: on })}
              {...(tool.readProposal ? { readConfirmed: tool.readConfirmed, onReadConfirmed: (on: boolean) => void setTool(server.id, tool.name, { readConfirmed: on }) } : {})}
              {...(tool.changed ? { onReapprove: () => void mcp.reapprove(server.id, tool.name).then(load) } : {})}
            />
          ))}
          <Row icon="trash-2" iconColor="coral" title={<T v="bodyStrong" color="coral">{t("HM-CONN-03.remove")}</T>} a11y={t("HM-CONN-03.removeTitle", { host: server.host })} onPress={() => remove(server)} />
        </Group>
      ))}
    </Page>
  );
}

function reviewScreen(review: McpReview): Screen {
  // Nothing is on until the user turns it on (FR-CONN-05): a tool the user leaves off never reaches the menu.
  return { kind: "review", review, enabled: [], confirmRead: [] };
}

function ToolRow(props: {
  name: string;
  risk: string;
  destructive: boolean;
  overruled: boolean;
  enabled: boolean;
  changed?: boolean;
  onEnabled(on: boolean): void;
  readConfirmed?: boolean;
  onReadConfirmed?(on: boolean): void;
  onReapprove?(): void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: s.md, paddingVertical: s.md, paddingHorizontal: s.lg, alignItems: "flex-start" }}>
      <RiskTile risk={props.risk} destructive={props.destructive} />
      <View style={{ flex: 1, gap: s.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: s.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            {/* The tool's name as the server sent it: raw, in mono. Its risk is Hermit's reading, in words. */}
            <T v="mono">{props.name}</T>
            <T v="small" color="soft">{t(`HM-CONN-03.risk.${props.risk}`)}{props.destructive ? ` · ${t("HM-CONN-03.destructive")}` : ""}</T>
          </View>
          <Toggle on={props.enabled} disabled={props.changed} label={t("HM-CONN-03.useTool", { name: props.name })} onChange={props.onEnabled} />
        </View>
        {props.overruled ? <NoteLine icon="shield-alert" tone="coral" textColor="text" text={t("HM-CONN-03.overruled")} /> : null}
        {props.changed ? <NoteLine icon="triangle-alert" tone="coral" textColor="text" text={t("HM-CONN-03.changed")} /> : null}
        {props.onReadConfirmed ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: s.md }}>
            <T v="footnote" color="soft" style={{ flex: 1 }}>{t("HM-CONN-03.readClaim")}</T>
            <Toggle on={!!props.readConfirmed} label={t("HM-CONN-03.readClaimLabel", { name: props.name })} onChange={props.onReadConfirmed} />
          </View>
        ) : null}
        {props.onReapprove ? <Btn label={t("HM-CONN-03.reapprove")} kind="secondary" icon="refresh-cw" small onPress={props.onReapprove} /> : null}
      </View>
    </View>
  );
}
