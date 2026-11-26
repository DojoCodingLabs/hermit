/** The signature, verbatim, everywhere Hermit shows its credits (Q14). */
export const SIGNATURE = {
  line: "Hermit, built by Dojo Coding (dojocoding.io). Powered by QVAC (qvac.tether.io) from Tether (tether.io).",
  disclaimer: "Hermit is an independent project, not affiliated with or endorsed by Tether.",
} as const;

export const partners = [
  { name: "Dojo Coding", url: "https://dojocoding.io" },
  { name: "QVAC", url: "https://qvac.tether.io/" },
  { name: "Tether", url: "https://tether.io/" },
] as const;
