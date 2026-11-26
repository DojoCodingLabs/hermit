// The app's entry: Expo Router renders the screens, and the night shift's headless task is registered for
// NightService and the WorkManager worker (Q69). Registering a task renders nothing; it runs only when the
// native side starts it.
import "expo-router/entry";
import { AppRegistry } from "react-native";
import { nightHeadlessTask } from "./src/night-task";

AppRegistry.registerHeadlessTask("HermitNightShift", () => nightHeadlessTask);
