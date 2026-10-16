#include "ardia/core/ac_extension_shortcuts.h"

#import <AppKit/AppKit.h>

#include <optional>

#include "base/apple/owned_objc.h"
#include "base/no_destructor.h"
#include "chrome/browser/extensions/commands/command_service.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/browser_process.h"
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
#include "ardia/core/ac_hooks.h"
#include "ui/base/accelerators/global_accelerator_listener/global_accelerator_listener.h"
#import "ui/base/cocoa/command_dispatcher.h"
#include "ui/content_accelerators/accelerator_util.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/keyboard_codes.h"

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

namespace {

std::set<ui::Accelerator>& ReservedGlobalAccelerators() {
  static base::NoDestructor<std::set<ui::Accelerator>> accelerators;
  return *accelerators;
}

std::optional<ui::KeyboardCode> KeyboardCodeForKeyEquivalent(unichar key) {
  if (key >= 'a' && key <= 'z') {
    return static_cast<ui::KeyboardCode>(ui::VKEY_A + (key - 'a'));
  }
  if (key >= '0' && key <= '9') {
    return static_cast<ui::KeyboardCode>(ui::VKEY_0 + (key - '0'));
  }
  if (key >= NSF1FunctionKey && key <= NSF24FunctionKey) {
    return static_cast<ui::KeyboardCode>(ui::VKEY_F1 + (key - NSF1FunctionKey));
  }
  switch (key) {
    case ',': return ui::VKEY_OEM_COMMA;
    case '.': return ui::VKEY_OEM_PERIOD;
    case ' ': return ui::VKEY_SPACE;
    case '\t': return ui::VKEY_TAB;
    case NSUpArrowFunctionKey: return ui::VKEY_UP;
    case NSDownArrowFunctionKey: return ui::VKEY_DOWN;
    case NSLeftArrowFunctionKey: return ui::VKEY_LEFT;
    case NSRightArrowFunctionKey: return ui::VKEY_RIGHT;
    case NSHomeFunctionKey: return ui::VKEY_HOME;
    case NSEndFunctionKey: return ui::VKEY_END;
    case NSPageUpFunctionKey: return ui::VKEY_PRIOR;
    case NSPageDownFunctionKey: return ui::VKEY_NEXT;
    case NSInsertFunctionKey: return ui::VKEY_INSERT;
    case NSDeleteFunctionKey: return ui::VKEY_DELETE;
  }
  return std::nullopt;
}

std::optional<ui::Accelerator> AcceleratorForKeyEquivalent(NSString* key,
                                                           NSEventModifierFlags modifiers) {
  if (key.length != 1) {
    return std::nullopt;
  }
  NSString* lower = key.lowercaseString;
  if (![lower isEqualToString:key]) {
    modifiers |= NSEventModifierFlagShift;
  }
  std::optional<ui::KeyboardCode> code = KeyboardCodeForKeyEquivalent([lower characterAtIndex:0]);
  if (!code) {
    return std::nullopt;
  }
  int flags = 0;
  flags |= (modifiers & NSEventModifierFlagCommand) ? ui::EF_COMMAND_DOWN : 0;
  flags |= (modifiers & NSEventModifierFlagControl) ? ui::EF_CONTROL_DOWN : 0;
  flags |= (modifiers & NSEventModifierFlagOption) ? ui::EF_ALT_DOWN : 0;
  flags |= (modifiers & NSEventModifierFlagShift) ? ui::EF_SHIFT_DOWN : 0;
  return ui::Accelerator(*code, flags);
}

}

bool IsReservedGlobalAccelerator(const ui::Accelerator& accelerator) {
  return ReservedGlobalAccelerators().contains(accelerator);
}

bool IsReservedGlobalShortcut(NSString* key, NSEventModifierFlags modifiers) {
  std::optional<ui::Accelerator> accelerator = AcceleratorForKeyEquivalent(key, modifiers);
  return accelerator && IsReservedGlobalAccelerator(*accelerator);
}

void SetReservedShortcuts(NSArray<NSDictionary*>* shortcuts) {
  std::set<ui::Accelerator> accelerators;
  for (NSDictionary* shortcut in shortcuts) {
    NSString* key = [shortcut[@"key"] isKindOfClass:NSString.class] ? shortcut[@"key"] : nil;
    const NSEventModifierFlags modifiers = [shortcut[@"modifiers"] unsignedIntegerValue];
    if (std::optional<ui::Accelerator> accelerator = AcceleratorForKeyEquivalent(key, modifiers)) {
      accelerators.insert(*accelerator);
    }
  }
  if (accelerators == ReservedGlobalAccelerators()) {
    return;
  }
  ReservedGlobalAccelerators() = std::move(accelerators);
  if (!g_browser_process || !g_browser_process->profile_manager()) {
    return;
  }
  for (Profile* profile : g_browser_process->profile_manager()->GetLoadedProfiles()) {
    extensions::ArdiaReregisterGlobalCommands(profile);
  }
}

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
  return !Suspended() && accelerators_.contains(accelerator) &&
         !(g_ardia_reserved_accelerator && g_ardia_reserved_accelerator(accelerator));
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
