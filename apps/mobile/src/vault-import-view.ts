import type { DuplicateChoice, ImportPreview } from "@hermit/core";

/**
 * SL-34 (US-VAULT-03): the pure parts of HM-VAULT-03, tested on Node. The screen only ever holds an ImportPreview
 * (names, sites, counts); the rows with their secrets stay inside the vault service.
 */

type Ready = ImportPreview["ready"][number];

/** The choices a row offers: none without a duplicate; replace only when exactly one saved login matches. */
export function choicesFor(row: Ready): DuplicateChoice[] {
  if (!row.existing.length) return [];
  return row.existing.length === 1 ? ["skip", "replace", "keep_both"] : ["skip", "keep_both"];
}

/** What the import will do with the user's choices (a duplicate without one is skipped, Q87). */
export function importCounts(preview: ImportPreview, choices: Readonly<Record<number, DuplicateChoice>>) {
  let toWrite = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const row of preview.ready) {
    if (!row.existing.length) {
      toWrite++;
      continue;
    }
    duplicates++;
    const choice = choices[row.row] ?? "skip";
    if (choice === "skip" || (choice === "replace" && row.existing.length !== 1)) skipped++;
    else toWrite++;
  }
  return { toWrite, duplicates, skipped, refused: preview.refused.length };
}

/** A size the provider reports over the cap is refused before reading; an unknown size is read up to the cap. */
export const pickedReadable = (picked: { size: number | null }, maxBytes: number) => picked.size === null || picked.size <= maxBytes;
