/**
 * The site's few glyphs, drawn here on a 24 px grid with one 1.5 px line, so they match the type and need no icon
 * library.
 */
const PATHS = {
  star: "M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z",
  arrowRight: "M4.5 12h15M13.5 6l6 6-6 6",
  arrowUpRight: "M7 17L17 7M8.5 7H17v8.5",
  fingerprint:
    "M12 11.2v3.2c0 2.2-.5 4.2-1.5 5.8M8.6 10.1a3.5 3.5 0 0 1 6.9.9v2.6c0 1.7-.3 3.3-.8 4.7M6.3 8a6 6 0 0 1 11.7 2.8v1.8M5.9 11.3c0 2.4-.4 4.4-1.2 5.8M4.2 8.3a8.4 8.4 0 0 1 15.9.6M18.4 15.6c-.1.9-.3 1.8-.6 2.6",
  check: "M5 12.6l4.4 4.4L19 7.4",
  sun: "M12 16.2a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM12 2.8v1.9M12 19.3v1.9M5.5 5.5l1.35 1.35M17.15 17.15l1.35 1.35M2.8 12h1.9M19.3 12h1.9M5.5 18.5l1.35-1.35M17.15 6.85l1.35-1.35",
  moon: "M19.6 14.6A7.9 7.9 0 0 1 9.4 4.4a7.9 7.9 0 1 0 10.2 10.2z",
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg className={className ? `glyph ${className}` : "glyph"} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
