// HM-APPR-01: the approval sheet, and HM-APPR-02 for a payment (SL-40). Renders only describeAction output, the
// payment hold's lines (CT-06) and, under "You said", the user's own words of the turn (Q149); approving asks for the
// fingerprint. Polish round (docs/design/polish/decisions.md): a payment leads with a large tabular amount, then who
// it goes to as a row with an initial, the network and fee as quiet rows, what the daily cap leaves as a slim meter,
// and the user's words as a quote; the actions stay pinned with one short line of what the fingerprint does, and the
// trust line opens the long explanation in an info sheet.
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { formatMoney, type ApprovalRequest, type Money } from "@hermit/core";
import { showApprovals } from "@hermit/runtime";
import { useRouter } from "expo-router";
import { ApprovalSignError, authenticate, deviceFacts } from "../adapters";
import { useAppLock } from "../app-lock";
import { haptic } from "../haptics";
import { quoted, splitAmount } from "../format";
import { useHermit } from "../hermit-context";
import { currentLocale, t } from "../i18n";
import { capsAmount } from "../pay-view";
import { capMoney } from "../wallet-view";
import { radius, s } from "../theme";
import { usePalette } from "../use-palette";
import { approveWords, lineLabel, lineValue, payFacts, saidQuote, sheetFoot, sheetRecipient, sheetTitle, sheetWords, taintLine } from "../approval-view";
import { Icon } from "./Icon";
import { Avatar, Btn, Meter, Note, T, Tile, WholeAddress } from "./kit";
import { CrossFade, easeLayout, useMotion } from "./motion";
import { InfoSheet, NeedsOk, SheetModal, SignedFoot } from "./Sheet";

export function ApprovalSheet() {
  const { approvals, status } = useHermit();
  const { lock } = useAppLock();
  const p = usePalette();
  const motion = useMotion();
  const [req, setReq] = useState<ApprovalRequest | undefined>(approvals.current());
  const [busy, setBusy] = useState(false);
  const [keyLost, setKeyLost] = useState<string>();
  const [details, setDetails] = useState(false);
  const [saidOpen, setSaidOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const router = useRouter();
  useEffect(() => approvals.subscribe(setReq), [approvals]);
  // A new request starts with its details, the full quote and the explanation closed.
  useEffect(() => {
    setDetails(false);
    setSaidOpen(false);
    setInfo(false);
  }, [req?.id]);
  // EC-APPR-03: every W1 sheet is for an action that leaves the phone; say so before the fingerprint when
  // there is no network, so an approval never ends in a silent "not sent".
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!req) return;
    let live = true;
    void deviceFacts().then((f) => live && setOffline(f.network === "none")).catch(() => {});
    return () => {
      live = false;
    };
  }, [req]);
  // The daily cap in force, from the payments service, only to draw the meter beside the hold's own "left today".
  const payments = status.kind === "ready" ? status.hermit.payments : undefined;
  const [perDay, setPerDay] = useState<Money>();
  const paying = req?.call.skill === "pay" || req?.call.skill === "pay_merchant";
  useEffect(() => {
    if (!paying || !payments) return;
    let live = true;
    void payments.caps().then((c) => live && setPerDay(c.caps.perDay), () => {});
    return () => {
      live = false;
    };
  }, [paying, payments]);
  // US-SET-09: while the app is locked the sheet is hidden, not denied; it shows again after the unlock.
  if (!req || !showApprovals(lock)) return null;
  // A fetch (read_web) opens a page and a search (search_web) sends only its words: neither sends a message.
  const fetch = req.call.skill === "read_web";
  const search = req.call.skill === "search_web";
  // SL-56b: a one-time code for a web task's sign-in, with the exact origin and where it came from to compare.
  const code = req.call.skill === "web_code";
  const login = req.call.skill === "fill_login";
  const taint = taintLine(req);
  // The title, deny, signed note and notes by skill (approval-view.ts): a payment (SL-40) and an x402 purchase (SL-41)
  // are HM-APPR-02; a password sign-in (fill_login) has its own, never the payment note or "Don't send".
  const words = sheetWords(req.call.skill);
  const denyKey = words.deny;
  // HM-APPR-02's headline facts, from a pay skill's flagged lines only (never another skill's, never a tool's).
  const pay = payFacts(req.call.skill, req.summary.lines);
  const who = pay ? sheetRecipient(pay) : undefined;
  const title = sheetTitle(req.call.skill, pay);
  const verb = approveWords(req.call.skill, pay);
  // Q149: the user's own words of this turn, only from the request's `said` (set by the loop from the turn's input).
  const quote = saidQuote(req);

  const approve = async () => {
    setBusy(true);
    try {
      // The fingerprint prompt says the sheet's own question in the user's language, never the skill's English title.
      const result = await authenticate(req, t(title.key, title.vars));
      approvals.approve(req.id, result);
      haptic("confirm");
    } catch (e) {
      // SL-37: the approval key was retired by a fingerprint change: say so here, with the way to set it up again.
      if (e instanceof ApprovalSignError && e.code === "lost") setKeyLost(req.id);
      else approvals.deny(req.id); // a failed or cancelled fingerprint is a no
    } finally {
      setBusy(false);
    }
  };
  const setUpAgain = () => {
    approvals.deny(req.id);
    router.push("/approval-key");
  };
  const toggle = (set: (f: (o: boolean) => boolean) => void) => () => {
    easeLayout(motion);
    set((o) => !o);
  };

  // Every line, labelled by lineLabel alone: Hermit's own labelKeys in the user's language, payment words only on the
  // pay skills' sheets, a connector's or MCP tool's field marked as the tool's own. Never chosen from the label's text.
  const line = (l: ApprovalRequest["summary"]["lines"][number], i: number) => {
    const named = lineLabel(req.call.skill, l);
    const label = "key" in named ? t(named.key, named.vars) : named.text;
    // A fixed value Hermit wrote in the user's language; everything else exactly as it is (lineValue, never its text).
    const shown = lineValue(req.call.skill, l);
    const value = "key" in shown ? t(shown.key) : shown.text;
    const flagged = l.flag === "new_recipient";
    // Hermit's own message skill: the message as it will leave, drawn like the user's bubble (A9).
    const message = req.call.skill === "reply_message" && (l.labelKey === "message" || l.labelKey === "text");
    return (
      <View key={`${i}-${l.label}`} style={{ gap: 2, paddingVertical: s.md }} accessible accessibilityLabel={`${label}: ${value}`}>
        <T v="footnote" color={flagged ? "coral" : "soft"}>{label}</T>
        {message ? (
          <View style={{ alignSelf: "flex-start", maxWidth: "100%", backgroundColor: p.userBubble, borderRadius: radius.bubble, borderBottomRightRadius: 6, paddingHorizontal: s.lg, paddingVertical: s.md, marginTop: s.xs }}>
            <T v="body" color="userText" selectable>{value}</T>
          </View>
        ) : (
          // A code is never selectable: copying it would put it on the clipboard.
          <T v={/^0x[0-9a-fA-F]{40}$/.test(value) ? "mono" : "body"} selectable={!code}>{value}</T>
        )}
        {flagged ? <T v="small" color="coral">{t("HM-APPR-01.newRecipient")}</T> : null}
      </View>
    );
  };
  const lines = req.summary.lines.map(line);

  // The pinned actions: what the fingerprint does in one short line, the verb, the way out, and the trust line.
  const actions = (
    <>
      {keyLost === req.id ? (
        <View style={{ gap: s.xs }}>
          <T v="small" color="coral" live="polite">{t("HM-APPR-01.signed.approval_key_lost")}</T>
          <Btn label={t("HM-APPR-01.signed.setUp")} kind="text" onPress={setUpAgain} />
        </View>
      ) : req.signed || words.notes.length ? (
        // SL-37: the phone's own prompt shows the amount and recipient again, read from what it signs.
        <View style={{ paddingBottom: s.sm }}>
          <Note icon="fingerprint" tone="mark" v="footnote" text={[req.signed ? t(words.signedNote) : "", ...words.notes.map((k) => t(k))].filter(Boolean).join(" ")} />
        </View>
      ) : null}
      <Btn
        label={t(verb.label.key, verb.label.vars)}
        a11y={t(verb.spoken.key, verb.spoken.vars)}
        icon="fingerprint"
        full
        busy={busy}
        disabled={keyLost === req.id}
        onPress={() => void approve()}
      />
      <Btn label={t(denyKey)} kind="text" full onPress={() => {
        haptic("reject");
        approvals.deny(req.id);
      }} />
      <SignedFoot text={t(sheetFoot(req.call.skill, !!req.signed))} onInfo={() => setInfo(true)} infoLabel={t("HM-APPR-01.info.open")} />
    </>
  );

  return (
    <SheetModal onClose={() => approvals.deny(req.id)} footer={actions}>
      {/* PDR-013: TalkBack reads the title, any warning, then each field in order, and only then the approve button. */}
      {/* Every sheet opens the same way, centered, three things at most: the mark (the crab and "Needs
          your OK" on one line), the question, and for a payment the amount. The fields under it read left to right. */}
      <View style={{ alignItems: "center", paddingTop: s.xs }}>
        <NeedsOk label={t("HM-APPR-01.needsOk")} center />
        <T v="title" role="header" center>{t(title.key, title.vars)}</T>
        {pay?.amount ? <AmountHero amount={pay.amount} /> : null}
      </View>

      {pay ? (
        <View style={{ marginTop: s.xl }}>
          <View style={{ borderRadius: radius.card, backgroundColor: p.dark ? p.sunken : p.canvas, paddingHorizontal: s.lg }}>
            {/* Address poisoning: an address with no saved name is shown whole (mono, in groups of four for checking,
                never cut); a typed one also says to check every character. Only a saved payee's name may sit over a cut
                address. */}
            {who ? (
              who.whole ? (
                <SheetRow first label={t("HM-APPR-02.to")} a11y={`${t("HM-APPR-02.to")}: ${who.address ?? ""}${pay.typed ? `. ${pay.typed}` : ""}`}>
                  <WholeAddress address={who.address ?? ""} v="mono" color="text" />
                  {pay.typed ? <View style={{ marginTop: s.sm }}><Note icon="triangle-alert" tone="amber" text={pay.typed} textColor="text" v="small" /></View> : null}
                </SheetRow>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: s.md, minHeight: 68, paddingVertical: s.md }} accessible accessibilityLabel={`${t("HM-APPR-02.payee")}: ${who.name ?? ""}${pay.to ? `, ${pay.to}` : ""}`}>
                  <Avatar name={who.name ?? ""} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="bodyStrong">{who.name}</T>
                    <T v="small" color="soft">{who.address ? `${t("HM-APPR-02.payee")} · ${who.address}` : t("HM-APPR-02.payee")}</T>
                  </View>
                </View>
              )
            ) : null}
            {/* SL-41: which site asks and how long it can collect stay in view, not only in the details. */}
            {req.summary.lines.map((l, i) => (l.flag === "pay_site" || l.flag === "pay_valid" ? <Hairline key={`h${i}`}>{line(l, i)}</Hairline> : null))}
            {pay.network ? <ValueRow label={t("HM-APPR-02.network")} value={pay.network} /> : null}
            {pay.fee ? <ValueRow label={t("HM-APPR-02.fee")} value={pay.fee} /> : null}
          </View>
          {pay.capLeft ? <CapMeter left={pay.capLeft} perDay={perDay} /> : null}
        </View>
      ) : null}

      {quote ? (
        // Q149: why it is asked, in the user's own words, in curly quotes; a long message opens on a tap.
        <View style={{ marginTop: s.xl, gap: s.xs }} accessible accessibilityLabel={`${t("HM-APPR-01.said")}: ${quote.full}`}>
          <T v="footnoteStrong" color="soft">{t("HM-APPR-01.said")}</T>
          <T v="quote">{quoted(saidOpen ? quote.full : quote.short)}</T>
        </View>
      ) : null}
      {quote?.cut ? (
        <Pressable onPress={toggle(setSaidOpen)} accessibilityRole="button" accessibilityLabel={t(saidOpen ? "HM-APPR-01.saidLess" : "HM-APPR-01.saidMore")} accessibilityState={{ expanded: saidOpen }} style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
          <T v="smallStrong" color="link">{t(saidOpen ? "HM-APPR-01.saidLess" : "HM-APPR-01.saidMore")}</T>
        </Pressable>
      ) : null}
      {taint ? (
        // When the session is tainted, the warning sits right under what was asked.
        <View style={{ marginTop: s.md }}><Note icon="shield-alert" tone="amber" text={t(taint.key, taint.vars)} textColor="amber" v="smallStrong" /></View>
      ) : null}

      {offline || req.summary.lines.some((l) => l.flag === "from_contacts" || l.flag === "emailed_before") ? (
        <View style={{ marginTop: s.md, gap: s.sm }}>
          {offline ? (
            <T v="small" color="soft" live="polite">{t(search ? "HM-APPR-01.offlineSearch" : fetch ? "HM-APPR-01.offlineFetch" : "HM-APPR-01.offline")}</T>
          ) : null}
          {req.summary.lines.some((l) => l.flag === "from_contacts" || l.flag === "emailed_before") ? (
            // PDR-028: a person found by name; the user checks it's the right one.
            <Note icon="contact" text={t("HM-APPR-01.foundByName")} textColor="text" />
          ) : null}
        </View>
      ) : null}

      {pay ? null : (
        // Everything but a payment shows its lines up front (a payment keeps them behind Show details, A2).
        <View style={{ marginTop: s.md }}>
          {login ? (
            // Where the login comes from, as one quiet line beside its tile (it was a chip: a label, not a control).
            <View style={{ flexDirection: "row", alignItems: "center", gap: s.md, paddingVertical: s.sm }}>
              <Tile icon="key-round" />
              <T v="footnoteStrong" color="soft" style={{ flex: 1 }}>{t("HM-APPR-01.login.source")}</T>
            </View>
          ) : null}
          {lines.map((l, i) => <Hairline key={i} first={i === 0 && !login}>{l}</Hairline>)}
          {login ? <View style={{ paddingVertical: s.sm }}><Note icon="eye" text={t("HM-APPR-01.login.passwordNever")} /></View> : null}
        </View>
      )}

      {search ? <View style={{ marginTop: s.md }}><Note icon="info" text={t("HM-APPR-01.searchNote")} /></View> : null}
      {req.call.skill === "reply_message" ? <View style={{ marginTop: s.md }}><Note icon="info" text={t("HM-APPR-01.whatsappSends")} /></View> : null}

      {/* A2: the rest behind a toggle, closed by default: a payment's every line, and the action's hash. */}
      <View style={{ marginTop: s.md }}>
        <Pressable onPress={toggle(setDetails)} accessibilityRole="button" accessibilityLabel={t(details ? "HM-APPR-01.detailsHide" : "HM-APPR-01.detailsShow")} accessibilityState={{ expanded: details }} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: s.xs, minHeight: 48, alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
          <CrossFade id={details ? "open" : "shut"}>
            {(state) => <Icon name={state === "open" ? "chevron-up" : "chevron-down"} size={20} color={p.accent} />}
          </CrossFade>
          <T v="smallStrong" color="link">{t(details ? "HM-APPR-01.detailsHide" : "HM-APPR-01.detailsShow")}</T>
        </Pressable>
        {details ? (
          <View style={{ borderRadius: radius.field, backgroundColor: p.sunken, paddingHorizontal: s.md }}>
            {pay ? lines.map((l, i) => <Hairline key={i} first={i === 0}>{l}</Hairline>) : null}
            <Hairline first={!pay}>
              <View style={{ gap: 2, paddingVertical: s.md }} accessible accessibilityLabel={`${t("HM-APPR-01.argsHash")}: ${req.call.argsHash}`}>
                <T v="footnote" color="soft">{t("HM-APPR-01.argsHash")}</T>
                <T v="monoSmall" selectable>{req.call.argsHash}</T>
              </View>
            </Hairline>
          </View>
        ) : null}
      </View>

      <InfoSheet
        visible={info}
        onClose={() => setInfo(false)}
        title={t(pay ? "HM-APPR-02.info.title" : "HM-APPR-01.info.title")}
        // A signed sheet's long story (the chip, the key, the fingerprint screen) lives here; its note stays one line.
        paragraphs={(pay ? ["HM-APPR-02.info.signs", "HM-APPR-02.info.repeats", "HM-APPR-02.info.second", "HM-APPR-01.info.drawn"] : ["HM-APPR-01.info.drawn", ...(req.signed ? ["HM-APPR-01.info.signed"] : []), "HM-APPR-01.info.fingerprint"]).map((k) => t(k))}
      />
    </SheetModal>
  );
}

/** The amount, large: the figures in Newsreader with tabular digits, the unit beside them in the interface face. */
function AmountHero({ amount }: { amount: string }) {
  const { figures, unit } = splitAmount(amount);
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "center", flexWrap: "wrap", columnGap: s.sm }} accessible accessibilityLabel={amount}>
      <T v="amount">{figures}</T>
      {unit ? <T v="lead" color="soft">{unit}</T> : null}
    </View>
  );
}

/** A hairline above everything but the first row. */
function Hairline({ children, first }: { children: ReactNode; first?: boolean }) {
  const p = usePalette();
  return (
    <View>
      {first ? null : <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.hairline }} />}
      {children}
    </View>
  );
}

/** A label and its value on one line (network, fee): quiet, secondary to the amount and the person. */
function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <Hairline>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: s.sm, minHeight: 48, paddingVertical: s.sm }} accessible accessibilityLabel={`${label}: ${value}`}>
        <T v="small" color="soft">{label}</T>
        <T v="smallStrong" tabular>{value}</T>
      </View>
    </Hairline>
  );
}

/** A labelled block in the rows (a typed address, a site's line). */
function SheetRow({ label, a11y, children, first }: { label: string; a11y: string; children: ReactNode; first?: boolean }) {
  return (
    <Hairline first={first}>
      <View style={{ gap: 2, paddingVertical: s.md }} accessible accessibilityLabel={a11y}>
        <T v="footnote" color="soft">{label}</T>
        {children}
      </View>
    </Hairline>
  );
}

/**
 * A7: what the daily cap leaves after this payment, from the hold's own line, as numbers; and, when the cap in force
 * is known, "of 50 USD₮" and a slim meter of what the day has used. The meter is decorative: the numbers say it.
 */
function CapMeter({ left, perDay }: { left: string; perDay?: Money }) {
  const leftUnits = capsAmount(splitAmount(left).figures);
  const known = perDay && leftUnits !== undefined && perDay.amount > 0n && leftUnits <= perDay.amount;
  const value = known ? t("HM-APPR-02.capOf", { left: splitAmount(left).figures, cap: capMoney(perDay, currentLocale(), formatMoney) }) : left;
  return (
    <View style={{ marginTop: s.lg, gap: s.sm }} accessible accessibilityLabel={`${t("HM-APPR-02.capLeft")}: ${value}`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: s.sm }}>
        <T v="small" color="soft">{t("HM-APPR-02.capLeft")}</T>
        <T v="smallStrong" tabular>{value}</T>
      </View>
      {known ? <Meter used={Number(perDay.amount - leftUnits)} cap={Number(perDay.amount)} /> : null}
    </View>
  );
}
