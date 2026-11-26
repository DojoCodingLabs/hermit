/**
 * HM-SITE-03: what the download page shows. The signed APK on GitHub Releases isn't published yet,
 * so every field is a placeholder and the page says so. When the first release is out, fill these in from its
 * release notes and set `published` to true; `pnpm --filter @hermit/site check` refuses a published release
 * with an empty field.
 */
export interface Release {
  published: boolean;
  /** The APK's file name on the release. */
  file: string;
  /** The release page or the APK asset on GitHub Releases. */
  url: string | null;
  /** Lowercase hex SHA-256 of the APK. */
  sha256: string | null;
  /** SHA-256 of the signing certificate, as `apksigner verify --print-certs` prints it. */
  certSha256: string | null;
  /** Where the rebuild recipe lives. */
  recipeUrl: string | null;
}

export const RELEASE: Release = {
  published: false,
  file: "hermit.apk",
  url: null,
  sha256: null,
  certSha256: null,
  recipeUrl: null,
};
