// The site's public settings, in one place. Pages, components, the brand copy and the checks all read these, so a
// change here is the whole change.

/** The public repository. Every link to the code is built from this one value. */
export const REPO_URL = "https://github.com/DojoCodingLabs/hermit";

/** The ref file links point at. `HEAD` follows the repository's default branch, whatever it is called. */
const REPO_REF = "HEAD";

/** A file in the repository, on its default branch. */
export const repoFile = (path) => `${REPO_URL}/blob/${REPO_REF}/${path}`;

/** A folder in the repository, on its default branch. */
export const repoTree = (path) => `${REPO_URL}/tree/${REPO_REF}/${path}`;

/** The site's address: canonical URLs, Open Graph tags and the sitemap. No trailing slash. */
export const SITE_URL = "https://joinhermit.com";

/**
 * The partners line: the Dojo Coding, QVAC and Tether logos, the signature ("Hermit, built by Dojo Coding...
 * Powered by QVAC... from Tether") and the not-affiliated line, in every footer. `false` removes all of it, stops
 * serving the QVAC and Tether logo files, and makes `pnpm --filter @hermit/site check` refuse any page that still
 * carries them.
 */
export const SHOW_PARTNERS = true;
