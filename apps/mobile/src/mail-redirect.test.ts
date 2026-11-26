// FR-CONN-03 (Q156, Q157): a sign-in can only come back if Android hands the redirect to Hermit and expo-router lands it on a
// screen. The redirects are @hermit/connectors' (one per provider); app.json must declare every scheme they use, and
// each must route to a screen that finishes the sign-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ANDROID_PACKAGE, APP_REDIRECT_URIS } from "../../../packages/connectors/src/app-redirects.ts";

const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")) as { expo: { scheme?: string | string[]; android: { package: string; scheme?: string | string[] } } };
const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** The path expo-router routes a deep link to (its fromDeepLink: the URL's host, then its path, without the first slash). */
const routeOf = (uri: string) => {
  const u = new URL(uri);
  return `${u.host}${u.pathname}`.replace(/^\//, "");
};

test("the Google redirect's scheme is the app's package, as Google's Android clients require", () => {
  assert.equal(app.expo.android.package, ANDROID_PACKAGE);
  assert.equal(APP_REDIRECT_URIS.google, `${ANDROID_PACKAGE}:/oauth2redirect`);
});

test("app.json declares every scheme a sign-in comes back on", () => {
  const schemes = new Set([...list(app.expo.scheme), ...list(app.expo.android.scheme)]);
  for (const [provider, uri] of Object.entries(APP_REDIRECT_URIS)) {
    const scheme = uri.slice(0, uri.indexOf(":"));
    assert.ok(schemes.has(scheme), `${provider}: ${scheme} is not in app.json`);
  }
});

test("each redirect lands on a screen that finishes the sign-in", () => {
  assert.equal(routeOf(APP_REDIRECT_URIS.google!), "oauth2redirect");
  assert.equal(routeOf(APP_REDIRECT_URIS.microsoft!), "oauth/microsoft");
  for (const uri of Object.values(APP_REDIRECT_URIS)) {
    const file = new URL(`./app/${routeOf(uri)}.tsx`, import.meta.url);
    assert.ok(existsSync(file), `no screen for ${uri}`);
    assert.match(readFileSync(file, "utf8"), /<OAuthReturn redirectUri=\{APP_REDIRECT_URIS\.(google|microsoft)!\} \/>/, `${uri}'s screen hands the URL on`);
  }
  const shared = readFileSync(new URL("./components/OAuthReturn.tsx", import.meta.url), "utf8");
  assert.match(shared, /url\.startsWith\(`\$\{redirectUri\}\?`\)/);
  assert.match(shared, /finishOAuthRedirect\(url\)/);
});
