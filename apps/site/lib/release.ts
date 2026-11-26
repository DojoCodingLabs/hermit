/**
 * HM-SITE-03: what the download page shows, the latest preview APK on GitHub Releases. For each new release, copy
 * these from its release notes (CONTRIBUTING.md, For maintainers); `pnpm --filter @hermit/site check` refuses a
 * published release with an empty field. With `published` false, every field is a placeholder and the page says so.
 */
import { REPO_URL } from "./site-config.mjs";

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

const TAG = "v0.1.0-preview.1";
const FILE = "hermit-0.1.0-preview.1.apk";

export const RELEASE: Release = {
  published: true,
  file: FILE,
  url: `${REPO_URL}/releases/download/${TAG}/${FILE}`,
  sha256: "7ae83b9f17f91efd12cf93036053c0136689fe0e91ae6ec6808f63a766767064",
  certSha256: "0b5d8f2482ee37c00bfe106f613d11349956d55125f73ec7f6a670233b3c7cd7",
  recipeUrl: `${REPO_URL}/blob/${TAG}/docs/devices.md#or-build-it-yourself`,
};
