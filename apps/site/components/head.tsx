import { CSP_META } from "../lib/csp.mjs";
import { THEME_HEAD_SCRIPT, THEME_TOGGLE_SCRIPT } from "../lib/theme.mjs";

/**
 * The policy, the theme (set before the first paint, so no flash of the wrong one), self-hosted fonts (the two the
 * first screen uses are preloaded), the favicon and the browser colors. Next adds the title, description, canonical
 * URL, hreflang alternates and Open Graph tags from each page's metadata (lib/meta.ts).
 */
export function Head() {
  return (
    <head>
      <meta httpEquiv="Content-Security-Policy" content={CSP_META} />
      <script dangerouslySetInnerHTML={{ __html: THEME_HEAD_SCRIPT }} />
      <meta name="referrer" content="no-referrer" />
      <meta name="theme-color" content="#F5EDE1" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#06121D" media="(prefers-color-scheme: dark)" />
      <link rel="preload" href="/brand/fonts/Newsreader-normal-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/brand/fonts/InstrumentSans-normal-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="stylesheet" href="/brand/fonts/fonts.css" />
      <link rel="icon" href="/brand/logo/favicon.svg" type="image/svg+xml" />
      <link rel="icon" href="/brand/logo/png/favicon-32.png" type="image/png" sizes="64x56" />
      <link rel="apple-touch-icon" href="/brand/icons/app-icon-light.png" />
    </head>
  );
}

/** The switch's script, at the end of <body> on every page that has the switch. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_TOGGLE_SCRIPT }} />;
}
