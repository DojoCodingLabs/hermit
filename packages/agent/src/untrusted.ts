/**
 * Wraps text other people wrote so the model treats it as data. Anything inside that
 * looks like a marker is defanged first, so the content can't close the wrapper early.
 */
export function wrapUntrusted(text: string, source: string, id: string): string {
  const safe = text.replace(/<(\/?)untrusted/gi, "‹$1untrusted");
  // "seal", not "id": next to a conversation id, BotPsy copied the wrapper's id into reply_message.
  return `<untrusted source="${source}" seal="${id}">\n${safe}\n</untrusted seal="${id}">`;
}
