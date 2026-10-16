#include "ardia/core/ac_extension_shortcuts.h"

#import <AppKit/AppKit.h>

#include "base/apple/owned_objc.h"
#include "chrome/browser/extensions/commands/command_service.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/tab_list/tab_list_interface.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/input/native_web_keyboard_event.h"
#include "components/remote_cocoa/app_shim/native_widget_ns_window_bridge.h"
#include "content/public/browser/web_contents.h"
#include "extensions/common/api/extension_action/action_info.h"
#include "extensions/common/command.h"
#include "extensions/common/extension.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_browser_window.h"
#include "ui/base/accelerators/global_accelerator_listener/global_accelerator_listener.h"
#import "ui/base/cocoa/command_dispatcher.h"
#include "ui/content_accelerators/accelerator_util.h"

@interface ACExtensionShortcutDispatcher : NSObject <CommandDispatcherDelegate>
@end

@implementation ACExtensionShortcutDispatcher

- (ui::PerformKeyEquivalentResult)prePerformKeyEquivalent:(NSEvent*)event
                                                   window:(NSWindow*)window {
  ardiacore::WindowHost* host = ardiacore::WindowHost::ForNSWindow(window);
  Profile* profile = host ? host->active_profile() : nullptr;
  Browser* browser = profile ? host->ExistingBrowserFor(profile) : nullptr;
  ardiacore::ACBrowserWindow* browser_window =
      browser ? ardiacore::ACBrowserWindow::FromWindow(
                    BrowserWindow::FromBrowser(browser))
              : nullptr;
  return browser_window && browser_window->HandleExtensionKeyEquivalent(event)
             ? ui::PerformKeyEquivalentResult::kHandled
             : ui::PerformKeyEquivalentResult::kUnhandled;
}

- (ui::PerformKeyEquivalentResult)postPerformKeyEquivalent:(NSEvent*)event
                                                    window:(NSWindow*)window
                                              isRedispatch:(BOOL)isRedispatch {
  return ui::PerformKeyEquivalentResult::kUnhandled;
}

@end

namespace ardiacore {

ExtensionShortcuts::ExtensionShortcuts(Browser* browser)
    : ExtensionKeybindingRegistry(browser->GetProfile(),
                                  TabListInterface::From(browser),
                                  ALL_EXTENSIONS),
      browser_(browser) {
  Init();
}

ExtensionShortcuts::~ExtensionShortcuts() = default;

ui::Accelerator ExtensionShortcuts::AcceleratorFor(NSEvent* event) {
  return ui::GetAcceleratorFromNativeWebKeyboardEvent(
      input::NativeWebKeyboardEvent(base::apple::OwnedNSEvent(event)));
}

bool ExtensionShortcuts::Suspended() const {
  if (suspended_) {
    return true;
  }
  ui::GlobalAcceleratorListener* global =
      ui::GlobalAcceleratorListener::GetInstance();
  return global && global->IsShortcutHandlingSuspended();
}

bool ExtensionShortcuts::Matches(const ui::Accelerator& accelerator) const {
  return !Suspended() && accelerators_.contains(accelerator);
}

bool ExtensionShortcuts::Run(const ui::Accelerator& accelerator) {
  if (!Matches(accelerator)) {
    return false;
  }
  auto action = action_accelerators_.find(accelerator);
  if (action == action_accelerators_.end()) {
    return NotifyEventTargets(accelerator);
  }
  if (accelerator.IsRepeat()) {
    return true;
  }
  content::WebContents* contents =
      browser_->GetTabStripModel()->GetActiveWebContents();
  return contents && HostExtensionActionShortcut(contents, action->second);
}

bool ExtensionShortcuts::PopulateCommands(const extensions::Extension* extension,
                                          ui::CommandMap* commands) {
  extensions::CommandService* service =
      extensions::CommandService::Get(browser_context());
  bool named = service->GetNamedCommands(
      extension->id(), extensions::CommandService::ACTIVE,
      extensions::CommandService::REGULAR, commands);
  extensions::Command action;
  bool has_action = service->GetExtensionActionCommand(
      extension->id(), extensions::ActionInfo::Type::kAction,
      extensions::CommandService::ACTIVE, &action, nullptr);
  if (has_action) {
    (*commands)[action.command_name()] = action;
  }
  return named || has_action;
}

bool ExtensionShortcuts::RegisterAccelerator(
    const ui::Accelerator& accelerator,
    const extensions::ExtensionId& extension_id,
    const std::string& command_name) {
  accelerators_.insert(accelerator);
  if (extensions::Command::IsActionRelatedCommand(command_name)) {
    action_accelerators_[accelerator] = extension_id;
  }
  return true;
}

void ExtensionShortcuts::UnregisterAccelerator(
    const ui::Accelerator& accelerator) {
  accelerators_.erase(accelerator);
  action_accelerators_.erase(accelerator);
}

void ExtensionShortcuts::OnShortcutHandlingSuspended(bool suspended) {
  suspended_ = suspended;
}

bool ExtensionShortcuts::ShouldIgnoreCommand(const std::string& command) const {
  return false;
}

void InstallExtensionShortcutDispatcher(NSWindow* window) {
  remote_cocoa::NativeWidgetNSWindowBridge* bridge =
      remote_cocoa::NativeWidgetNSWindowBridge::GetFromNSWindow(window);
  if (bridge) {
    bridge->SetCommandDispatcher([[ACExtensionShortcutDispatcher alloc] init],
                                 nil);
  }
}

}
