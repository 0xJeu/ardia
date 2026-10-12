// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArdiaSyncCore",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "ArdiaSyncCore", targets: ["ArdiaSyncCore"]),
    // The launch migration from the app's former name, run on its own (scripts/legacy-migration-e2e.mjs).
    .executable(name: "legacy-migration", targets: ["LegacyMigrationTool"]),
  ],
  targets: [
    .target(name: "ArdiaSyncCore", path: "ios/Core"),
    .executableTarget(name: "LegacyMigrationTool", dependencies: ["ArdiaSyncCore"], path: "tools/legacy-migration"),
    .testTarget(name: "ArdiaSyncCoreTests", dependencies: ["ArdiaSyncCore"], path: "tests", exclude: ["fixtures"]),
  ]
)
