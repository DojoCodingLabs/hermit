# Setting up Dojo's sign-in accounts for Hermit (Q43)

Dojo decided on 2026-11-21 to set these up now (Q43). The account owner follows this guide: they create each account, keep every secret off the repository, and send back only the public values listed at the end of each step. The maintainers then wire those values into the app; nothing in this guide changes code.

Every console step below was checked against the provider's official page on 2026-11-21 (links in [Sources](#sources)). Consoles change: if a screen doesn't match, stop at that step and tell the maintainers what you see instead of guessing.

## How Hermit signs in today

- **Straight from the phone (no secret):** Google (Gmail, Google Calendar, Google Drive), Microsoft (Outlook mail, Outlook Calendar, OneDrive) and Spotify are public OAuth clients. The phone opens the system browser with PKCE, gets the code back on a redirect, and swaps it for tokens itself (`packages/connectors/src/oauth.ts`). Tokens live only in the phone's Keystore-backed credential store.
- **Through a relay (needs a secret):** GitHub, Notion and Slack require a client secret to swap the code, so the swap runs on a relay that holds the secret, seals the tokens to a key the phone made for that one sign-in, and stores nothing (`apps/relay`, PDR-022). Dojo's relay is off by default; the user opts in on HM-CONN-05.
- **Whose client ID:** the user's own client ID from HM-CONN-05 comes first, then Dojo's from the build config (`mailSignInOption` in `packages/mail/src/connect.ts`, `signInOptions` in `packages/connectors/src/sign-in.ts`). Until Dojo's values exist, only the user's own client ID works.
- **The redirects** (set by the mail slice, SL-48 and SL-49: `APP_REDIRECT_URIS` in `packages/connectors/src/app-redirects.ts`, one per provider, so Calendar, Drive and OneDrive reuse them later):
  - Google (Gmail now): `io.dojocoding.hermit:/oauth2redirect` (the package name as a custom scheme, one slash; Q156).
  - Microsoft (Outlook now): `hermit://oauth/microsoft` (Q157). The mail slice renamed it from `hermit://oauth/outlook` so every Microsoft sign-in shares one redirect.
  - Relay sign-ins: the provider sends the browser to `https://<relay host>/v1/callback`, and the relay sends it on to `hermit://oauth/relay` (Q117).
  - Both are built with the recommended options of Q156 and Q157, which haven't been decided yet. If another option is chosen, the console values in this guide change with it. The maintainers will tell you.

The Android package everywhere is **`io.dojocoding.hermit`** (`apps/mobile/app.json`, `android.package`).

## 1. Checklist

Do these in order. Each line says what it unlocks, so you can stop after any line and still have something working.

| # | What you create | Unlocks | Can you skip it for now? |
| --- | --- | --- | --- |
| 1 | **Google Cloud project "Hermit Dev"** with an Android OAuth client (the debug key's SHA-1) and you as a test user (section 2.1) | Gmail, Google Calendar and Google Drive on your phone with a debug build | No: it is the first real sign-in |
| 2 | **Microsoft Entra app registration "Hermit"** (section 2.2) | Outlook mail, Outlook Calendar and OneDrive | No |
| 3 | **The relay**: a host for `relay.dojocoding.io` (Q162), its seal key, and at least one provider app, GitHub first (section 2.3) | GitHub through Dojo's relay; Slack and Notion when their apps exist | Slack and Notion, yes. The relay itself, no: Q43 asks for it |
| 4 | **The spec-signing key** (Ed25519), made offline (section 4) | Connector specs that ship as data (US-CONN-11). The built-in catalog doesn't need it: the app trusts it by hash | Yes, nothing breaks without it. Q43 asks for it now |
| 5 | **The Android release key** and its SHA-1 (section 2.4, Q161) | Release builds signed with Dojo's own key instead of the public debug key; the production Google client | Until you want a release build or the production Google client |
| 6 | **Google Cloud project "Hermit"** (production) with the release key's Android client, the branding and the scopes (section 2.5) | More than your test users; the verification submission | Until step 5 and the website (Q160) exist |
| 7 | **Google's verification** of the restricted Gmail scope (section 5, Q45) | Gmail for more than 100 people | Until steps 5 and 6 and a public website |
| 8 | **Spotify app** (section 2.6, Q165) | Spotify with Dojo's client | Yes, see Q165 first |
| 9 | **Microsoft publisher verification** (section 2.2, last step, Q166) | Work and school Microsoft accounts whose organization only allows verified publishers | Yes, personal Outlook accounts work without it |

Skip entirely for now:

- **A model-signing key** (Q104). It is a separate key with its own open question; nothing here needs it.
- **A Google "Web application" client or any client secret for Google or Microsoft.** Hermit's Google and Microsoft sign-ins are public clients with no secret. If a console offers to create a secret for them, decline.
- **Google's security assessment (CASA).** Google's Trust and Safety team tells you if and when it applies (section 5).

### Values you send back

Only these, sent to the maintainers. They are public identifiers: they ship inside the app or the relay publishes them.

- Google client ID, development project (`<digits>-<id>.apps.googleusercontent.com`).
- Google client ID, production project (same shape), once it exists.
- Microsoft Application (client) ID (a GUID).
- The relay's public address (`https://relay.dojocoding.io` unless Q162 changes it).
- The spec-signing public key (64 hex characters).
- The release key's SHA-1 and SHA-256 certificate fingerprints, once it exists.
- The Spotify client ID, if Q165 says to create one.

### Never send, never commit

- The relay's seal key and every provider client secret (GitHub, Slack, Notion): they go only into the relay host's secret settings.
- The spec-signing private key (the seed).
- The release keystore file and its passwords.
- Passwords, recovery codes or session cookies for any console.

The root `.gitignore` refuses `.env` files and `apps/mobile/.gitignore` refuses `*.jks`, `*.p12`, `*.key` and `*.pem`, but don't rely on either: keep secrets outside every checkout.

## 2. Account by account

Each step lists the console path as the provider's page writes it, the values to type, and what to send back.

### 2.1 Google Cloud: the development project "Hermit Dev"

Why a separate project: Google's OAuth policy says "you must create separate projects in the Google Cloud Console for each deployment tier, such as development, staging, and production", and the 100-user cap of an unverified app "applies over the entire lifetime of the project, and it cannot be reset or changed". So "Hermit Dev" stays in Testing for good (only the test users you list can sign in, up to 100), and the production project in section 2.5 is the only one that goes to verification. Its cap is never spent on testing.

Sign in with the Google account that will own Hermit's projects: a Dojo account, ideally inside a Google Cloud organization for `dojocoding.io` (Google's policy strongly recommends organizations and requires a reachable contact on every project).

1. **Create the project.** Menu > **IAM & Admin** > **Create a Project**. Project name: `Hermit Dev`. Click **Edit** next to the project ID if you want a readable one (for example `hermit-dev`): it can't be changed later. Location: Dojo's organization if offered. Click **Create**.
2. **Turn on the APIs.** Menu > **APIs & Services** > **Library** > **Google Workspace**. Open each and click **Enable**: **Gmail API**, **Google Calendar API**, **Google Drive API**.
3. **Start the Google Auth Platform.** Menu > **Google Auth platform** > **Branding**, then **Get Started**:
   - **App name:** `Hermit Dev`.
   - **User support email:** an address Dojo watches (the field is for users who have questions about their consent).
   - **Audience:** **External**.
   - **Contact information:** the address that should get Google's notices about the project.
   - **Finish:** tick **I agree to the Google API Services: User Data Policy**, then **Continue** and **Create**.
4. **Add yourself as a test user.** **Audience** > **Test users** > **Add users** > your Gmail address (and any tester's) > **Save**. Leave the publishing status at **Testing**. Each test user counts against the project's 100 for good, so add only real testers.
5. **Declare the scopes.** **Data Access** > **Add or Remove Scopes**. Add exactly these (paste any that the list doesn't show), then **Save**:

   | Scope | Google's class | Used by |
   | --- | --- | --- |
   | `https://www.googleapis.com/auth/gmail.modify` | Restricted | Gmail: read, search, send, drafts, labels (`MAIL_OAUTH.gmail` in `packages/mail/src/connect.ts`) |
   | `https://www.googleapis.com/auth/calendar.events.readonly` | Sensitive | Google Calendar connector, `list_events` (`packages/connectors/src/catalog.ts`) |
   | `https://www.googleapis.com/auth/calendar.events` | Sensitive | Google Calendar connector, `create_event` and `delete_event` |
   | `https://www.googleapis.com/auth/drive.metadata.readonly` | Restricted | Google Drive connector, `search_files` (see Q164) |

6. **Create the Android client.** **Clients** > **Create Client** > **Application type** > **Android**:
   - **Name:** `Hermit Android (debug key)`. Only the console shows it.
   - **Package name:** `io.dojocoding.hermit`.
   - **SHA-1 certificate fingerprint:** `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`. This is the debug key every local build is signed with today: `expo prebuild` writes React Native's template key to `apps/mobile/android/app/debug.keystore`, and `android/app/build.gradle` signs both debug and release builds with it. To read it yourself after a prebuild: `keytool -list -v -alias androiddebugkey -keystore apps/mobile/android/app/debug.keystore -storepass android`, then copy the `SHA1` line. This key's private half ships in every React Native template, so it identifies nothing: never register it in the production project.
   - **Use this client for an AI-powered agent:** follow Q163 (recommended: tick it). Google's client-creation page says "You can't change this setting after you create the client" (its client-management page is less clear), so treat it as permanent and decide before you click Create.
   - Click **Create**. An Android client has no client secret.
7. **Turn on the custom scheme.** Open the new client > **Advanced settings** > tick **Enable custom URI scheme** > **Save**. Hermit's Gmail redirect is `io.dojocoding.hermit:/oauth2redirect` (Q156), and Google switched this option off by default for new Android clients in 2023. Google's native-app page now also says custom URI schemes "are no longer supported on Android". If **Advanced settings** has no such option, stop here and tell the maintainers: Gmail through Dojo's client then needs the decision in Q156 (Google's alternative for Android, the Play services `AuthorizationClient`, lives in `play-services-auth`, which `pnpm check:privacy` refuses today).
8. **Skip "Verify app ownership"** here: it needs a Google Play app with this package and SHA-1, which the debug key never will be.

**Send back:** the **Client ID** (`<digits>-<id>.apps.googleusercontent.com`). It is public: it ships inside the app.

What testers see: until verification, Google shows its unverified-app screen before the consent screen; test users can continue past it. Google also ends a test user's grant after seven days ("Authorizations by a test user will expire seven days from the time of consent"), so in this project Gmail asks you to sign in again every week. That is expected, not a bug.

### 2.2 Microsoft Entra: the app registration "Hermit"

One registration serves debug and release builds: the Outlook redirect is a custom scheme that doesn't depend on the signing key.

Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) with a **work account in Dojo's own Microsoft Entra tenant** (Dojo's Microsoft 365 tenant if it has one), with at least the Application Developer role. Don't use a personal Microsoft account: Microsoft says "Apps that are registered by using a Microsoft account can't be publisher verified", and the app can't move to another tenant later.

1. **Register.** **Entra ID** > **App registrations** > **New registration**:
   - **Name:** `Hermit`. Users see it on the consent screen.
   - **Supported account types:** **Any Entra ID Tenant + Personal Microsoft accounts** (older pages call it "Accounts in any organizational directory and personal Microsoft accounts"). Hermit signs in through the `common` endpoints (`packages/connectors/src/oauth-providers.ts`), which serve both outlook.com and work accounts.
   - Leave the redirect empty here. Click **Register**.
   - From **Overview**, copy the **Application (client) ID**.
2. **Add the redirect.** **Manage** > **Authentication** > **Add Redirect URI** (some tenants show **Add a platform**) > the **Mobile and desktop applications** tile, which Microsoft describes as the platform "for desktop apps or mobile apps not using MSAL or a broker". Under **Custom redirect URIs** enter `hermit://oauth/microsoft` (Q157) > **Configure**. Don't use the **Android** tile: it generates an `msauth://io.dojocoding.hermit/<signature hash>` redirect, which is for apps that use MSAL or Microsoft's broker, and Hermit uses neither.
3. **Leave "Allow public client flows" at No.** It is under **Authentication** > **Advanced settings**. Microsoft says it "should be disabled unless" the app uses native authentication, device code, the resource owner password flow or Windows integrated auth. Hermit uses the authorization code flow with PKCE, which needs none of them.
4. **Declare the permissions.** **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions**. Select these and click **Add permissions**:

   | Permission | Used by |
   | --- | --- |
   | `offline_access` | Refresh tokens, so Outlook stays connected (`MAIL_OAUTH.outlook`) |
   | `User.Read` | The account's address after sign-in (added by default) |
   | `Mail.ReadWrite` | Read, drafts, move and flag mail |
   | `Mail.Send` | Send mail, after the user approves each send |
   | `Calendars.Read` | Outlook Calendar connector, `list_events` |
   | `Calendars.ReadWrite` | Outlook Calendar connector, `create_event` |
   | `Files.Read` | OneDrive connector, `recent_files` |

   Microsoft's permissions reference lists every one of these delegated permissions as "AdminConsentRequired: No" and available for consent in personal Microsoft accounts. Don't click **Grant admin consent**: each user consents for themselves.
5. **No secret.** Leave **Certificates & secrets** empty. Hermit is a public client: a secret in the app would be readable by anyone who unpacks it.
6. **Branding & properties** (when the website is live, Q160): set **Home page URL**, **Terms of service URL** and **Privacy statement URL** to the site's pages, and upload the logo from `docs/brand/`.

**Send back:** the **Application (client) ID** (a GUID).

#### Later: publisher verification (Q166)

Without it, the consent screen marks Hermit as *unverified*, and a work or school user can only consent if their organization lets users consent to apps from unverified publishers. Microsoft recommends organizations allow user consent "only for applications that have been published by a verified publisher", and when risk-based step-up consent is on, "users can't consent to most newly registered multitenant apps that aren't publisher verified". Personal Outlook accounts are not affected. It costs nothing: "Microsoft doesn't charge developers for publisher verification. No license is required."

1. Enroll Dojo Coding in the **Microsoft AI Cloud Partner Program** in Partner Center and finish its verification. You need the **Partner One ID** of Dojo's partner global account (PGA), not a location ID.
2. **Set the publisher domain.** App registration > **Branding & properties** > **Publisher domain** > **Configure a domain**. Either pick `dojocoding.io` if it is already a DNS-verified custom domain in the tenant, or **Verify a new domain**: host a file at `https://dojocoding.io/.well-known/microsoft-identity-association.json` with `{"associatedApplications":[{"applicationId":"<the Application (client) ID>"}]}`, served as `application/json`, then **Verify and save domain**. It can't be `*.onmicrosoft.com`, and the domain of the email address you used to verify the partner account must either match it or be a DNS-verified custom domain in the tenant.
3. Signed in with multifactor authentication, as an Application Administrator or Cloud Application Administrator in Entra who is also a Partner Admin or Account Admin in Partner Center: **Branding & properties** > **Add Partner ID to verify publisher** > enter the Partner One ID > **Verify and save**. The blue *verified* badge then appears on Hermit's consent screen.

### 2.3 The relay at `relay.dojocoding.io`

**What it is.** `apps/relay` is a small Node 24 program with no framework and no build step. It swaps a provider's code for tokens with a client secret the phone never sees, seals the tokens to the phone, and stores nothing (FR-CONN-07, PDR-022). Its routes are `GET /v1/providers`, `POST /v1/start`, `GET /v1/callback`, `POST /v1/token` and `GET /healthz`. It is opt-in for users and off by default.

**Where it runs.** The repository names no hosting platform. The relay's code says it "listens on plain HTTP on a private address (127.0.0.1 by default) and expects an HTTPS proxy in front (Caddy, nginx, a platform's load balancer)", and the app's tests use `https://relay.dojocoding.io` as Dojo's address. Q162 picks the host. These steps follow its recommended option: **a small Linux server that runs only the relay, with Caddy in front.** Two properties of the relay drive that choice:

- **Rate limiting per phone.** With `HERMIT_RELAY_TRUST_PROXY=1`, the relay counts each client by the last address in `X-Forwarded-For`. Caddy, by default, ignores the `X-Forwarded-*` values a client sends "to prevent spoofing" and sets its own, so the relay sees each phone's real address. Behind a platform proxy that adds its own entries, every phone could be counted as one client and share one limit (30 requests a minute by default).
- **"Stores nothing."** The provider's code reaches the relay in the query string of `GET /v1/callback`. Caddy writes access logs only when its `log` directive is configured. Some platforms log every request URL for you (Render does on Pro workspaces), which would keep those codes in a log. The relay's own log lines carry only the route, the status, the provider and the time taken.

These steps were checked on 2026-11-21 by exporting the repository with `git archive`, running the filtered install below in a clean folder, and starting the relay with three providers: it served `/healthz` and `/v1/providers` as expected.

#### A. The server

1. **Rent a small Linux server** with Ubuntu 24.04 LTS from the provider Dojo prefers, with your SSH key. Note its public IPv4 address (and IPv6, if it has one). In the provider's firewall, allow only ports 22, 80 and 443 in.
2. **DNS.** At the DNS provider for `dojocoding.io`, add an `A` record `relay` pointing to the IPv4 address (and an `AAAA` record for the IPv6 one). Caddy can only get the certificate once this name resolves to the server and ports 80 and 443 are reachable.
3. **Node 24** (the repository's `.nvmrc` says 24), from nodejs.org with its published checksum. On an arm64 server use the `linux-arm64` file instead:

   ```sh
   cd /tmp
   curl -fsSLO https://nodejs.org/dist/v24.22.3/node-v24.22.3-linux-x64.tar.xz
   curl -fsSLO https://nodejs.org/dist/v24.22.3/SHASUMS256.txt
   grep " node-v24.22.3-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c -
   sudo tar -xJf node-v24.22.3-linux-x64.tar.xz -C /usr/local --strip-components=1
   node --version
   sudo npm install -g pnpm@10.15.1
   ```

   `sha256sum -c` must print `OK`. pnpm 10.15.1 is the version in the root `package.json` (`packageManager`).
4. **Caddy**, from its official apt repository (commands from caddyserver.com/docs/install). The package starts Caddy as the systemd service `caddy`:

   ```sh
   sudo apt install --yes debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install caddy
   ```

5. **A user and the code.** The repository was private when this was written (Q3; superseded: the repository went public as open source, Q210 to Q213), so this step copies the exact commit from your Mac instead of giving the server GitHub access:

   ```sh
   # On the server:
   sudo useradd --system --create-home --home-dir /opt/hermit-relay --shell /usr/sbin/nologin hermit-relay
   sudo -u hermit-relay mkdir /opt/hermit-relay/hermit

   # On the Mac, from a checkout of the repository:
   git fetch origin
   git archive --format=tar -o hermit.tar origin/master
   scp hermit.tar <server>:/tmp/hermit.tar
   rm hermit.tar

   # On the server:
   sudo -u hermit-relay tar -xf /tmp/hermit.tar -C /opt/hermit-relay/hermit
   rm /tmp/hermit.tar
   sudo -H -u hermit-relay sh -c 'cd /opt/hermit-relay/hermit && pnpm install --frozen-lockfile --filter "@hermit/relay..."'
   ```

   The filter installs only the relay and what it imports (`@hermit/connectors` and its libraries), not the mobile app. The install runs as the relay's user inside its own folder, because your login user may not be allowed into that user's home.

#### B. The secrets file

The relay reads its settings only from the environment, never from a file in the repository or a command-line argument (`apps/relay/src/config.ts`). systemd's manual warns that "environment variables are not suitable for passing secrets", so keep the file readable by root only, run nothing else on this server, and never copy the file anywhere.

1. Create the file with a fresh seal key that never leaves the server:

   ```sh
   sudo install -d -m 700 -o root -g root /etc/hermit-relay
   sudo sh -c 'umask 077; printf "HERMIT_RELAY_SEAL_KEY=%s\n" "$(openssl rand -base64 32 | tr "+/" "-_" | tr -d "=")" > /etc/hermit-relay/env'
   sudoedit /etc/hermit-relay/env
   ```

2. Add these lines below the seal key (the provider lines come from part D):

   ```sh
   HERMIT_RELAY_PUBLIC_URL=https://relay.dojocoding.io
   HERMIT_RELAY_PROVIDERS=github
   HERMIT_RELAY_GITHUB_CLIENT_ID=<GitHub client ID>
   HERMIT_RELAY_GITHUB_CLIENT_SECRET=<GitHub client secret>
   HERMIT_RELAY_HOST=127.0.0.1
   HERMIT_RELAY_PORT=8787
   HERMIT_RELAY_TRUST_PROXY=1
   ```

   The seal key only protects sign-ins in flight: rotating it (or losing it) only fails sign-ins under way, so it needs no backup. `HERMIT_RELAY_RATE_PER_MINUTE` stays at its default of 30 unless you set it.

3. **Replacing a secret** (if one leaks, or to rotate it), always with `sudoedit /etc/hermit-relay/env`: for the seal key, replace the value of its line with a new one from `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` (don't rerun step 1: it overwrites the whole file); for a provider secret, generate a new one on the provider's page, replace its line, and delete the old secret there. Then `sudo systemctl restart hermit-relay`.

#### C. Run it

1. Create `/etc/systemd/system/hermit-relay.service`:

   ```ini
   [Unit]
   Description=Hermit sign-in relay
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=hermit-relay
   WorkingDirectory=/opt/hermit-relay/hermit
   EnvironmentFile=/etc/hermit-relay/env
   ExecStart=/usr/local/bin/node apps/relay/src/main.ts
   Restart=on-failure
   NoNewPrivileges=true
   PrivateTmp=true
   ProtectSystem=strict
   ProtectHome=true

   [Install]
   WantedBy=multi-user.target
   ```

2. Start it: `sudo systemctl daemon-reload && sudo systemctl enable --now hermit-relay`. Check with `systemctl status hermit-relay` and `journalctl -u hermit-relay`: the first line lists the providers it serves. If a setting is wrong, the relay names the variable (never its value) and exits.
3. Put Caddy in front: replace `/etc/caddy/Caddyfile` with the block below, then `sudo systemctl reload caddy`. Don't add a `log` directive.

   ```
   relay.dojocoding.io {
   	reverse_proxy 127.0.0.1:8787
   }
   ```

4. From any computer: `curl https://relay.dojocoding.io/healthz` answers `ok`, and `curl https://relay.dojocoding.io/v1/providers` lists each provider with its public client ID and `"callback":"https://relay.dojocoding.io/v1/callback"`.
5. **Updating later:** `sudo systemctl stop hermit-relay`, then `sudo rm -rf /opt/hermit-relay/hermit && sudo -u hermit-relay mkdir /opt/hermit-relay/hermit`, copy and extract a fresh `git archive` of the new commit and run the same install line as in A.5, then `sudo systemctl start hermit-relay`. Keep the server's packages up to date.

#### D. The provider apps (client ID and secret for each)

The relay needs at least one. Each app's redirect is the relay's callback, exactly: **`https://relay.dojocoding.io/v1/callback`**. Each secret goes straight from the provider's page into `/etc/hermit-relay/env`, then add the provider's id to `HERMIT_RELAY_PROVIDERS` (comma-separated, for example `github,slack,notion`) and run `sudo systemctl restart hermit-relay`.

**GitHub (do this one).** Create it under the DojoCodingLabs organization so it doesn't depend on a personal account: the organization's **Settings** > **Developer settings** > **OAuth apps** > **New OAuth App** (GitHub documents the same path under a personal account's **Settings**).

1. **Application name:** `Hermit`. **Homepage URL:** the website once Q160 is settled (`https://dojocoding.io` until then). **Authorization callback URL:** `https://relay.dojocoding.io/v1/callback`. Leave **Enable Device Flow** off.
2. **Expire user access tokens:** untick it. GitHub turns it on by default. Hermit never refreshes a token that came through the relay (Q116, as built), so an expiring token would end each GitHub connection soon after sign-in. If Q116 later moves refreshes to the relay, turn it back on.
3. **Register application**, copy the **Client ID**, then generate a client secret on the app's page and paste it into the env file as `HERMIT_RELAY_GITHUB_CLIENT_SECRET`.

The GitHub connector asks for the `repo` scope (`packages/connectors/src/catalog.ts`).

**Slack (optional).** [api.slack.com/apps](https://api.slack.com/apps) > **Create New App** > **From scratch** > name `Hermit`, a Dojo workspace for development > **Create App**.

1. **OAuth & Permissions** > **Redirect URLs** > add `https://relay.dojocoding.io/v1/callback` > **Save URLs**. Slack requires the sign-in's `redirect_uri` to "match or be a subdirectory of" one of these.
2. **Scopes** > **Bot Token Scopes**: add `channels:read` and `chat:write`. Hermit sends its scopes in the `scope` parameter, which Slack reads as bot scopes ("Bot scopes should be added as `scope=<bot_scope>`"), so the token is a bot token and messages post as the app. The connector's text says it posts "in the user's name": the maintainers are checking that before Slack goes live, so set up the bot scopes as listed for now.
3. **Basic Information** > **App Credentials**: copy the **Client ID** and **Client Secret** into the env file (`HERMIT_RELAY_SLACK_CLIENT_ID`, `HERMIT_RELAY_SLACK_CLIENT_SECRET`).
4. **Manage Distribution** > **Share Your App with Other Workspaces**: complete the checklist and click **Activate Public Distribution**, so workspaces other than Dojo's can install it. Slack doesn't require a Marketplace listing for this (it says apps "intended for commercial distribution" should be listed).

**Notion (optional).** Open Notion's developer portal at [app.notion.com/developers/connections](https://app.notion.com/developers/connections) while you are in Dojo's workspace (it becomes the development workspace and can't be changed).

1. **Developer connections** > **New connection**. Name: `Hermit`. **Authentication method:** **OAuth**. **Redirect URIs:** `https://relay.dojocoding.io/v1/callback`. **Installable in:** **Any workspace**. **Create connection**.
2. **Configuration** tab: give it read-content capability only (the Notion connector only searches and reads pages), and copy the **OAuth client ID** and **client secret** into the env file (`HERMIT_RELAY_NOTION_CLIENT_ID`, `HERMIT_RELAY_NOTION_CLIENT_SECRET`). Notion's token request uses HTTP Basic with these two, which the relay already does.
3. Notion says you "can create and use a public connection without listing it"; only a Marketplace listing needs its security review.

**Send back:** the relay's address if it isn't `https://relay.dojocoding.io`, and which providers it serves. The client IDs are public (the relay lists them at `/v1/providers`); the secrets stay on the server.

### 2.4 The Android release key and its SHA-1 (Q161)

**Today there is none.** The generated `apps/mobile/android/app/build.gradle` signs release builds with the public debug key ("Caution! In production, you need to generate your own keystore file."). The production Google client (2.5) needs the SHA-1 of the key that really signs Hermit for users, and Q161 decides which key that is.

These steps follow Q161's recommended option: **one Dojo app signing key for Google Play and the GitHub APK**. Android's guide says: "If you want to use the same signing key across multiple stores, make sure to provide your own signing key when you configure Play App Signing, instead of having Google generate one for you." One key means one certificate everywhere, so one SHA-1 for Google, one app identity (`android://<cert>@io.dojocoding.hermit` in autofill), and installs from either channel update from the other.

1. **Make the key** on a Mac you trust, ideally offline, in a folder outside every checkout. This is React Native's documented command with Dojo's names:

   ```sh
   keytool -genkeypair -v -storetype PKCS12 -keystore hermit-release.p12 -alias hermit -keyalg RSA -keysize 2048 -validity 10000
   ```

   keytool asks for a password and the certificate's name fields (Organization: `Dojo Coding`). 10000 days is more than the 25 years Android recommends ("Your key should be valid for at least 25 years") and ends after 22 October 2033, which Google Play requires. Use a long random password from the password manager.
2. **Read its fingerprints:** `keytool -list -v -keystore hermit-release.p12 -alias hermit`. Copy the `SHA1` and `SHA256` lines.
3. **Store it** as you would the spec-signing key (section 4): the `.p12` file and its password in Dojo's password manager, in a vault only the people who sign releases can open, plus one offline copy (an encrypted USB drive in a safe). Then delete the working copy from the Mac. Android's guide is blunt: "If you lose or misplace your key, you will not be able to publish updates to your existing app."
4. **Later, when the Play app exists (DEP-06):** in the first release's **App signing** section choose **Change app signing key**, then one of the **Export and upload** options, to give Play this key. Google also recommends a separate upload key ("it's a good idea to make sure your app signing key and upload key are different"): make it with the same command (alias `upload`, another file) and register its certificate when the Play Console offers it. Google keeps a copy of the app signing key and "you cannot retrieve a copy" from Play, so your offline copy stays the master.

**Send back:** the SHA-1 and SHA-256 fingerprints (public). The maintainers wire release signing so the build reads the keystore from outside the repository (an Expo config plugin, since `android/` is generated).

If Q161 picks a Google-generated key instead: skip steps 1 to 3, and after the first Play release copy the app signing key's SHA-1 from the Play Console's app signing page (Play's help calls the path **Protected with Play** > **Play Store protection** > **Manage Play app signing**; Android's guide calls it **Release** > **Setup** > **App signing**). The GitHub APK then needs its own key, and the production project needs a second Android client for it.

### 2.5 Google Cloud: the production project "Hermit"

Create it once the release key exists (2.4) and the website is live on its domain (Q160): Google's brand review checks the home page and the privacy policy on a domain you have verified.

1. **Create the project** as in 2.1, named `Hermit` (for example ID `hermit-app`), and turn on the same three APIs.
2. **Google Auth Platform** > **Branding** > **Get Started**, as in 2.1, with **App name** `Hermit` and **Audience** **External**.
3. **Branding** page, everything users and Google's reviewers see:
   - **App logo:** Hermit's mark from `docs/brand/` exactly as locked (never a new drawing).
   - **Application home page:** the English home page of the site, for example `https://hermit.dojocoding.io/en/` (Q160). Google's policy: the home page must describe the app, can't be only a login page, and "links to terms of service and a privacy policy" (Q168: the site has no terms page yet).
   - **Application privacy policy link:** the site's privacy page, for example `https://joinhermit.com/en/privacy/`, the same URL the home page links to. Its contact is privacy@dojocoding.io (Q107).
   - **Application terms of service link:** the terms page from Q168.
   - **Authorized domains:** `dojocoding.io`.
   - **Developer contact information:** the address that should get Google's review mail. Google warns that missing its notices "could result in the loss of access to Google APIs."
4. **Verify `dojocoding.io` in Google Search Console**, signed in with an account that is Owner or Editor of this project: **Add property** > **Domain** > `dojocoding.io`, add the TXT record it gives you at the DNS provider (host `@` or blank), then **Verify**. Keep the record afterwards. A Domain property covers every subdomain, so `hermit.dojocoding.io` and `relay.dojocoding.io` are included.
5. **Data Access:** the same four scopes as in 2.1 (minus Drive's if Q164 drops it).
6. **Clients** > **Create Client** > **Android**: name `Hermit Android (release key)`, package `io.dojocoding.hermit`, the **SHA-1 from 2.4**, the AI agent box as decided in Q163 (the same choice as in 2.1). Then **Advanced settings** > **Enable custom URI scheme**, as in 2.1.
7. **Verify app ownership** once the Play app exists: Google requires "a registered application in the Google Play Console with the same package name and SHA-1 signing certificate fingerprint" and **Admin** permission on it. Open the client's **Verify App Ownership** section and click **Verify Ownership**.
8. **Audience:** leave **Testing** (add yourself as a test user) until you submit for verification in section 5, then **Publish app**.

**Send back:** the production project's **Client ID**.

### 2.6 Spotify (Q165)

**Recommended: don't create a Dojo Spotify app yet.** Since February 2026, Spotify allows "Up to 5 authenticated Spotify users" on an app in development mode, "The app owner must have a Spotify Premium account", and each developer gets one development-mode client. Extended quota, which lifts the cap, is only for organizations: "as of May 15th 2025, Spotify only accepts applications from organizations (not individuals)", with "at least 250k MAUs". A Dojo client would therefore serve at most five people. Under Q165's recommended option, Spotify stays on each user's own client ID (HM-CONN-05 takes Google and Microsoft client IDs today; Spotify would join them).

If Q165 says to make one for your own testing:

1. [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) > **Create app**: **App name** `Hermit`, **App description**, **Website**, tick the **Developer Terms of Service** box, then save. If the form asks which APIs you use, pick **Web API**.
2. **Redirect URIs:** placeholder, not settled. Hermit has no Spotify redirect in code yet. Spotify's page says "Use HTTPS for your redirect URI, unless you are using a loopback address" and doesn't mention custom schemes, so the maintainers confirm the redirect before you add it.
3. **User Management:** add each tester's name and Spotify email (five at most). Users not on the list get `403` errors.
4. Copy the **Client ID**. Ignore the client secret: Hermit signs in to Spotify with PKCE and no secret.

**Send back:** the Spotify Client ID, only if you created the app.

## 3. Where each value goes

The app has no runtime configuration file and reads no environment variables: Dojo's values are build-time constants in **`apps/mobile/src/dojo-config.ts`**, committed to the repository. They are public, and reproducible release builds (FR-PLAT-03) must get the same values from the source rather than from someone's local setup. The runtime checks each value again (an https address on a public host, a client ID of the provider's shape), so a typo fails closed.

| Value | Secret? | Where it goes | Read by |
| --- | --- | --- | --- |
| Google client ID (development project) | No | `DOJO_CLIENT_IDS.google` in `apps/mobile/src/dojo-config.ts` | `createRelaySettings` (`packages/runtime/src/relay.ts`) through the relay port in `apps/mobile/src/adapters/index.ts`, then `mailSignInOption` and `signInOptions` |
| Google client ID (production project) | No | The same constant, for release builds (see the note below) | The same |
| Microsoft Application (client) ID | No | `DOJO_CLIENT_IDS.microsoft` | The same |
| Spotify client ID (only if Q165 says) | No | `DOJO_CLIENT_IDS.spotify`, once the type and HM-CONN-05 take Spotify | `signInOptions` |
| Relay address | No | `DOJO_RELAY_URL` (on master today) | `createRelaySettings`; HM-CONN-05 shows Dojo's relay as available, and the privacy screen lists its host once the user turns it on |
| Spec-signing public key (64 hex characters) | No | A new constant, proposed `DOJO_SPEC_PUBLIC_KEY`, in the same file | Passed as `dojoPublicKey` to `ConnectorRuntime` (`RuntimeDeps` in `packages/connectors/src/runtime.ts`), which `specTrust` in `packages/connectors/src/catalog.ts` uses |
| Release key SHA-1 and SHA-256 | No | The production Google client (2.5); published with each GitHub release so anyone can compare it with `apksigner verify --print-certs` | People checking the APK; Google |
| Relay seal key, provider client IDs and secrets, public URL, host, port | The seal key and the secrets, yes | `/etc/hermit-relay/env` on the relay server only, readable by root only | `loadConfig` in `apps/relay/src/config.ts` |
| Spec-signing seed (private key) | **Yes** | Dojo's password manager and one offline copy (section 4) | Dojo's release tooling at signing time, which isn't built yet |
| Release keystore and its password | **Yes** | Dojo's password manager and one offline copy (2.4) | The release build, from outside the repository (to be wired) |
| Search Console TXT record | No | DNS for `dojocoding.io` | Google |
| `microsoft-identity-association.json` (only if you verify the publisher domain by file) | No | `https://dojocoding.io/.well-known/` on Dojo's main site, not this repository | Microsoft, once ("you can remove the hosted file" after verification) |

Notes for the wiring:

- **State today.** `DOJO_RELAY_URL` is on master. `DOJO_CLIENT_IDS` (`{ google?: string; microsoft?: string }`, in `apps/mobile/src/dojo-config.ts`) arrives with the mail slice (SL-48 and SL-49), which passes it to the runtime and drops any value that fails `validateClientId`. No spec key constant exists yet, and the only `ConnectorRuntime` the app builds (`packages/connectors/src/connect/installs.ts`) gets no `dojoPublicKey`, so nothing can verify a Dojo-signed spec until it is wired. That blocks nothing in V1: the built-in catalog is trusted because its hash ships in the app ("bundled").
- **Two Google client IDs.** `DOJO_CLIENT_IDS` holds one Google value. Until the production project exists, every build uses the development client ID. Once both exist, debug builds should use the development ID and release builds the production one.
- **The Gmail redirect needs its scheme declared.** `io.dojocoding.hermit:/oauth2redirect` only reaches the app if the build registers the `io.dojocoding.hermit` scheme. The mail slice declares it in `apps/mobile/app.json` (`android.scheme`, beside the `hermit` scheme that Microsoft's redirect uses), so builds from before it can't finish a Google sign-in.
- **Never commit** the relay's env file or any line of it, the spec-signing seed, the release keystore or its passwords. Never paste them into chat, an issue, a PR or a log. If one is ever committed, treat it as leaked and replace it rather than rewriting history: a relay secret as in 2.3 B, the spec key as in section 4. A leaked release key can't simply be swapped (installed apps only accept updates signed with the same key), so guard it hardest.

## 4. The spec-signing key (Ed25519)

**What it signs.** Connector specs that ship as data (FR-CONN-01, US-CONN-11, V2). The signature is Ed25519 over the spec's hash, the SHA-256 of its canonical JSON without the signature (`signSpec` and `verifySpecSignature` in `packages/connectors/src/spec.ts`). The phone trusts a spec only if it is bundled (its hash ships in the app) or its signature verifies against the pinned public key; anything else is "untrusted", whatever the spec claims about itself (`specTrust` in `packages/connectors/src/catalog.ts`). This key signs nothing else: not the app (that is the release key, 2.4) and not model manifests (Q104 recommends a separate key).

**Make it offline.**

1. Use a Mac you trust with Wi-Fi off, and Node 24 (the repository's version). Open a fresh terminal window in a folder outside every checkout.
2. Run this. It uses only Node's built-in crypto, prints the 32-byte private seed and the 32-byte public key as hex, and writes nothing to disk:

   ```sh
   node -e '
   const { generateKeyPairSync } = require("node:crypto");
   const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
   const hex = (s) => Buffer.from(s, "base64url").toString("hex");
   console.log("PRIVATE seed, secret:", hex(jwk.d));
   console.log("PUBLIC key, send this:", hex(jwk.x));
   '
   ```

   This format is what the repository's code expects: a key made this way was checked on 2026-11-21 with `signSpec` and `verifySpecSignature` (it verified, and a different key was refused).
3. Copy the seed into a new password manager item, for example "Hermit spec-signing key (Ed25519 seed)", and put the public key in the same item so the pair stays together.
4. Make one offline copy of the seed (on paper, or on an encrypted USB drive) and keep it in a safe, apart from the Mac.
5. Clear the terminal's scrollback (in Terminal, **Edit** > **Clear Scrollback**) and close the window. The seed was never typed as a command, so it isn't in your shell history.
6. Send the maintainers the **public key** only.

**Where the private key lives.** Q167 decides; its recommended option is Dojo's password manager, in a vault only the people who sign connector specs can open, plus that one offline copy. Never on the relay server, in CI, in a checkout, or in chat. The other choice is a hardware key: a YubiKey with firmware 5.7 or later can hold Ed25519 keys in its PIV application, so the key can never be copied off it. But the repository's `signSpec` takes the raw seed, so signing with a hardware key needs a signing tool that doesn't exist yet.

**Where the public key is pinned.** In `apps/mobile/src/dojo-config.ts` (the proposed `DOJO_SPEC_PUBLIC_KEY`), passed to the connector runtime as `dojoPublicKey` (section 3). Every app release carries it, so changing it takes an app release.

**If the seed leaks.** Make a new key the same way, pin the new public key in an app release, and re-sign every spec that ships as data. Phones that haven't updated still trust the old key until they do, so treat a leak as an urgent release.

## 5. Google's verification for Gmail (Q45)

**Why.** `gmail.modify` is a restricted scope. Until Google verifies the production project, every new user first sees Google's unverified-app screen, and the app "will be limited to 100 new users until it is verified". Google's FAQ: "the user cap applies over the entire lifetime of the project, and it cannot be reset or changed." That is why testing happens in "Hermit Dev" (2.1) and the production project stays in Testing, with only its listed test users, until you submit.

**What gets reviewed.** Every scope the production project declares, in one submission: `gmail.modify` and `drive.metadata.readonly` (restricted), `calendar.events.readonly` and `calendar.events` (sensitive). A scope added later "needs to be verified and approved for these scopes before your app can start to call these APIs", and a new name, logo, home page link or privacy policy link goes back to brand verification.

### Before you submit

1. **The website is public** on the verified domain (Q160). Tether's written OK for the logos no longer blocks going public (Q211 superseded Q14 and DEP-04). Google: "The homepage must be hosted on a verified domain you own", it must describe the app ("Your homepage can not be only a login page"), and it must link to the privacy policy and the terms of service (Q168).
2. **The privacy policy** (HM-SITE-02: `apps/site/app/[lang]/privacy/page.tsx`, copy in `apps/site/locales/en.json` and `es-419.json`) needs three additions, which the maintainers write (they are copy, not decisions):
   - Google's disclosure rule: it "must disclose how your app accesses, uses, stores, and/or shares Google user data". Say that Gmail, Calendar and Drive data go from Google straight to the phone, stay there, never reach Dojo, and are deleted on Disconnect or Delete everything.
   - The Limited Use statement, which the policy doesn't have yet. Google's suggested sentence: "The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements." It must be "disclosed in your application or on a website belonging to your web-service or application".
   - The same policy URL on the home page and on the consent screen. Its contact stays privacy@dojocoding.io (Q107).
3. **An in-app notice.** Google: "In-product privacy notifications must be prominently displayed in your app interface". Check that the Gmail connect screen says, in English and in Spanish, what Hermit does with the mailbox.
4. **The production project** has its branding, its Search Console domain and its Android client (2.5), and a release build signed with the release key (2.4) uses the production client ID.

### Submit

1. **Branding first.** Google requires "a published branding status before you can request verification for data access". Follow it in **Google Auth Platform** > **Verification Center**.
2. **Audience** > **Publish app.** From now until approval, new users see the unverified-app screen and count against the 100.
3. **Data access** (from **Verification Center**). For each scope, "describe how you will use the restricted scopes in your app and why more limited scopes aren't sufficient". Google warns that an insufficient justification can get the request rejected. Suggested lines:
   - `gmail.modify`: Hermit reads, searches and summarizes the user's mail on the phone, writes drafts, and sends, archives or labels a message only after the user approves that exact action. Archiving and labeling messages need `gmail.modify` (`gmail.labels` only manages the list of labels), and the narrower read and draft scopes (`gmail.readonly`, `gmail.compose`) are restricted too, so splitting them would not narrow the review.
   - `calendar.events.readonly` and `calendar.events`: the Google Calendar connector lists events, and adds or deletes one only after the user approves it. Hermit asks only for the scopes of the operations the user turns on (`scopesFor` in `packages/connectors/src/oauth.ts`).
   - `drive.metadata.readonly`: the Google Drive connector finds files by name and reads their metadata only, never their contents (Q164).
   - **What features will you use?** Gmail's permitted types include "Built-in and web email clients that allow users to compose, send, read, and process email via a user interface" and productivity apps, for example "providing generative AI summaries". Hermit is both.
   - **Documentation links** (up to three): the privacy policy, the architecture spec or the repository (Q3 said "once it is public"; superseded: the repository went public as open source, Q210 to Q213), and a page that explains the on-device design.
   - **Demo video**, uploaded to YouTube as **Unlisted**, its link pasted in the form. Google asks that it:
     - shows "the end-to-end flow of your app including the OAuth grant process", in "the same application you have submitted for verification (including app name, branding)";
     - shows "that the browser address bar of the OAuth consent screen correctly includes your app's OAuth client ID": tap the browser's address bar while the consent screen is up, so the `client_id=` value (the production ID) is visible;
     - shows the complete consent screen with "the same exact scopes you are requesting", with the language selector at the bottom left "toggled to 'English'";
     - demonstrates each feature that uses each scope: a question about the inbox, a summary, a draft, a send through the approval sheet and the fingerprint, an archive; a Calendar list and an added event; a Drive search.

     Record it on the phone with Hermit set to English. Hermit trains no model on user data (Google requires a visible consent step only if it did); say so in the video's description.
4. **The security assessment (CASA).** Google's restricted-scope page ties it to servers: "If you store or transmit restricted scope data on servers, then you need to complete a security assessment", and it applies to an app that "accesses or has the capability to access Google user data from or through a server". Hermit has no such server: Google sign-in runs from the phone without the relay (Google takes a public client; Dojo's relay serves only GitHub, Slack and Notion), and Gmail, Calendar and Drive data go from Google to the phone and stay there. By Google's own wording the assessment shouldn't apply, but Google states no exemption, and "the Google Trust and Safety team will contact you when it is time to initiate the security assessment process". So state the no-server design plainly in the submission and wait for Google. If it still asks: an assessor under the App Defense Alliance's CASA program performs it, Google charges nothing for it ("The cost for such a service is agreed on between the developer and the assessor"), and it repeats: "All applications must be revalidated every year."
5. **After approval.** Keep the project's Owner and Editor accounts and its contacts current; Google emails when recertification is due ("must be reverified for compliance and complete a security assessment at least every 12 months" once an assessment applies). Get approval for any new scope before the app asks for it.

### How users are capped until it passes

| Project and state | Who can sign in |
| --- | --- |
| "Hermit Dev", Testing | Only its listed test users (at most 100 for the project's life); each grant ends seven days after consent |
| "Hermit", Testing | The same, with its own test users |
| "Hermit", published, not verified | Anyone, after Google's unverified-app screen, until 100 users in total have signed in; then new users can't until verification passes. The count never resets |
| "Hermit", verified | Anyone, with no warning screen |

## 6. How to test each account once its values are wired

Start from a build that has the values in `apps/mobile/src/dojo-config.ts`, compiled locally (Q154) and installed on the S26 Ultra. Leave every "own client ID" empty on **Settings** > **Sign-in options** (HM-CONN-05), so Dojo's values are the ones in use.

### Google (development project)

1. **Settings** > **Sign-in options** shows Google as available with Dojo's client.
2. Add a Gmail address on HM-MAIL-01. The system browser opens `accounts.google.com`. Tap its address bar: `client_id` is the development client ID and `redirect_uri` is `io.dojocoding.hermit:/oauth2redirect`.
3. Google shows its unverified-app screen ("Google hasn't verified this app"): expected in Testing. Continue. The consent screen lists Gmail access. Allow.
4. The browser hands back to Hermit and the account appears with its address. Ask "what's new in my inbox?", then "send a test email to <your address>": the approval sheet appears, the fingerprint approves it, and the email arrives.
5. Disconnect the account: Hermit deletes the tokens and revokes them at Google. [myaccount.google.com/connections](https://myaccount.google.com/connections) no longer lists "Hermit Dev".
6. Google Calendar and Google Drive: connect each from **Connections** (HM-CONN-01) and run one read; for Calendar, also add an event and delete it.
7. Seven days later Gmail asks you to sign in again. That is Testing working as Google describes.

If it fails:

| What you see | Likely cause |
| --- | --- |
| `Error 400: invalid_request` saying the custom URI scheme is not enabled | 2.1 step 7 not done, or not yet in effect |
| "Access blocked" because the app hasn't completed Google's verification | Your address isn't a test user (2.1 step 4) |
| `redirect_uri_mismatch` | The package name on the client isn't `io.dojocoding.hermit`, or the build sends another redirect |
| The browser stays on Google after consent | The build doesn't declare the `io.dojocoding.hermit` scheme yet (section 3) |

### Microsoft

1. Add an outlook.com or hotmail.com address on HM-MAIL-01. The browser opens `login.microsoftonline.com/common/...` with `client_id` set to Dojo's Application (client) ID.
2. The consent screen lists the permissions from 2.2 and marks Hermit as unverified (until Q166). Accept. The browser returns through `hermit://oauth/microsoft` and the account appears.
3. Read and send a test email as for Gmail. Then connect Outlook Calendar and OneDrive from **Connections** and run one read each.
4. Optional: a work account from a Microsoft 365 test tenant. A "Need admin approval" screen means that tenant only lets users consent to verified publishers (Q166).

If it fails:

| What you see | Likely cause |
| --- | --- |
| `AADSTS50011` (the reply URL doesn't match) | `hermit://oauth/microsoft` is missing, or was added under another platform |
| `AADSTS7000218` (a client secret is required) | The redirect was registered as **Web**: Microsoft treats a **Mobile and desktop applications** redirect as a public client and a **Web** one as confidential |
| `AADSTS700016` (application not found) | Wrong client ID, or the registration isn't set to **Any Entra ID Tenant + Personal Microsoft accounts** |

### The relay

1. From any computer: `curl https://relay.dojocoding.io/healthz` answers `ok`, and `/v1/providers` lists each provider with its client ID and the callback `https://relay.dojocoding.io/v1/callback`.
2. In the app: **Settings** > **Sign-in options** shows Dojo's relay, off. Turn it on: the note says what Dojo sees. **Settings** > **Privacy** (HM-SET-02) now lists `relay.dojocoding.io`.
3. Connect GitHub from **Connections**, through Dojo's relay. GitHub's page names "Hermit" and the DojoCodingLabs organization. After you authorize, the browser goes to the relay and on to `hermit://oauth/relay`, and Hermit shows GitHub as connected. Ask "what issues are assigned to me on GitHub?".
4. On the server, `journalctl -u hermit-relay` shows one line per request (the route, the status, the provider and the time) and no code, token or address. Caddy wrote no access log.
5. Repeat step 3 for Slack and Notion if you created their apps.

### The spec-signing key

Nothing on the phone uses it until specs ship as data (US-CONN-11). Once `DOJO_SPEC_PUBLIC_KEY` is wired, the maintainers add a test that a spec signed with the seed is trusted as "signed" and that the same spec with one byte changed is "untrusted"; you run the signing step on the offline Mac, so the seed never leaves it.

### The release key and the production Google client

1. After release signing is wired, build a release APK and run `apksigner verify --print-certs <the APK>`: the certificate's SHA-256 matches the one from `keytool -list -v` in 2.4.
2. Install that build and sign in to Gmail as above: the address bar shows the **production** client ID, and the consent screen names "Hermit" with its logo once Google has verified the branding.
3. After Google approves the scopes, a Google account that is not a test user signs in with no unverified-app screen.

### Spotify (only if Q165 says to create the app)

An allowlisted user connects Spotify from **Connections** and asks "what's playing?". A user not on the list gets an error, since Spotify answers `403` for them.

## Sources

Checked on 2026-11-21.

Google:

- OAuth 2.0 for Mobile & Desktop Apps: https://developers.google.com/identity/protocols/oauth2/native-app
- Improving user safety in OAuth flows through new OAuth custom URI scheme restrictions (2023): https://developers.googleblog.com/en/improving-user-safety-in-oauth-flows-through-new-oauth-custom-uri-scheme-restrictions/
- Authorize access to Google user data (Android): https://developer.android.com/identity/authorization
- OAuth 2.0 Policies: https://developers.google.com/identity/protocols/oauth2/policies
- Using OAuth 2.0 to access Google APIs (refresh token expiry): https://developers.google.com/identity/protocols/oauth2
- Create a Google Cloud project: https://developers.google.com/workspace/guides/create-project
- Enable Google Workspace APIs: https://developers.google.com/workspace/guides/enable-apis
- Configure the OAuth consent screen: https://developers.google.com/workspace/guides/configure-oauth-consent
- Create access credentials: https://developers.google.com/workspace/guides/create-credentials
- Get started with the Google Auth Platform: https://support.google.com/cloud/answer/15544987
- Manage App Audience: https://support.google.com/cloud/answer/15549945
- Manage OAuth Clients (the AI agent setting): https://support.google.com/cloud/answer/15549257
- Unverified apps: https://support.google.com/cloud/answer/7454865
- Verification requirements: https://support.google.com/cloud/answer/13464321
- When is verification not needed: https://support.google.com/cloud/answer/13464323
- Restricted scopes: https://support.google.com/cloud/answer/13464325
- Security assessment: https://support.google.com/cloud/answer/13465431
- Changes to approved app: https://support.google.com/cloud/answer/13464018
- Verification FAQ: https://support.google.com/cloud/answer/13463817
- Restricted scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Sensitive scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- Choose Gmail API scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Choose Google Drive API scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google Calendar API scopes: https://developers.google.com/workspace/calendar/api/auth
- Google Workspace API user data and developer policy: https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Google API Services User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- Authenticating your client (keytool): https://developers.google.com/android/guides/client-auth
- Search Console ownership verification: https://support.google.com/webmasters/answer/9008080

Android and Google Play:

- Sign your app: https://developer.android.com/studio/publish/app-signing
- Use Play App Signing: https://support.google.com/googleplay/android-developer/answer/9842756
- apksigner: https://developer.android.com/tools/apksigner
- React Native, publishing to Google Play (keytool command): https://reactnative.dev/docs/signed-apk-android

Microsoft:

- Register an application: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app
- How to add a redirect URI: https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri
- Redirect URI restrictions: https://learn.microsoft.com/en-us/entra/identity-platform/reply-url
- Configure a mobile app that calls web APIs: https://learn.microsoft.com/en-us/entra/identity-platform/scenario-mobile-app-registration
- Public client and confidential client applications: https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications
- Error AADSTS7000218: https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/confidential-client-application-authentication-error-aadsts7000218
- Microsoft Graph permissions reference: https://learn.microsoft.com/en-us/graph/permissions-reference
- Configure how users consent to applications: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent
- Publisher verification: https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview
- Mark an app as publisher verified: https://learn.microsoft.com/en-us/entra/identity-platform/mark-app-as-publisher-verified
- Configure an app's publisher domain: https://learn.microsoft.com/en-us/entra/identity-platform/howto-configure-publisher-domain

Relay host and providers:

- Caddy install: https://caddyserver.com/docs/install
- Caddy reverse_proxy (forwarded headers): https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy log directive: https://caddyserver.com/docs/caddyfile/directives/log
- Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https
- Keep Caddy running: https://caddyserver.com/docs/running
- Node.js 24 downloads and checksums: https://nodejs.org/dist/latest-v24.x/
- pnpm installation: https://pnpm.io/installation
- systemd.exec (EnvironmentFile, the warning on secrets): https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html
- Render logs (HTTP request logs on Pro workspaces): https://render.com/docs/logging
- GitHub, creating an OAuth app: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- Slack, installing with OAuth: https://docs.slack.dev/authentication/installing-with-oauth
- Slack, distributing your app: https://docs.slack.dev/distribution
- Notion, authorization: https://developers.notion.com/docs/authorization
- Notion, public integrations: https://developers.notion.com/guides/connections-and-tokens/public-integrations/overview

Spotify:

- Quota modes: https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- Redirect URIs: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- Apps: https://developer.spotify.com/documentation/web-api/concepts/apps
- Update on developer access and platform security (February 2026): https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security

Keys:

- YubiKey 5.7 firmware (Ed25519 in PIV): https://docs.yubico.com/hardware/yubikey/yk-tech-manual/5.7-firmware-specifics.html
