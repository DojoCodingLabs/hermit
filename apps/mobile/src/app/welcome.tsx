// HM-ONB-01: the promise, before any permission or download (US-ONB-01). No network, nothing stored but "seen".
// Polish round: the crab says hello on its stage, the headline, the three promises as one short list, and the brand's
// honest exceptions one tap away in an info sheet (each is also said where it applies: the download, the WhatsApp
// sheet, the calendar permission).
import { router } from "expo-router";
import { useState } from "react";
import { Btn, Group, LinkText, Row, T } from "../components/kit";
import { Onb } from "../components/Onboarding";
import { InfoSheet } from "../components/Sheet";
import { t } from "../i18n";

export default function Welcome() {
  const [info, setInfo] = useState(false);
  const promise = (key: string) => <T v="body">{t(key)}</T>;
  return (
    <Onb pose="hello" title={t("HM-ONB-01.title")} footer={<Btn label={t("HM-ONB-01.start")} full onPress={() => router.push("/language")} />}>
      <Group>
        <Row icon="smartphone" title={promise("HM-ONB-01.promisePrivate")} />
        <Row icon="plane" title={promise("HM-ONB-01.promiseOffline")} />
        <Row icon="fingerprint" title={promise("HM-ONB-01.promiseApprove")} />
      </Group>
      <LinkText label={t("HM-ONB-01.exceptionsLink")} icon="info" center onPress={() => setInfo(true)} />
      <InfoSheet
        visible={info}
        onClose={() => setInfo(false)}
        title={t("HM-ONB-01.exceptionsLink")}
        paragraphs={[t("HM-ONB-01.exceptionsTitle"), t("HM-ONB-01.exceptionModel"), t("HM-ONB-01.exceptionWhatsapp"), t("HM-ONB-01.exceptionCalendar")]}
      />
    </Onb>
  );
}
