// Dev-only: bundles the mascot test page (main.tsx) for a browser, like ../build.mjs does for the screens: the real
// app code, with react-native resolved to react-native-web. Its own stubs (react-native.ts, hermit-context.tsx) let
// the URL turn on reduced motion and Quiet mode. Output: ../dist/mascot (gitignored). Usage: node mascot/build.mjs
import { build } from "esbuild";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const preview = resolve(here, "..");
const mobile = resolve(preview, "..");
const repo = resolve(mobile, "../..");
const stubs = join(preview, "src/stubs");
const nm = join(preview, "node_modules");
const previewRequire = createRequire(join(preview, "package.json"));

const bare = {
  "react-native": join(here, "react-native.ts"),
  "react-native-svg": join(stubs, "svg.tsx"),
  "react-native-safe-area-context": join(stubs, "safe-area.tsx"),
  "expo-router": join(stubs, "expo-router.tsx"),
  expo: join(stubs, "expo.ts"),
};

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

const aliases = {
  name: "hermit-mascot-aliases",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const p = args.path;
      if (args.kind === "entry-point") return;
      if (bare[p]) return { path: bare[p] };
      if (/^react(-dom)?(\/|$)/.test(p)) return { path: previewRequire.resolve(p) };
      if (p.startsWith("@hermit/")) return { path: hermitPackage(p) };
      if (p.startsWith(".")) {
        const abs = resolve(args.resolveDir, p);
        if (abs.startsWith(join(mobile, "src/adapters"))) return { path: join(stubs, "adapters.ts") };
        if (abs.startsWith(join(mobile, "modules"))) return { path: join(stubs, "native-modules.tsx") };
        if (abs === join(mobile, "src/hermit-context") || abs === join(mobile, "src/hermit-context.tsx")) return { path: join(here, "hermit-context.tsx") };
        return;
      }
      if (p.startsWith("node:")) return { path: p, namespace: "empty" };
      return;
    });
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export default {};", loader: "js" }));
  },
};

const out = join(preview, "dist/mascot");
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(here, "main.tsx")],
  bundle: true,
  outfile: join(out, "app.js"),
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  nodePaths: [nm],
  resolveExtensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".web.js", ".js", ".mjs", ".json"],
  loader: { ".png": "file", ".ttf": "file" },
  assetNames: "assets/[name]-[hash]",
  define: { __DEV__: "true", "process.env.NODE_ENV": '"development"', "process.env.EXPO_OS": '"android"', global: "globalThis" },
  plugins: [aliases],
  logLevel: "warning",
  sourcemap: "inline",
});
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:transparent}#root{display:flex}</style></head>
<body><div id="root"></div><script type="module" src="./app.js"></script></body></html>`,
);
console.log(existsSync(join(out, "app.js")) ? "built dist/mascot/app.js" : "build failed");
