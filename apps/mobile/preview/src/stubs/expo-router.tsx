// Preview only: expo-router's surface the screens use. Navigation is recorded, never performed: each shot is one screen.
import { Children, Component, cloneElement, createContext, isValidElement, useContext, useEffect, useMemo, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { scene } from "../scene";

/** Filled by main.tsx: route name to its default export from src/app. */
export const screens: Record<string, ComponentType> = {};

export type Href = string | { pathname: string; params?: Record<string, string> };

const nav = (kind: string) => (href?: unknown) => {
  (window as unknown as { __nav?: unknown[] }).__nav ??= [];
  (window as unknown as { __nav: unknown[] }).__nav.push([kind, href]);
};

export const router = {
  push: nav("push"),
  replace: nav("replace"),
  navigate: nav("navigate"),
  back: nav("back"),
  dismiss: nav("dismiss"),
  dismissAll: nav("dismissAll"),
  canGoBack: () => true,
  setParams: nav("setParams"),
};

export function useRouter() {
  return router;
}

export function useLocalSearchParams<T>(): T {
  return scene.params as T;
}
export const useGlobalSearchParams = useLocalSearchParams;

export function useNavigation() {
  return { setOptions: () => {}, addListener: () => () => {}, goBack: () => {}, canGoBack: () => true };
}

/** Focus effects run once, as on the first focus of the screen. */
export function useFocusEffect(effect: () => void | (() => void)) {
  useEffect(() => effect(), [effect]);
}

export function Redirect({ href }: { href: Href }) {
  return <Text style={{ padding: 24, color: "#c00" }}>[preview] Redirect to {typeof href === "string" ? href : href.pathname}</Text>;
}

export function Link({ href, asChild, children, ...rest }: { href: Href; asChild?: boolean; children: ReactNode; [k: string]: unknown }) {
  const onPress = () => router.push(href);
  if (asChild && isValidElement(children)) return cloneElement(children as ReactElement<{ onPress?: () => void }>, { onPress });
  return (
    <Text onPress={onPress} {...rest}>
      {children}
    </Text>
  );
}

// The stack: the real root layout renders <Stack screenOptions><Stack.Screen name options/>...</Stack>; this one
// renders only the shot's screen, under a header drawn like Android's native-stack header (back arrow, title).
export interface HeaderOptions {
  title?: string;
  headerShown?: boolean;
  headerBackVisible?: boolean;
  headerStyle?: { backgroundColor?: string };
  headerTintColor?: string;
  contentStyle?: { backgroundColor?: string };
  [k: string]: unknown;
}
const HeaderCtx = createContext<{ set(o: HeaderOptions): void } | null>(null);

function Screen({ options }: { name?: string; options?: HeaderOptions }) {
  const ctx = useContext(HeaderCtx);
  const key = JSON.stringify(options ?? {});
  useEffect(() => {
    if (options) ctx?.set(options);
  }, [key]);
  return null;
}

/** A screen that throws shows the error in place, so the shot records it instead of a blank page. */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    (window as unknown as { __errors?: string[] }).__errors?.push(`render: ${error.stack ?? error.message}`);
  }
  render() {
    if (this.state.error) return <Text style={{ color: "#c00", padding: 16, fontSize: 12 }}>[preview] render error: {String(this.state.error.message)}</Text>;
    return this.props.children;
  }
}

export function Stack({ screenOptions, children }: { screenOptions?: HeaderOptions; children?: ReactNode }) {
  let fromLayout: HeaderOptions = {};
  Children.forEach(children, (c) => {
    if (isValidElement(c) && (c.props as { name?: string }).name === scene.screen) fromLayout = (c.props as { options?: HeaderOptions }).options ?? {};
  });
  const [own, setOwn] = useState<HeaderOptions>({});
  const o: HeaderOptions = { ...screenOptions, ...fromLayout, ...own };
  const ScreenComponent = screens[scene.screen];
  const ctx = useMemo(() => ({ set: (next: HeaderOptions) => setOwn((prev) => ({ ...prev, ...next })) }), []);
  return (
    <HeaderCtx.Provider value={ctx}>
      <View style={{ flex: 1, backgroundColor: o.contentStyle?.backgroundColor }}>
        {o.headerShown === false ? null : (
          <View style={{ height: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 24, backgroundColor: o.headerStyle?.backgroundColor }}>
            {scene.screen !== "index" && o.headerBackVisible !== false ? <Text style={{ color: o.headerTintColor, fontSize: 24, lineHeight: 24 }}>{"\u2190"}</Text> : null}
            <Text numberOfLines={1} style={{ color: o.headerTintColor, fontSize: 20, fontWeight: "500", flexShrink: 1 }}>{o.title ?? scene.screen}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>{ScreenComponent ? <Boundary><ScreenComponent /></Boundary> : <Text>[preview] no screen {scene.screen}</Text>}</View>
      </View>
    </HeaderCtx.Provider>
  );
}
Stack.Screen = Screen;

export const Slot = () => null;
