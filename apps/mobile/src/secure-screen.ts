import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { clearPendingCopy, secureScreen } from "./adapters";
import { createSecureCounter } from "./secure-count";

const secure = createSecureCounter((on) => void secureScreen(on));

/**
 * SL-33: while a vault screen is focused, FLAG_SECURE is on (no screenshots, recordings or Recents preview), counted
 * across screens so list -> item never leaves a gap. Leaving a vault screen inside Hermit also clears a copy still
 * waiting for its timer, so a password can't be pasted into the chat by accident (and from there reach the model).
 */
export function useSecureScreen() {
  useFocusEffect(
    useCallback(() => {
      const release = secure.acquire();
      return () => {
        release();
        void clearPendingCopy();
      };
    }, []),
  );
}
