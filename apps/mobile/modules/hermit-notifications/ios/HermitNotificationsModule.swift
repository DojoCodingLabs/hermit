import CryptoKit
import ExpoModulesCore
import UIKit

/**
 On iOS, for now: the phone facts the Device lab and the model download need. Read-only, no permission, nothing leaves
 the phone.

 iOS has no notification listener, so capture is off: `isEnabled` is false, the queue is empty and `reply` rejects.
 There are no cpusets either: `allowedCpus` and `chipFacts` throw, and the callers already treat that as unknown.
 `thermal().status` is the raw ProcessInfo.ThermalState (0 to 3); the app maps it onto Android's scale in JavaScript
 (src/platform-facts.ts).
 */
public class HermitNotificationsModule: Module {
  private static func sysctlInt(_ name: String) -> Int? {
    var value: Int32 = 0
    var size = MemoryLayout<Int32>.size
    guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }
    return Int(value)
  }

  private static func machine() -> String {
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { raw in
      String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
    }
  }

  private static func filePath(_ uri: String) -> String {
    if uri.hasPrefix("file://"), let url = URL(string: uri) {
      return url.path
    }
    return uri
  }

  public func definition() -> ModuleDefinition {
    Name("HermitNotifications")

    Events("onCapture")

    OnCreate {
      DispatchQueue.main.async {
        UIDevice.current.isBatteryMonitoringEnabled = true
      }
    }

    Function("isEnabled") { () -> Bool in
      return false
    }

    Function("openSettings") { () in
      // No notification listener on iOS: nothing to open.
    }

    AsyncFunction("drainQueue") { () -> [[String: Any]] in
      return []
    }

    AsyncFunction("reply") { (_: String, _: String) -> String in
      throw Exception(name: "ReplyUnavailable", description: "Replies are not available on iOS yet.", code: "ERR_UNAVAILABLE")
    }

    /// The model file's SHA-256, streamed in 1 MiB reads off the main thread (AsyncFunction runs on the module's queue).
    AsyncFunction("sha256File") { (uri: String) -> String in
      guard let handle = FileHandle(forReadingAtPath: HermitNotificationsModule.filePath(uri)) else {
        throw Exception(name: "Unreadable", description: "The file can't be read.", code: "ERR_UNREADABLE")
      }
      defer { try? handle.close() }
      var hasher = SHA256()
      while true {
        let chunk = try autoreleasepool { () -> Data? in try handle.read(upToCount: 1 << 20) }
        guard let data = chunk, !data.isEmpty else { break }
        hasher.update(data: data)
      }
      return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    AsyncFunction("hardwareFacts") { () -> [String: Any] in
      let model = HermitNotificationsModule.machine()
      let feature = { (name: String) -> Bool in HermitNotificationsModule.sysctlInt(name) == 1 }
      var facts: [String: Any] = [
        "clusters": [[String: Any]](),
        "logicalCores": ProcessInfo.processInfo.activeProcessorCount,
        "allowedCpus": [Int](),
        "totalRamBytes": Double(ProcessInfo.processInfo.physicalMemory),
        "isLowRamDevice": false,
        "soc": model,
        "model": model,
        "dotprod": feature("hw.optional.arm.FEAT_DotProd"),
        "i8mm": feature("hw.optional.arm.FEAT_I8MM"),
        "sve2": false,
        "sme2": feature("hw.optional.arm.FEAT_SME2"),
      ]
      if let p = HermitNotificationsModule.sysctlInt("hw.perflevel0.physicalcpu") {
        facts["performanceCores"] = p
      }
      return facts
    }

    Function("allowedCpus") { () throws -> [String: Any] in
      throw Exception(name: "Unsupported", description: "iOS has no cpusets.", code: "ERR_UNSUPPORTED")
    }

    Function("chipFacts") { () throws -> [String: Any] in
      throw Exception(name: "Unsupported", description: "No chip facts on iOS.", code: "ERR_UNSUPPORTED")
    }

    AsyncFunction("keepScreenOn") { (on: Bool) -> Bool in
      UIApplication.shared.isIdleTimerDisabled = on
      return true
    }.runOnQueue(.main)

    Function("thermal") { () -> [String: Any] in
      return [
        "status": ProcessInfo.processInfo.thermalState.rawValue,
        "headroom": Double.nan,
        "powerSave": ProcessInfo.processInfo.isLowPowerModeEnabled,
      ]
    }

    Function("power") { () -> [String: Any] in
      let device = UIDevice.current
      let level = device.batteryLevel
      return [
        "charging": device.batteryState == .charging || device.batteryState == .full,
        "batteryPercent": level < 0 ? -1 : Int((level * 100).rounded()),
        // The screen state isn't readable off the main thread here; "on" keeps the night shift waiting (fails closed).
        "screenOn": true,
      ]
    }
  }
}
