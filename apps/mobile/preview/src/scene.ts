// Preview only: what to render, read once from the page URL (?screen=wallet&theme=dark&lang=en&variant=payment).
const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);

export const scene = {
  screen: q.get("screen") ?? "index",
  theme: (q.get("theme") === "dark" ? "dark" : "light") as "light" | "dark",
  lang: (q.get("lang") === "en" ? "en" : "es-419") as "en" | "es-419",
  /** A named state of the screen (an approval kind, an empty list), when one screen has several shots. */
  variant: q.get("variant") ?? "",
  /** Route params the screen reads with useLocalSearchParams, as JSON. */
  params: JSON.parse(q.get("params") ?? "{}") as Record<string, string>,
  /** The phone's font size as a factor (Android's "font size" setting): 2 renders text at 200%. */
  fontScale: Number(q.get("fontScale") ?? "1") || 1,
};
