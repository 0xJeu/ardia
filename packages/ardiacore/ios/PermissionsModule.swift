import ExpoModulesCore

public class PermissionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPermissions")
    Events("permissions")

    OnCreate { EngineCall.listen("permissions", self) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      PermissionsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "permissions", handlers: [
    "resolve": { args, reply in
      ArdiaHost.resolvePermission(args.text("id"), result: args.text("result"), remember: args.bool("remember") ?? false)
      reply.ok()
    },
    "resolveExternalApp": { args, reply in
      ArdiaHost.resolveExternalApp(args.text("id"), open: args.bool("open") ?? false, remember: args.bool("remember") ?? false)
      reply.ok()
    },
    "externalAppAllowances": { args, reply in ArdiaServices.externalAppAllowances(profile: args.profile) { reply.service($0, $1) } },
    "removeExternalAppAllowance": { args, reply in
      ArdiaServices.removeExternalAppAllowance(profile: args.profile, origin: args.text("origin"), scheme: args.text("scheme"))
      reply.ok()
    },
    "devExternalLaunches": { _, reply in reply.ok(ArdiaHost.testExternalLaunches()) },
  ])
}
