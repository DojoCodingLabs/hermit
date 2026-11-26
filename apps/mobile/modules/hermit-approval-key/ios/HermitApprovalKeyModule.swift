import ExpoModulesCore

/**
 On iOS, for now: the approval key that signs money and login approvals FAILS CLOSED here.

 There is no Secure Enclave key yet, so this module never creates, stores or reports a key, and never signs, with a
 software key or any other. `state()` says no key can be made ("no_biometric"), `enroll()` and `sign()` always reject,
 and `destroy()` has nothing to delete. Payments and logins therefore stay blocked on iOS, as the cage's hard limits
 require.
 */
public class HermitApprovalKeyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermitApprovalKey")

    AsyncFunction("state") { () -> [String: Any] in
      return ["state": "no_biometric"]
    }

    AsyncFunction("enroll") { (_: String, _: String) -> [String: Any] in
      throw Exception(name: "ApprovalKeyUnavailable", description: "No approval key on iOS yet.", code: "no_biometric")
    }

    AsyncFunction("sign") { (_: String, _: String) -> String in
      throw Exception(name: "ApprovalKeyUnavailable", description: "No approval key on iOS yet.", code: "no_biometric")
    }

    AsyncFunction("destroy") { () in
      // Nothing was ever made, so there is nothing to delete.
    }
  }
}
