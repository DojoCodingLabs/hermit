// US-SET-09: the optional app lock. The timing rules are pure (`@hermit/runtime` app-lock); this feeds
// them AppState and Hermit's own fingerprint prompts and draws the lock screen over everything.
// The tree under it stays mounted, so a running turn or a pending approval is never cancelled by a lock.
import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { AppState, Modal, ScrollView, View } from "react-native";
import { initialLock, lockReducer, type LockEvent, type LockState } from "@hermit/runtime";
import { appLockEnabled, confirmOwner, onPrompt, phoneSecurity, saveAppLock } from "./adapters";
import { Btn, Card, Empty, Note, Notice } from "./components/kit";
import { useHermit } from "./hermit-context";
import { t } from "./i18n";
import { s } from "./theme";
import { usePalette } from "./use-palette";

type Change = "ok" | "failed" | "no_security";

const Ctx = createContext<{ lock: LockState; setLockOn(on: boolean): Promise<Change> } | null>(null);

const reduce = (s: LockState, e: LockEvent) => lockReducer(s, e);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [lock, dispatch] = useReducer(reduce, undefined, () => initialLock(appLockEnabled()));

  useEffect(() => {
    // "inactive" (a system dialog, the recents screen) is not leaving the app; only "background" is.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") dispatch({ type: "background", at: Date.now() });
      else if (s === "active") dispatch({ type: "foreground", at: Date.now() });
    });
    const off = onPrompt((open) => dispatch({ type: open ? "prompt_open" : "prompt_close" }));
    return () => {
      sub.remove();
      off();
    };
  }, []);

  // Turning it on or off asks for the owner first, so someone holding an unlocked phone can't switch it off.
  const setLockOn = useCallback(async (on: boolean): Promise<Change> => {
    if (on && (await phoneSecurity()) === "none") return "no_security";
    if (!(await confirmOwner(t("HM-SET-01.lockPrompt")))) return "failed";
    await saveAppLock(on);
    dispatch({ type: on ? "enable" : "disable" });
    return "ok";
  }, []);

  // SL-33: the vault locks with the app lock, and on any trip to the background (the service lets its own
  // fingerprint prompt's brief trip through).
  const { status } = useHermit();
  const vault = status.kind === "ready" ? status.hermit.vault : undefined;
  useEffect(() => {
    if (lock.locked) vault?.event({ type: "app_locked" });
  }, [lock.locked, vault]);
  // SL-38: the wallet drops a pending word check or restore and stops its worklet with the app lock.
  const wallet = status.kind === "ready" ? status.hermit.wallet : undefined;
  useEffect(() => {
    if (lock.locked) wallet?.lock();
  }, [lock.locked, wallet]);
  useEffect(() => {
    if (!vault) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") vault.event({ type: "background", at: Date.now() });
      else if (s === "active") vault.event({ type: "foreground", at: Date.now() });
    });
    return () => sub.remove();
  }, [vault]);

  return (
    <Ctx.Provider value={{ lock, setLockOn }}>
      {children}
      {lock.locked ? <LockScreen onUnlocked={() => dispatch({ type: "unlocked" })} onNoSecurity={() => dispatch({ type: "disable" })} /> : null}
    </Ctx.Provider>
  );
}

export function useAppLock() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppLock must be used inside AppLockProvider");
  return v;
}

function LockScreen({ onUnlocked, onNoSecurity }: { onUnlocked(): void; onNoSecurity(): void }) {
  const p = usePalette();
  const { approvals } = useHermit();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"failed" | "no_security">();
  const [waiting, setWaiting] = useState(Boolean(approvals.current()));
  useEffect(() => approvals.subscribe((r) => setWaiting(Boolean(r))), [approvals]);

  const unlock = useCallback(async () => {
    setBusy(true);
    setNote(undefined);
    try {
      // The phone lost its fingerprint and screen lock: there is nothing to unlock with, and removing
      // the screen lock already took the owner's PIN, so the lock turns itself off and says so.
      if ((await phoneSecurity()) === "none") {
        await saveAppLock(false);
        setNote("no_security");
        setTimeout(onNoSecurity, 2500);
        return;
      }
      if (await confirmOwner(t("HM-SET-01.unlockPrompt"))) onUnlocked();
      else setNote("failed");
    } catch {
      setNote("failed");
    } finally {
      setBusy(false);
    }
  }, [onUnlocked, onNoSecurity]);

  // Ask once as the lock appears; after a cancel, the button asks again.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void unlock();
  }, [unlock]);

  // Design pass: the crab, the title and one line, an approval waiting as an amber notice, the result in words, and
  // Unlock with the fingerprint as the one action. The crab follows Quiet mode; the words say the same.
  return (
    <Modal visible animationType="none" onRequestClose={() => {}} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: p.bg }} accessibilityViewIsModal>
        {/* Scrolls at large text (up to 200%), so nothing is clipped or pushed off screen. */}
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: s.xxl }}>
          <Empty pose="idle" title={t("HM-SET-01.lockedTitle")} body={t("HM-SET-01.lockedBody")}>
            {waiting ? <Card tone="amber"><Note icon="fingerprint" tone="amber" text={t("HM-SET-01.lockedApproval")} textColor="text" /></Card> : null}
            {note ? <Notice tone={note === "failed" ? "bad" : "info"} text={t(note === "failed" ? "HM-SET-01.unlockFailed" : "HM-SET-01.unlockNoSecurity")} /> : null}
            <Btn label={t("HM-SET-01.unlock")} icon="fingerprint" full busy={busy} disabled={note === "no_security"} onPress={() => void unlock()} />
          </Empty>
        </ScrollView>
      </View>
    </Modal>
  );
}
