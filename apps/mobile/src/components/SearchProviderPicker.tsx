// HM-SET-02, US-WEB-03 (FR-WEB-04, Q58): where search_web sends the query. DuckDuckGo until the user picks (no key, no
// account), the user's own SearXNG at a public https address, or off. The value is the `search.provider` setting,
// written only through @hermit/core's searchSetting, so the screen can't save an address the runtime would refuse.
// Polish round: the kit's radio rows in one grouped list (TalkBack reads each as a radio, checked or not), and the
// SearXNG address as the kit's field with Save beside its result.
import { useState } from "react";
import { View } from "react-native";
import { searchSetting, type SearchChoice } from "@hermit/core";
import { t } from "../i18n";
import { s } from "../theme";
import { ChoiceList } from "./ChoiceList";
import { Btn, Input, Note } from "./kit";

type Id = SearchChoice["id"];
const OPTIONS: ReadonlyArray<{ id: Id; name: string; note: string }> = [
  { id: "duckduckgo", name: "HM-SET-02.searchDuckduckgo", note: "HM-SET-02.searchDuckduckgoNote" },
  { id: "searxng", name: "HM-SET-02.searchSearxng", note: "HM-SET-02.searchSearxngNote" },
  { id: "off", name: "HM-SET-02.searchOff", note: "HM-SET-02.searchOffNote" },
];

export function SearchProviderPicker(props: { choice: SearchChoice; save(value: string): Promise<void> }) {
  const saved = props.choice;
  // SearXNG needs an address before it can be saved, so picking it only opens the field.
  const [picked, setPicked] = useState<Id>(saved.id);
  const [address, setAddress] = useState(saved.id === "searxng" ? saved.address : "");
  const [note, setNote] = useState<"HM-SET-02.searchSearxngInvalid" | "HM-SET-02.searchSaveError">();
  const [busy, setBusy] = useState(false);

  const save = async (choice: SearchChoice) => {
    const value = searchSetting(choice);
    if (!value) return setNote("HM-SET-02.searchSearxngInvalid");
    setBusy(true);
    setNote(undefined);
    try {
      await props.save(value);
    } catch {
      setNote("HM-SET-02.searchSaveError");
    } finally {
      setBusy(false);
    }
  };

  const pick = (id: Id) => {
    if (busy || id === picked) return;
    setPicked(id);
    setNote(undefined);
    if (id !== "searxng") void save({ id } as SearchChoice);
  };

  return (
    <View style={{ gap: s.md }}>
      <ChoiceList<Id> choices={OPTIONS.map((o) => ({ value: o.id, label: t(o.name), detail: t(o.note) }))} selected={picked} disabled={busy} onChoose={pick} />
      {picked === "searxng" ? (
        <View style={{ gap: s.sm }}>
          <Input
            label={t("HM-SET-02.searchSearxngLabel")}
            value={address}
            mono
            onChange={(v) => (setAddress(v), setNote(undefined))}
            field={{ placeholder: t("HM-SET-02.searchSearxngPlaceholder"), keyboardType: "url", inputMode: "url", editable: !busy }}
          />
          <Btn label={t("HM-SET-02.searchSearxngSave")} kind="secondary" small busy={busy} disabled={!address.trim()} onPress={() => void save({ id: "searxng", address })} />
        </View>
      ) : null}
      {note ? <View accessibilityRole="alert" style={{ paddingHorizontal: s.lg }}><Note icon="circle-alert" tone="coral" textColor="text" text={t(note)} /></View> : null}
    </View>
  );
}
