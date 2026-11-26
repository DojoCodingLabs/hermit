/**
 * One turn at a time in the chat (US-CHAT-06). Send and Seguir each start a turn only while none runs. The screen's
 * `busy` arrives with the next render, so two taps before it both passed a check on it (review 2026-11-25: a double tap
 * on Seguir ran two model calls into one bubble, and Stop reached only the second). The slot is the screen's own ref,
 * taken before anything else happens, so the second tap finds it held.
 */
export type TurnSlot = { current: AbortController | undefined };

/** The new turn's stop switch, or undefined while another turn holds the slot. */
export function startTurn(slot: TurnSlot): AbortController | undefined {
  if (slot.current) return undefined;
  slot.current = new AbortController();
  return slot.current;
}

/** Frees the slot, only while this turn still holds it. */
export function endTurn(slot: TurnSlot, turn: AbortController): void {
  if (slot.current === turn) slot.current = undefined;
}
