// HM-SET-02, US-MSG-07 (ASM-13): why Hermit never sees one-time codes, so a missing code doesn't look like a bug.
// A section for the privacy screen; SL-25 (PR #52) owns that screen, so it mounts this where it lists its promises.
// Polish round: a section label and its paragraph on the rows' text column, in the kit's type.
import { View } from "react-native";
import { t } from "../i18n";
import { s } from "../theme";
import { Label, T } from "./kit";

export function OneTimeCodesNote() {
  return (
    <View>
      <Label>{t("HM-SET-02.oneTimeCodes")}</Label>
      <T v="small" color="soft" style={{ paddingHorizontal: s.lg }}>{t("HM-SET-02.oneTimeCodesBody")}</T>
    </View>
  );
}
