// Preview only: stands in for apps/mobile/src/adapters/mail.ts (the phone's mail service over the network, the Keystore
// and the database). The HM-MAIL screens get the sample service from ../fake/mail; nothing reaches a provider.
import { fakeMail } from "../fake/mail";

export const mailService = () => fakeMail;
export const startMail = () => fakeMail;
export const mailTransport = { send: () => Promise.reject(new Error("preview: no network")) };
