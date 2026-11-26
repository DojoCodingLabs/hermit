// Preview only: apps/mobile/modules/*. The native browser view can't render in a browser page; it shows as a
// labelled placeholder of the same size, so the screen's own chrome around it is what the shot shows.
import { forwardRef, useImperativeHandle } from "react";
import { Text, View } from "react-native";

export const HermitBrowserView = forwardRef(function HermitBrowserView(props: { style?: unknown; [k: string]: unknown }, ref) {
  useImperativeHandle(ref, () => new Proxy({}, { get: () => () => Promise.resolve(undefined) }));
  return (
    <View style={[{ flex: 1, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#ccc" }, props.style as object]}>
      <Text style={{ color: "#888", fontSize: 13 }}>[preview: native WebView of the site]</Text>
    </View>
  );
});

export const HermitAutofill = {
  status: () => ({ supported: true, selected: false, serviceName: "Hermit" }),
  lastRequest: () => null,
  openSettings: () => {},
  pendingFill: () => null,
  completeFill: () => true,
  cancelFill: () => {},
};

// The polish round's touch feedback: nothing to feel in a browser, so the app's haptic() is a no-op here.
export const HermitHaptics = undefined;
