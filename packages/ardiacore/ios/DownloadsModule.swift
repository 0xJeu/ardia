import ExpoModulesCore

public class DownloadsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaDownloads")
    Events("downloads")

    OnCreate {
      EngineCall.listen("downloads", self)
      ArdiaServices.watchDownloadEvents()
    }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      DownloadsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static func command(_ action: String) -> CallHandler {
    { args, reply in
      ArdiaServices.downloadCommand(action, id: args.text("id"))
      reply.ok()
    }
  }

  static let calls = CallTable(domain: "downloads", handlers: [
    "cancel": command("cancel"),
    "pause": command("pause"),
    "resume": command("resume"),
    "settings": EngineCall.passing("ac_downloads_settings"),
    "setSettings": EngineCall.passing("ac_downloads_set_settings"),
  ])
}
