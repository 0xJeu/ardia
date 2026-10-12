// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArdiaImportCore",
  platforms: [.macOS(.v14)],
  products: [.library(name: "ArdiaImportCore", targets: ["ArdiaImportCore"])],
  targets: [
    .target(name: "ArdiaImportCore", path: "ios/Core", linkerSettings: [.linkedLibrary("sqlite3")]),
    .testTarget(
      name: "ArdiaImportCoreTests",
      dependencies: ["ArdiaImportCore"],
      path: "tests"
    ),
  ]
)
