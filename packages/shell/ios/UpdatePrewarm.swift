import AppKit
import ArdiaCore
import Sparkle

enum UpdatePrewarm {
  static let timeout: TimeInterval = 90
  static let installHold: TimeInterval = 15
  static let lastRunKey = "ACUpdatePrewarm"
  private static var started = Set<String>()
  private static var running: pid_t = 0
  private static var runningVersion: String?
  private static var generation = 0
  private static var afterRun: [() -> Void] = []
  private static var watchingQuit = false

  static func start(version: String) {
    guard !started.contains(version) else { return }
    started.insert(version)
    warm(version: version)
  }

  static func warm(version: String) {
    guard runningVersion != version, LaunchConfig.shared.switchOn("updatePrewarm"),
      let executable = stagedApp(version: version)?.executableURL
    else { return }
    stop()
    launch(executable, version: version)
  }

  static func beforeInstall(version: String, install: @escaping () -> Void) {
    warm(version: version)
    guard runningVersion == version else { return install() }
    var waiting = true
    let proceed = {
      guard waiting else { return }
      waiting = false
      install()
    }
    afterRun.append(proceed)
    DispatchQueue.main.asyncAfter(deadline: .now() + installHold, execute: proceed)
  }

  static func stop() {
    if running != 0 { kill(running, SIGKILL) }
    running = 0
    runningVersion = nil
    generation += 1
  }

  private static func launch(_ executable: URL, version: String) {
    if !watchingQuit {
      watchingQuit = true
      NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in stop() }
    }
    generation += 1
    let current = generation
    runningVersion = version
    var env = LaunchConfig.shared.environmentForChildProcesses.filter { !$0.key.hasPrefix("DYLD_") }
    env["ARDIA_PREWARM"] = "1"
    DispatchQueue.global(qos: .utility).async {
      let task = Process()
      task.executableURL = executable
      task.environment = env
      task.standardInput = FileHandle.nullDevice
      task.standardOutput = FileHandle.nullDevice
      task.standardError = FileHandle.nullDevice
      let began = Date()
      task.terminationHandler = { ended in
        let ms = Int(Date().timeIntervalSince(began) * 1000)
        DispatchQueue.main.async {
          NSLog("Ardia: prewarmed update \(version) in \(ms) ms (status \(ended.terminationStatus))")
          UserDefaults.standard.set(
            ["build": version, "at": Date().timeIntervalSince1970 * 1000, "ms": ms, "status": Int(ended.terminationStatus)],
            forKey: lastRunKey)
          finish(current)
        }
      }
      do {
        try task.run()
      } catch {
        NSLog("Ardia: couldn't prewarm update \(version): \(error.localizedDescription)")
        return DispatchQueue.main.async { finish(current) }
      }
      let pid = task.processIdentifier
      DispatchQueue.main.async {
        guard generation == current, task.isRunning else { return }
        running = pid
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
          guard running == pid, task.isRunning else { return }
          NSLog("Ardia: update prewarm still running after \(Int(timeout)) s; stopping it")
          stop()
        }
      }
    }
  }

  private static func finish(_ which: Int) {
    guard which == generation else { return }
    running = 0
    runningVersion = nil
    let waiting = afterRun
    afterRun = []
    waiting.forEach { $0() }
  }

  static func stagedApp(version: String, bundleId: String? = Bundle.main.bundleIdentifier, root: URL? = nil) -> Bundle? {
    stagedApps(bundleId: bundleId, root: root)
      .filter { $0.bundle.infoDictionary?["CFBundleVersion"] as? String == version }
      .max { $0.modified < $1.modified }?.bundle
  }

  static func stagedApps(bundleId: String? = Bundle.main.bundleIdentifier, root: URL? = nil) -> [(bundle: Bundle, modified: Date)] {
    guard let bundleId,
      let root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent(bundleId).appendingPathComponent("org.sparkle-project.Sparkle/Installation")
    else { return [] }
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.contentModificationDateKey],
                                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
    var found: [(bundle: Bundle, modified: Date)] = []
    for case let url as URL in walk {
      if walk.level > 4 { walk.skipDescendants(); continue }
      guard url.pathExtension == "app", let bundle = Bundle(url: url), let info = bundle.infoDictionary,
        info["CFBundleIdentifier"] as? String == bundleId,
        let executable = bundle.executableURL, FileManager.default.isExecutableFile(atPath: executable.path)
      else { continue }
      let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
      found.append((bundle, date))
    }
    return found
  }
}
