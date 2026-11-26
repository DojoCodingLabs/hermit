/**
 * Several requests in one message ("recuérdame mañana a las 9 llamar al banco y anota que mi cuenta es 1234"):
 * split at the conjunctions that start a new request. Shared by the router (one route per clause) and the
 * argument normalizers (each action keeps only its own clause; both once got the whole sentence).
 */
const CLAUSE = /\s*(?:,\s*)?(?:\by\s+(?:tambi[eé]n\s+)?|\band\s+(?:also\s+)?|;\s*|\.\s+)(?=(?:anota|apunta|recuerda|recu[eé]rdame|rec[oó]rdame|av[ií]same|agenda|pon|ponme|dile|dec[ií]le|olvida|borra|cancela|remember|note|remind|tell|text|add|put|schedule|forget|cancel|save)\b)/iu;

export function splitClauses(text: string): string[] {
  return text.split(CLAUSE).map((c) => c.trim()).filter(Boolean);
}
