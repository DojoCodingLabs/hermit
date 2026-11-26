// Preview only: boots the real root layout (src/app/_layout.tsx) with one screen, in the language and scheme the
// URL names. The screens, components, copy, palette and runtime rules are the app's own code, unchanged.
import { AppRegistry } from "react-native";
import { screens } from "expo-router";
import RootLayout from "../../src/app/_layout";
import { setAppLocale } from "../../src/i18n";
import { routes } from "./routes";
import { scene } from "./scene";

Object.assign(screens, routes);
setAppLocale(scene.lang);
document.documentElement.lang = scene.lang;

// Errors a screen throws are kept for the capture script's report.
const errors: string[] = [];
(window as unknown as { __errors: string[] }).__errors = errors;
window.addEventListener("error", (e) => errors.push(String(e.error?.stack ?? e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push(`unhandled: ${String(e.reason?.stack ?? e.reason)}`));

AppRegistry.registerComponent("hermit", () => RootLayout);
AppRegistry.runApplication("hermit", { rootTag: document.getElementById("root") });
