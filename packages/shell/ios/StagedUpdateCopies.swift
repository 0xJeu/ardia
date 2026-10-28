import Foundation

enum StagedUpdateCopies {
  static let launchServicesTool = URL(
    fileURLWithPath: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")

  static func installationRoot(bundleId: String? = Bundle.main.bundleIdentifier) -> URL? {
    guard let bundleId else { return nil }
    return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
      .appendingPathComponent(bundleId).appendingPathComponent("org.sparkle-project.Sparkle/Installation")
  }

  static func copies(bundleId: String? = Bundle.main.bundleIdentifier, root: URL? = nil) -> [(bundle: Bundle, modified: Date)] {
    guard let bundleId, let root = root ?? installationRoot(bundleId: bundleId) else { return [] }
    let keys: [URLResourceKey] = [.contentModificationDateKey, .isSymbolicLinkKey]
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys,
                                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
    var found: [(bundle: Bundle, modified: Date)] = []
    for case let url as URL in walk {
      if walk.level > 4 { walk.skipDescendants(); continue }
      let values = try? url.resourceValues(forKeys: Set(keys))
      guard values?.isSymbolicLink != true, url.pathExtension == "app", let bundle = Bundle(url: url),
        bundle.infoDictionary?["CFBundleIdentifier"] as? String == bundleId
      else { continue }
      found.append((bundle, values?.contentModificationDate ?? .distantPast))
    }
    return found
  }

  static func unregister(_ bundle: URL) {
    let tool = Process()
    tool.executableURL = launchServicesTool
    tool.arguments = ["-u", bundle.path]
    tool.standardInput = FileHandle.nullDevice
    tool.standardOutput = FileHandle.nullDevice
    tool.standardError = FileHandle.nullDevice
    do {
      try tool.run()
      tool.waitUntilExit()
    } catch {
      NSLog("Ardia: couldn't unregister \(bundle.path) from Launch Services: \(error.localizedDescription)")
    }
  }

  static func sweep(installedBuild: String? = Bundle.main.infoDictionary?["CFBundleVersion"] as? String,
                    bundleId: String? = Bundle.main.bundleIdentifier, root: URL? = nil) {
    guard let installedBuild, let root = root ?? installationRoot(bundleId: bundleId) else { return }
    for copy in copies(bundleId: bundleId, root: root) {
      unregister(copy.bundle.bundleURL)
      let build = copy.bundle.infoDictionary?["CFBundleVersion"] as? String ?? ""
      guard build.compare(installedBuild, options: .numeric) != .orderedDescending,
        let folder = updateFolder(of: copy.bundle.bundleURL, in: root)
      else { continue }
      do {
        try FileManager.default.removeItem(at: folder)
        NSLog("Ardia: removed a leftover update copy (build \(build)) at \(folder.path)")
      } catch {
        NSLog("Ardia: couldn't remove a leftover update copy at \(folder.path): \(error.localizedDescription)")
      }
    }
  }

  static func updateFolder(of bundle: URL, in root: URL) -> URL? {
    let base = root.resolvingSymlinksInPath().standardizedFileURL.pathComponents
    let parts = bundle.resolvingSymlinksInPath().standardizedFileURL.pathComponents
    guard parts.count > base.count + 1, Array(parts.prefix(base.count)) == base else { return nil }
    return URL(fileURLWithPath: NSString.path(withComponents: Array(parts.prefix(base.count + 1))), isDirectory: true)
  }
}
