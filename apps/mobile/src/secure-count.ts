/**
 * SL-33: FLAG_SECURE as a reference count. Each focused vault screen holds it; the flag turns on at the first hold and
 * off only when the last one is released. Going from the list to an item focuses the item before the list blurs, so a
 * plain on/off per screen would turn the flag off on the item. Pure, so it is tested on Node.
 */
export function createSecureCounter(set: (on: boolean) => void) {
  let held = 0;
  return {
    acquire(): () => void {
      if (held++ === 0) set(true);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--held === 0) set(false);
      };
    },
    held: () => held,
  };
}
