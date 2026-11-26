// The strict content security policy. Nothing loads from elsewhere, and the only scripts that run are the two inline
// theme scripts (lib/theme.mjs), each allowed by its exact SHA-256: no 'unsafe-inline', no script files. Styles, fonts
// and images come only from the site itself. vercel.json sends it as a header (with frame-ancestors, which only works
// as a header); every page also carries it in a <meta> tag for hosts without header config. test/vercel.test.ts keeps
// the two in step, and test/theme.test.ts proves the hashes are the scripts' own.

/** SHA-256 of THEME_HEAD_SCRIPT and THEME_TOGGLE_SCRIPT, in that order. */
export const SCRIPT_HASHES = [
  "sha256-eLVUH4hQY3+6G8GCW/q25MbNnMzGbk+pKITNyotAWGw=",
  "sha256-kf3zqnqztUctqKx6900vu7eZLh1jZxUCaEMYBxbz4tU=",
];

export const CSP_META = [
  "default-src 'none'",
  `script-src ${SCRIPT_HASHES.map((h) => `'${h}'`).join(" ")}`,
  "img-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "upgrade-insecure-requests",
].join("; ");

export const CSP_HEADER = `${CSP_META}; frame-ancestors 'none'`;
