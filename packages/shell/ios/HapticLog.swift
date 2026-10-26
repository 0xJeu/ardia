import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

enum HapticLog {
  private static let path: String? = {
    let env = ProcessInfo.processInfo.environment
    guard env["ARDIA_BACKGROUND"] == "1", let dir = env["ARDIA_DATA_DIR"] else { return nil }
    return (dir as NSString).appendingPathComponent("haptics.log")
  }()

  private static let queue = DispatchQueue(label: "ardia.haptic-log", qos: .utility)
  private static let maxBytes: UInt64 = 64 * 1024

  static func note(_ pattern: String) {
    guard let path else { return }
    let line = "\(Date()) \(pattern)\n"
    queue.async {
      guard let data = line.data(using: .utf8) else { return }
      guard let file = FileHandle(forWritingAtPath: path) else {
        FileManager.default.createFile(atPath: path, contents: data)
        return
      }
      defer { file.closeFile() }
      if file.seekToEndOfFile() < maxBytes { file.write(data) }
    }
  }
}
