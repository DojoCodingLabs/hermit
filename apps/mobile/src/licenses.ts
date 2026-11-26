/**
 * HM-SET-08 (US-SET-10): the open-source licenses, as SPDX ids. Names and ids are not translated.
 * `packages` ties each entry to the app's dependencies; licenses.test.ts fails when a dependency is added
 * without a line here. A trailing `*` matches a family (every `expo-*` module).
 */
export interface LicenseEntry {
  name: string;
  license: string;
  url: string;
  packages?: readonly string[];
  /** A bundled typeface: its file name prefix in assets/fonts (and of its OFL-<font>.txt there). */
  font?: string;
}

export const LICENSES: readonly LicenseEntry[] = [
  // PDR-005: the code and the character art. The name, logo and wordmark are trademarks (copy, not a license).
  { name: "Hermit", license: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  { name: "Hermit character art", license: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  { name: "BotPsy-0.8B (model)", license: "Apache-2.0", url: "https://huggingface.co/qvac/BotPsy-0.8B-GGUFs" },
  { name: "QVAC SDK and Fabric", license: "Apache-2.0", url: "https://github.com/tetherto/qvac", packages: ["@qvac/*"] },
  { name: "QVAC Fabric LLM (llama.cpp and ggml)", license: "MIT", url: "https://github.com/tetherto/qvac-fabric-llm.cpp" },
  { name: "Bare Kit and bare-rpc", license: "Apache-2.0", url: "https://github.com/holepunchto/react-native-bare-kit", packages: ["react-native-bare-kit", "bare-rpc"] },
  { name: "React", license: "MIT", url: "https://github.com/facebook/react", packages: ["react"] },
  { name: "React Native", license: "MIT", url: "https://github.com/facebook/react-native", packages: ["react-native"] },
  { name: "Expo", license: "MIT", url: "https://github.com/expo/expo", packages: ["expo", "expo-*"] },
  { name: "react-native-screens", license: "MIT", url: "https://github.com/software-mansion/react-native-screens", packages: ["react-native-screens"] },
  { name: "react-native-safe-area-context", license: "MIT", url: "https://github.com/AppAndFlow/react-native-safe-area-context", packages: ["react-native-safe-area-context"] },
  { name: "react-native-svg", license: "MIT", url: "https://github.com/software-mansion/react-native-svg", packages: ["react-native-svg"] },
  // The crab's motion, on the UI thread (docs/design/mascot/decisions.md).
  { name: "Reanimated and Worklets", license: "MIT", url: "https://github.com/software-mansion/react-native-reanimated", packages: ["react-native-reanimated", "react-native-worklets"] },
  // Vendored, not a dependency: the icon shapes in src/icons/lucide.ts (license text in src/icons/LICENSE-lucide.txt).
  { name: "Lucide icons", license: "ISC", url: "https://github.com/lucide-icons/lucide/blob/main/LICENSE" },
  // Bundled, not dependencies: the brand faces in assets/fonts, static instances made by scripts/fonts/instance_fonts.py,
  // each family's OFL text next to them (OFL-<family>.txt).
  { name: "Newsreader (typeface)", license: "OFL-1.1", url: "https://github.com/productiontype/Newsreader/blob/master/OFL.txt", font: "Newsreader" },
  { name: "Instrument Sans (typeface)", license: "OFL-1.1", url: "https://github.com/Instrument/instrument-sans/blob/main/OFL.txt", font: "InstrumentSans" },
  { name: "JetBrains Mono (typeface)", license: "OFL-1.1", url: "https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt", font: "JetBrainsMono" },
  { name: "op-sqlite", license: "MIT", url: "https://github.com/OP-Engineering/op-sqlite", packages: ["@op-engineering/op-sqlite"] },
  { name: "SQLCipher", license: "BSD-3-Clause", url: "https://github.com/sqlcipher/sqlcipher" },
];

export function covers(entry: LicenseEntry, dependency: string): boolean {
  return (entry.packages ?? []).some((p) => (p.endsWith("*") ? dependency.startsWith(p.slice(0, -1)) : dependency === p));
}
