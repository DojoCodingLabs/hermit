import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", "apps/mobile/**", "docs/**", ".context/**", ".superpowers/**",
      // The website's build output and Next's generated files (SL-46).
      "apps/site/.next/**", "apps/site/out/**", "apps/site/public/**", "apps/site/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The core never talks to the network or to React Native. Adapters in the app do.
    files: ["packages/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error",
        { name: "fetch", message: "No network in packages. Network lives in app adapters behind the cage." },
        { name: "XMLHttpRequest", message: "No network in packages." },
        { name: "WebSocket", message: "No network in packages." }],
      "no-restricted-imports": ["error", { patterns: [
        { group: ["react-native", "react-native/*", "expo", "expo-*"], message: "Packages must stay platform-free." }] }],
    },
  },
  {
    // Desktop eval tools only (never bundled into the app): they talk to a local llama-server on the
    // developer's machine to measure the harness (docs/research/harness-diagnosis.md), or to public
    // testnets for spikes (x402-spike.ts and SL-41's x402-merchant-eval.ts, docs/research/x402-spike.md),
    // or to MCP servers for discovery and a loopback reference server (mcp-spike.ts,
    // docs/research/mcp-client-spike.md).
    files: ["packages/eval/src/llama-engine.ts", "packages/eval/src/long-form-eval.ts", "packages/eval/src/embed-check.ts", "packages/eval/src/prompt-size.ts", "packages/eval/src/decision-check.ts", "packages/eval/src/x402-spike.ts", "packages/eval/src/x402-merchant-eval.ts", "packages/eval/src/mcp-spike.ts"],
    rules: { "no-restricted-globals": "off" },
  },
  {
    files: ["scripts/**/*.mjs", "apps/site/scripts/**/*.mjs", "apps/site/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
  {
    // Desktop dev tool only: the reference x402 facilitator for Stable testnet USD₮0, a standalone
    // npm project outside the pnpm workspace (docs/research/x402-spike.md, "USD₮0 settlement").
    files: ["packages/eval/x402-facilitator/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
);
