// HM-MAIL-03: the results of the last email search (US-MAIL-03), linked from the chat's answer; each opens the message
// view (app/mail-message.tsx). See MailShown.
import { MailShown } from "../components/MailShown";

export default function MailSearch() {
  return <MailShown screen="HM-MAIL-03" />;
}
