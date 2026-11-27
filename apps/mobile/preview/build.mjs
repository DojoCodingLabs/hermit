// Dev-only: bundles the real apps/mobile screens for a browser. react-native resolves to react-native-web; native
// modules, adapters and the runtime's ports resolve to the stubs in src/stubs (CONTRIBUTING.md, Screenshots for a UI change).
import { build } from "esbuild";
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const mobile = resolve(here, "..");
const repo = resolve(mobile, "../..");
const stubs = join(here, "src/stubs");
const nm = join(here, "node_modules");
// One React for the bundle: the preview's own, even when apps/mobile has its node_modules installed.
const previewRequire = createRequire(join(here, "package.json"));

/** Bare specifiers the screens import, to their preview stand-in. */
const bare = {
  "react-native": join(stubs, "react-native.ts"),
  "expo-router": join(stubs, "expo-router.tsx"),
  "react-native-safe-area-context": join(stubs, "safe-area.tsx"),
  expo: join(stubs, "expo.ts"),
  "expo-status-bar": join(stubs, "expo.ts"),
  "expo-linking": join(stubs, "expo.ts"),
  "expo-crypto": join(stubs, "expo.ts"),
  "react-native-svg": join(stubs, "svg.tsx"),
};

/** @hermit/<pkg>[/<sub>] to the package's TypeScript source, through its package.json exports. */
function hermitPackage(spec) {
  const [, pkg, sub] = spec.match(/^@hermit\/([^/]+)(?:\/(.+))?$/);
  const dir = join(repo, "packages", pkg);
  const exp = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).exports;
  if (!sub) return join(dir, exp["."]);
  if (exp[`./${sub}`]) return join(dir, exp[`./${sub}`]);
  const star = Object.keys(exp).find((k) => k.endsWith("/*") && sub.startsWith(k.slice(2, -1)));
  if (star) return join(dir, exp[star].replace("*", sub.slice(star.length - 3)));
  throw new Error(`no export ${spec}`);
}

const previewAliases = {
  name: "hermit-preview-aliases",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const p = args.path;
      if (args.kind === "entry-point") return;
      if (bare[p]) return { path: bare[p] };
      if (/^react(-dom)?(\/|$)/.test(p)) return { path: previewRequire.resolve(p) };
      if (p.startsWith("@hermit/")) return { path: hermitPackage(p) };
      if (p.startsWith(".")) {
        const abs = resolve(args.resolveDir, p);
        // Inside the app: adapters, native modules and the runtime context are swapped; everything else is real.
        // The mail adapter and the sign-in return have their own stand-ins (SL-48, SL-49).
        if (abs === join(mobile, "src/adapters/mail") || abs === join(mobile, "src/adapters/mail.ts")) return { path: join(stubs, "mail.ts") };
        if (abs === join(mobile, "src/oauth-flow") || abs === join(mobile, "src/oauth-flow.ts")) return { path: join(stubs, "oauth-flow.ts") };
        if (abs.startsWith(join(mobile, "src/adapters"))) return { path: join(stubs, "adapters.ts") };
        if (abs.startsWith(join(mobile, "modules"))) return { path: join(stubs, "native-modules.tsx") };
        if (abs === join(mobile, "src/hermit-context") || abs === join(mobile, "src/hermit-context.tsx")) return { path: join(stubs, "hermit-context.tsx") };
        return;
      }
      if (p.startsWith("node:")) return { path: p, namespace: "empty" };
      // Everything else (react, react-dom, react-native-web, @noble/*) comes from the preview's own node_modules.
      return;
    });
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export default {};", loader: "js" }));
  },
};

const out = join(here, "dist");
mkdirSync(out, { recursive: true });

// The brand faces, from the same expo-font entry in app.json the phone embeds them with: one @font-face per file, so
// the screens' fontFamily and fontWeight pick the same face here as on Android.
const appJson = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8"));
const fontPlugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-font");
mkdirSync(join(out, "fonts"), { recursive: true });
const fontFaces = (fontPlugin?.[1]?.android?.fonts ?? []).flatMap((family) =>
  family.fontDefinitions.map((d) => {
    const file = basename(d.path);
    copyFileSync(join(mobile, d.path), join(out, "fonts", file));
    return `@font-face{font-family:"${family.fontFamily}";src:url(fonts/${file}) format("truetype");font-weight:${d.weight};font-style:${d.style ?? "normal"};font-display:block}`;
  }),
);
await build({
  entryPoints: [join(here, "src/main.tsx")],
  bundle: true,
  outfile: join(out, "app.js"),
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  nodePaths: [nm],
  resolveExtensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".web.js", ".js", ".mjs", ".json"],
  loader: { ".png": "file", ".jpg": "file", ".ttf": "file" },
  assetNames: "assets/[name]-[hash]",
  define: { __DEV__: "true", "process.env.NODE_ENV": '"development"', "process.env.EXPO_OS": '"android"', global: "globalThis" },
  plugins: [previewAliases],
  logLevel: "warning",
  sourcemap: "inline",
});
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fontFaces.join("")}html,body,#root{height:100%;margin:0}body{overflow:hidden}#root{display:flex}*:focus,*:focus-visible{outline:none!important}[role="heading"]{text-wrap:balance}</style></head>
<body><div id="root"></div><script type="module" src="./app.js"></script></body></html>`,
);
console.log(existsSync(join(out, "app.js")) ? "built dist/app.js" : "build failed");
