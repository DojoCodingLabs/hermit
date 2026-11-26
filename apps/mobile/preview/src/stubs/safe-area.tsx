// Preview only: the shot is the app's window under the status bar, so the insets are zero.
import type { ReactNode } from "react";
import { View } from "react-native";

export function SafeAreaView({ children, edges: _e, ...rest }: { children?: ReactNode; edges?: unknown; [k: string]: unknown }) {
  return <View {...rest}>{children}</View>;
}
export const SafeAreaProvider = ({ children }: { children?: ReactNode }) => <>{children}</>;
export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
