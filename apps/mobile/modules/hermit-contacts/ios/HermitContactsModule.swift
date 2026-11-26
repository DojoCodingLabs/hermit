import ExpoModulesCore

/** On iOS, for now: the phone's contacts are never read here. Permission reads as denied, and entries rejects. */
public class HermitContactsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermitContacts")

    AsyncFunction("getPermission") { () -> [String: Any] in
      return ["status": "denied", "granted": false, "canAskAgain": false]
    }

    AsyncFunction("requestPermission") { () -> [String: Any] in
      return ["status": "denied", "granted": false, "canAskAgain": false]
    }

    AsyncFunction("entries") { () -> String in
      throw Exception(name: "ContactsUnavailable", description: "Contacts are not available on iOS yet.", code: "ERR_UNAVAILABLE")
    }
  }
}
