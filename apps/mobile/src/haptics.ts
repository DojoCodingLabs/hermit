// Touch feedback (docs/design/polish/decisions.md, "Haptics"): the system's own constants through the local
// hermit-haptics module, which needs no permission and follows the phone's "Touch feedback" setting. A no-op where the
// module isn't built in (the preview, an older build) and never throws: feedback must not break an action.
import { HermitHaptics } from "../modules/hermit-haptics";

export type Haptic = "confirm" | "reject" | "tick";

/** confirm: an approval went through. reject: the user said no. tick: a primary press, a segment changing. */
export function haptic(kind: Haptic): void {
  try {
    void HermitHaptics?.perform(kind).catch(() => {});
  } catch {
    // A missing or failing module changes nothing.
  }
}
