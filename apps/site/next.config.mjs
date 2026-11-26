// A static export with no server functions. `next build` writes plain files to out/;
// scripts/finalize.mjs then removes every script tag, because no page needs JavaScript.
/** @type {import("next").NextConfig} */
const config = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  // app/global-not-found.tsx: the site has two root layouts (the language chooser and [lang]), so the 404 page
  // needs its own html; Next's default one uses inline styles that the content security policy refuses.
  experimental: { globalNotFound: true },
};

export default config;
