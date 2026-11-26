import ExpoModulesCore

/** On iOS, for now: other apps are never opened from here. `open` always rejects. */
public class HermitIntentsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermitIntents")

    AsyncFunction("open") { (_: String) -> [String: Any] in
      throw Exception(name: "IntentsUnavailable", description: "Opening other apps is not available on iOS yet.", code: "unsupported")
    }
  }
}
