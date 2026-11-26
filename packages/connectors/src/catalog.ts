import { specHash, verifySpecSignature, type ConnectorSpec, type OperationSpec, type SpecTrust } from "./spec.ts";

/*
 * Built-in connectors (US-CONN-01). Data only: each is a CT-12 spec run by the one runtime. These ship inside
 * the app, so the app's own signature covers them; specs delivered later as data (US-CONN-11) carry Dojo's
 * signature (FR-CONN-01). Mail is not here: mail accounts are SL-48.
 *
 * Endpoints are written from each provider's API reference and must be checked against it again before
 * release; the phone check exercises one read and one write per connector.
 */

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const int = (description: string, maximum: number) => ({ type: "integer", description, minimum: 1, maximum });

const read = (op: Omit<OperationSpec, "sideEffects" | "effect" | "destructive" | "idempotent" | "risk" | "method"> & { method?: "GET" | "POST" }): OperationSpec => ({
  method: "GET", sideEffects: [], effect: "read", destructive: false, idempotent: true, risk: "network", ...op,
});

const GOOGLE_CAL = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_CAL_READ = "https://www.googleapis.com/auth/calendar.events.readonly";
const LOCAL_TIME = "Date and time with offset, RFC 3339, e.g. 2026-11-15T09:00:00-06:00";

const googleCalendar: ConnectorSpec = {
  id: "google_calendar",
  version: 1,
  name: "Google Calendar",
  hosts: ["www.googleapis.com"],
  auth: [{ type: "oauth2_pkce", provider: "google" }],
  origin: "shipped",
  operations: [
    read({
      name: "list_events",
      title: "List events",
      description: "List events in the user's Google Calendar between two times (\"what's on my Google Calendar tomorrow\"). Use calendarId \"primary\" unless the user names another calendar.",
      path: "/calendar/v3/calendars/{calendarId}/events",
      inputSchema: obj({
        calendarId: str("Calendar ID, \"primary\" for the main one", { maxLength: 200 }),
        timeMin: str(`Range start. ${LOCAL_TIME}`),
        timeMax: str(`Range end. ${LOCAL_TIME}`),
        q: str("Words to search for in events", { maxLength: 100 }),
        singleEvents: { type: "boolean", description: "Expand recurring events; keep true" },
        orderBy: { type: "string", enum: ["startTime"], description: "Order by start time (needs singleEvents)" },
        maxResults: int("At most this many events", 50),
      }, ["calendarId", "timeMin", "timeMax"]),
      scopes: [GOOGLE_CAL_READ],
      domain: "calendar",
    }),
    {
      name: "create_event",
      title: "Add an event",
      description: "Add an event to the user's Google Calendar. Creates a new event each time it runs, so a retry duplicates it.",
      sideEffects: ["creates"],
      method: "POST",
      path: "/calendar/v3/calendars/{calendarId}/events",
      inputSchema: obj({
        calendarId: str("Calendar ID, \"primary\" for the main one", { maxLength: 200 }),
        summary: str("Event title", { maxLength: 200 }),
        start: str(`Start. ${LOCAL_TIME}`),
        end: str(`End. ${LOCAL_TIME}`),
        location: str("Where", { maxLength: 200 }),
        description: str("Notes", { maxLength: 2000 }),
      }, ["calendarId", "summary", "start", "end"]),
      body: { summary: "summary", "start.dateTime": "start", "end.dateTime": "end", location: "location", description: "description" },
      scopes: [GOOGLE_CAL],
      effect: "write",
      destructive: false,
      idempotent: false,
      domain: "calendar",
      risk: "remote_write",
    },
    {
      name: "delete_event",
      title: "Delete an event",
      description: "Delete one event from the user's Google Calendar by its event ID (from list_events).",
      sideEffects: ["deletes"],
      method: "DELETE",
      path: "/calendar/v3/calendars/{calendarId}/events/{eventId}",
      inputSchema: obj({ calendarId: str("Calendar ID", { maxLength: 200 }), eventId: str("Event ID from list_events", { maxLength: 200 }) }, ["calendarId", "eventId"]),
      scopes: [GOOGLE_CAL],
      effect: "delete",
      destructive: true,
      idempotent: true,
      domain: "calendar",
      risk: "remote_write",
    },
  ],
  transforms: [
    { kind: "pick_fields", operation: "list_events", list: "items", fields: ["id", "summary", "start.dateTime", "start.date", "end.dateTime", "end.date", "location"] },
  ],
};

const googleDrive: ConnectorSpec = {
  id: "google_drive",
  version: 1,
  name: "Google Drive",
  hosts: ["www.googleapis.com"],
  auth: [{ type: "oauth2_pkce", provider: "google" }],
  origin: "shipped",
  operations: [
    read({
      name: "search_files",
      title: "Search files",
      description: "Find files in the user's Google Drive by name or text (\"find my lease in Drive\"). q is a Drive query such as: name contains 'lease'.",
      path: "/drive/v3/files",
      inputSchema: obj({ q: str("Drive search query, e.g. name contains 'lease'", { maxLength: 300 }), pageSize: int("At most this many files", 50) }, ["q"]),
      scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
      domain: "files",
    }),
  ],
  transforms: [{ kind: "pick_fields", operation: "search_files", list: "files", fields: ["id", "name", "mimeType"] }],
};

const GRAPH_LOCAL = "Local date and time, e.g. 2026-11-15T09:00:00";

const outlookCalendar: ConnectorSpec = {
  id: "outlook_calendar",
  version: 1,
  name: "Outlook Calendar",
  hosts: ["graph.microsoft.com"],
  auth: [{ type: "oauth2_pkce", provider: "microsoft" }],
  origin: "shipped",
  operations: [
    read({
      name: "list_events",
      title: "List events",
      description: "List events in the user's Outlook calendar between two times (\"what's on my Outlook calendar on Friday\").",
      path: "/v1.0/me/calendarView",
      inputSchema: obj({ startDateTime: str(`Range start. ${LOCAL_TIME}`), endDateTime: str(`Range end. ${LOCAL_TIME}`) }, ["startDateTime", "endDateTime"]),
      scopes: ["Calendars.Read", "offline_access"],
      domain: "calendar",
    }),
    {
      name: "create_event",
      title: "Add an event",
      description: "Add an event to the user's Outlook calendar. Creates a new event each time it runs, so a retry duplicates it.",
      sideEffects: ["creates"],
      method: "POST",
      path: "/v1.0/me/events",
      inputSchema: obj({
        subject: str("Event title", { maxLength: 200 }),
        start: str(`Start. ${GRAPH_LOCAL}`),
        end: str(`End. ${GRAPH_LOCAL}`),
        timeZone: str("IANA time zone of start and end, e.g. America/Costa_Rica", { maxLength: 60 }),
      }, ["subject", "start", "end", "timeZone"]),
      body: { subject: "subject", "start.dateTime": "start", "start.timeZone": "timeZone", "end.dateTime": "end", "end.timeZone": "timeZone" },
      scopes: ["Calendars.ReadWrite", "offline_access"],
      effect: "write",
      destructive: false,
      idempotent: false,
      domain: "calendar",
      risk: "remote_write",
    },
  ],
  transforms: [
    { kind: "pick_fields", operation: "list_events", list: "value", fields: ["id", "subject", "start.dateTime", "end.dateTime", "location.displayName"] },
  ],
};

const onedrive: ConnectorSpec = {
  id: "onedrive",
  version: 1,
  name: "OneDrive",
  hosts: ["graph.microsoft.com"],
  auth: [{ type: "oauth2_pkce", provider: "microsoft" }],
  origin: "shipped",
  operations: [
    read({
      name: "recent_files",
      title: "Recent files",
      description: "List the files the user opened or changed recently in OneDrive (\"my recent OneDrive files\").",
      path: "/v1.0/me/drive/recent",
      inputSchema: obj({}),
      scopes: ["Files.Read", "offline_access"],
      domain: "files",
    }),
  ],
  transforms: [{ kind: "pick_fields", operation: "recent_files", list: "value", fields: ["id", "name", "lastModifiedDateTime", "webUrl"] }],
};

const spotify: ConnectorSpec = {
  id: "spotify",
  version: 1,
  name: "Spotify",
  hosts: ["api.spotify.com"],
  auth: [{ type: "oauth2_pkce", provider: "spotify" }],
  origin: "shipped",
  operations: [
    read({
      name: "now_playing",
      title: "What's playing",
      description: "Say what is playing on the user's Spotify right now (\"what song is this\", \"¿qué está sonando?\").",
      path: "/v1/me/player/currently-playing",
      inputSchema: obj({}),
      scopes: ["user-read-currently-playing"],
      domain: "music",
    }),
    read({
      name: "search",
      title: "Search music",
      description: "Search Spotify for tracks, artists, albums or playlists.",
      path: "/v1/search",
      inputSchema: obj({
        q: str("What to search for", { maxLength: 200 }),
        type: { type: "string", enum: ["track", "artist", "album", "playlist"], description: "What kind of item" },
        limit: int("At most this many results", 20),
      }, ["q", "type"]),
      scopes: ["user-read-private"],
      domain: "music",
    }),
    {
      name: "pause",
      title: "Pause playback",
      description: "Pause the music playing on the user's Spotify. Running it twice is harmless.",
      sideEffects: ["updates"],
      method: "PUT",
      path: "/v1/me/player/pause",
      inputSchema: obj({}),
      scopes: ["user-modify-playback-state"],
      effect: "write",
      destructive: false,
      idempotent: true,
      domain: "music",
      risk: "remote_write",
    },
  ],
  transforms: [{ kind: "pick_fields", operation: "now_playing", fields: ["is_playing", "item.name", "item.artists", "item.album.name"] }],
};

const github: ConnectorSpec = {
  id: "github",
  version: 1,
  name: "GitHub",
  hosts: ["api.github.com"],
  // A fine-grained personal access token works with no relay; OAuth needs a client secret (PDR-022).
  auth: [{ type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " }, { type: "relay", provider: "github" }],
  origin: "shipped",
  operations: [
    read({
      name: "my_issues",
      title: "My issues",
      description: "List the GitHub issues and pull requests assigned to the user.",
      path: "/issues",
      inputSchema: obj({ state: { type: "string", enum: ["open", "closed", "all"], description: "Which issues" }, per_page: int("At most this many", 50) }),
      scopes: ["repo"],
      domain: "code",
    }),
    {
      name: "create_issue",
      title: "Open an issue",
      description: "Open a new issue in a GitHub repository. Watchers are notified; a retry opens a duplicate.",
      sideEffects: ["creates"],
      method: "POST",
      path: "/repos/{owner}/{repo}/issues",
      inputSchema: obj({
        owner: str("Repository owner", { maxLength: 100 }),
        repo: str("Repository name", { maxLength: 100 }),
        title: str("Issue title", { maxLength: 200 }),
        body: str("Issue text", { maxLength: 5000 }),
      }, ["owner", "repo", "title"]),
      body: { title: "title", body: "body" },
      scopes: ["repo"],
      effect: "write",
      destructive: false,
      idempotent: false,
      domain: "code",
      risk: "remote_write",
    },
  ],
  transforms: [
    { kind: "static_header", name: "Accept", value: "application/vnd.github+json" },
    { kind: "static_header", name: "X-GitHub-Api-Version", value: "2022-11-28" },
    { kind: "pick_fields", operation: "my_issues", fields: ["number", "title", "state", "repository.full_name", "html_url"] },
  ],
};

const notion: ConnectorSpec = {
  id: "notion",
  version: 1,
  name: "Notion",
  hosts: ["api.notion.com"],
  auth: [{ type: "relay", provider: "notion" }, { type: "api_key", in: "header", name: "Authorization", prefix: "Bearer " }],
  origin: "shipped",
  operations: [
    // Notion's search is a POST that changes nothing; allowed as a read because this spec is shipped and reviewed.
    read({
      name: "search",
      title: "Search pages",
      description: "Search the user's Notion pages and databases by title.",
      method: "POST",
      path: "/v1/search",
      inputSchema: obj({ query: str("Words in the title", { maxLength: 200 }), page_size: int("At most this many", 50) }, ["query"]),
      scopes: ["read_content"],
      domain: "notes",
    }),
    read({
      name: "get_page",
      title: "Read a page",
      description: "Read the properties of one Notion page by its ID (from search).",
      path: "/v1/pages/{page_id}",
      inputSchema: obj({ page_id: str("Page ID from search", { maxLength: 100 }) }, ["page_id"]),
      scopes: ["read_content"],
      domain: "notes",
    }),
  ],
  transforms: [
    { kind: "static_header", name: "Notion-Version", value: "2022-06-28" },
    { kind: "pick_fields", operation: "search", list: "results", fields: ["id", "object", "url", "last_edited_time"] },
  ],
};

const slack: ConnectorSpec = {
  id: "slack",
  version: 1,
  name: "Slack",
  hosts: ["slack.com"],
  auth: [{ type: "relay", provider: "slack" }],
  origin: "shipped",
  operations: [
    read({
      name: "list_channels",
      title: "List channels",
      description: "List the Slack channels the user is in, with their IDs.",
      path: "/api/conversations.list",
      inputSchema: obj({ limit: int("At most this many", 200) }),
      scopes: ["channels:read"],
      domain: "messaging",
    }),
    {
      name: "post_message",
      title: "Post a message",
      description: "Post a message to a Slack channel in the user's name. Everyone in the channel sees it; a retry posts it twice.",
      sideEffects: ["sends"],
      method: "POST",
      path: "/api/chat.postMessage",
      inputSchema: obj({ channel: str("Channel ID from list_channels", { maxLength: 40 }), text: str("Message text", { maxLength: 4000 }) }, ["channel", "text"]),
      scopes: ["chat:write"],
      effect: "write",
      destructive: false,
      idempotent: false,
      domain: "messaging",
      risk: "send",
    },
  ],
  transforms: [{ kind: "pick_fields", operation: "list_channels", list: "channels", fields: ["id", "name"] }],
};

export const builtInCatalog: readonly ConnectorSpec[] = [googleCalendar, googleDrive, outlookCalendar, onedrive, spotify, github, notion, slack];

export function catalogSpec(id: string): ConnectorSpec | undefined {
  return builtInCatalog.find((s) => s.id === id);
}

const bundledHashes = new Set(builtInCatalog.map(specHash));

/**
 * The caller-side provenance check (FR-CONN-01): a spec is "bundled" when its hash is one the app ships,
 * "signed" when its signature verifies against Dojo Coding's key, and "untrusted" otherwise, whatever its
 * own `origin` field says.
 */
export function specTrust(spec: ConnectorSpec, dojoPublicKey?: Uint8Array): SpecTrust {
  if (bundledHashes.has(specHash(spec))) return "bundled";
  if (dojoPublicKey && verifySpecSignature(spec, dojoPublicKey)) return "signed";
  return "untrusted";
}
