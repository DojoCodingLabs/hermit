import { defaultRules, type PolicyRule } from "@hermit/cage";
import type { NightJobId } from "./settings.ts";

/**
 * The reads a job may make at night beyond the rules' own `read` allowance. Mail reads are `network` and ask
 * by day; the user switching the email job on (HM-NIGHT-01) is the standing permission for exactly this one
 * read: unread mail, in an unattended session. Searching or opening a message is never granted.
 */
const GRANTED_READS: Partial<Record<NightJobId, readonly string[]>> = { mail: ["mail_list"] };

/**
 * Q67: what a granted read may ask for, checked by the cage rule itself and not only by the night job's code. The
 * email job's permission is a list of unread mail; a list of read mail (`unreadOnly: false`) is not part of it.
 */
const GRANTED_ARGS: Readonly<Record<string, (args: Record<string, unknown>) => boolean>> = {
  mail_list: (a) => a.unreadOnly === undefined || a.unreadOnly === true,
};

/**
 * The night shift's rules (US-CAGE-02): the day's rules, plus the reads its enabled jobs need, only while
 * unattended. Nothing here can allow a send, a remote write, a payment or a password: the cage's hard limits
 * still apply, and an unattended session turns every ask into a deny.
 */
export function nightRules(jobs: readonly NightJobId[]): PolicyRule[] {
  const granted = new Set(jobs.flatMap((j) => GRANTED_READS[j] ?? []));
  const isGranted = (c: { skill: string; args: Record<string, unknown> }, unattended: boolean) =>
    unattended && granted.has(c.skill) && (Object.hasOwn(GRANTED_ARGS, c.skill) ? GRANTED_ARGS[c.skill]!(c.args) : true);
  const base = defaultRules().map((r): PolicyRule => {
    if (r.id !== "network-asks") return r;
    const when = r.when;
    return { ...r, when: (c, s) => (when ? when(c, s) : true) && !isGranted(c, s.unattended) };
  });
  return [
    ...base,
    { id: "night-granted-read", skill: "*", risk: "network", when: (c, s) => isGranted(c, s.unattended), effect: "allow" },
  ];
}
