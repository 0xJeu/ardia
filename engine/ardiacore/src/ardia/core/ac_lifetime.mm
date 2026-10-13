#include "ardia/core/ac_lifetime.h"

#import <AppKit/AppKit.h>
#include <CoreServices/CoreServices.h>
#import <objc/runtime.h>

#include <utility>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#import "chrome/browser/app_controller_mac.h"
#import "chrome/browser/chrome_browser_application_mac.h"
#include "chrome/browser/devtools/chrome_devtools_manager_delegate.h"
#include "chrome/browser/download/download_core_service.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/application_lifetime_desktop.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "ui/color/color_provider_manager.h"
#include "ui/native_theme/native_theme.h"
#include <vector>
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_main_delegate.h"

namespace ardiacore {

namespace {

enum class QuitPhase { kNone, kAskingHost, kAskingDownloads, kClosing, kCancelling, kExiting };
QuitPhase g_phase = QuitPhase::kNone;
int g_quit_generation = 0;

LifetimeCallbacks& Callbacks() {
  static base::NoDestructor<LifetimeCallbacks> callbacks;
  return *callbacks;
}

base::CallbackListSubscription& ClosingAllBrowsersSubscription() {
  static base::NoDestructor<base::CallbackListSubscription> subscription;
  return *subscription;
}

void QuitCancelled() {
  if (g_phase == QuitPhase::kNone || g_phase == QuitPhase::kCancelling ||
      g_phase == QuitPhase::kExiting) {
    return;
  }
  g_phase = QuitPhase::kCancelling;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce([] {
        g_phase = QuitPhase::kNone;
        NotifyWindowsQuitCancelled();
        if (Callbacks().quit_cancelled) {
          Callbacks().quit_cancelled.Run();
        }
      }));
}

void StartQuit() {
  g_phase = QuitPhase::kClosing;
  chrome::OnClosingAllBrowsers(true);
  chrome::CloseAllBrowsersAndQuit();
}

void Terminate() {
  if (g_phase != QuitPhase::kNone) {
    return;
  }
  id<NSApplicationDelegate> delegate = NSApp.delegate;
  if (![delegate respondsToSelector:@selector(applicationShouldTerminate:)]) {
    QuitEngine();
    return;
  }
  const int attempt = ++g_quit_generation;
  g_phase = QuitPhase::kAskingHost;
  const NSApplicationTerminateReply reply = [delegate applicationShouldTerminate:NSApp];
  if (attempt != g_quit_generation || g_phase != QuitPhase::kAskingHost) {
    return;
  }
  switch (reply) {
    case NSTerminateNow:
      g_phase = QuitPhase::kNone;
      QuitEngine();
      break;
    case NSTerminateLater:
      break;
    case NSTerminateCancel:
      QuitCancelled();
      break;
  }
}

}

bool IsQuitting() {
  return g_phase != QuitPhase::kNone;
}

void SetLifetimeCallbacks(LifetimeCallbacks callbacks) {
  Callbacks() = std::move(callbacks);
}

void QuitEngine() {
  if (g_phase != QuitPhase::kNone || browser_shutdown::IsTryingToQuit()) {
    return;
  }
  const int generation = ++g_quit_generation;
  const int downloads = DownloadCoreService::BlockingShutdownCountAllProfiles();
  if (downloads == 0) {
    StartQuit();
    return;
  }
  g_phase = QuitPhase::kAskingDownloads;
  ConfirmQuitWithDownloads(
      downloads, base::BindOnce(
                     [](int generation, bool quit_anyway) {
                       if (generation != g_quit_generation ||
                           g_phase != QuitPhase::kAskingDownloads) {
                         return;
                       }
                       if (quit_anyway) {
                         StartQuit();
                       } else {
                         QuitCancelled();
                       }
                     },
                     generation));
}

void StartLifetimeObservers() {
  ClosingAllBrowsersSubscription() =
      chrome::AddClosingAllBrowsersCallback(base::BindRepeating([](bool closing) {
        if (!closing && g_phase == QuitPhase::kClosing &&
            !browser_shutdown::IsTryingToQuit()) {
          QuitCancelled();
        }
      }));
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationWillTerminateNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                g_phase = QuitPhase::kExiting;
                ReleaseAppKeepAlive();
                ChromeDevToolsManagerDelegate::AllowBrowserToClose();
              }];
}

}

@interface ACAppControllerStandIn : NSObject
@property(readonly, nonatomic) Profile* lastProfileIfLoaded;
@property(readonly, nonatomic) Profile* lastProfile;
- (const ui::ColorProvider&)lastActiveColorProvider;
- (BOOL)keyWindowIsModal;
@end

@implementation ACAppControllerStandIn
- (Profile*)lastProfileIfLoaded {
  return ProfileManager::GetLastUsedProfileIfLoaded();
}
- (Profile*)lastProfile {
  return ProfileManager::GetLastUsedProfileIfLoaded();
}
- (const ui::ColorProvider&)lastActiveColorProvider {
  return *ui::ColorProviderManager::Get().GetColorProviderFor(
      ui::NativeTheme::GetInstanceForNativeUi()->GetColorProviderKey(nullptr));
}
- (BOOL)keyWindowIsModal {
  return NSApp.keyWindow.sheet || NSApp.modalWindow != nil;
}
- (NSMethodSignature*)methodSignatureForSelector:(SEL)selector {
  return [super methodSignatureForSelector:selector]
             ?: [AppController instanceMethodSignatureForSelector:selector];
}
- (void)forwardInvocation:(NSInvocation*)invocation {
  const NSUInteger length = invocation.methodSignature.methodReturnLength;
  if (length) {
    std::vector<char> zero(length, 0);
    [invocation setReturnValue:zero.data()];
  }
}
@end

namespace {

id StandInSharedController(id self, SEL _cmd) {
  static ACAppControllerStandIn* stand_in = [[ACAppControllerStandIn alloc] init];
  return stand_in;
}

void ACTerminate(id self, SEL _cmd, id sender) {
  ardiacore::Terminate();
}

void ACCancelTerminate(id self, SEL _cmd, id sender) {
  if (browser_shutdown::IsTryingToQuit()) {
    browser_shutdown::SetTryingToQuit(false);
  }
}

void ACReplyToApplicationShouldTerminate(id self, SEL _cmd, BOOL should_terminate) {
  if (ardiacore::g_phase != ardiacore::QuitPhase::kAskingHost) {
    return;
  }
  if (should_terminate) {
    ardiacore::g_phase = ardiacore::QuitPhase::kNone;
    ardiacore::QuitEngine();
  } else {
    ardiacore::QuitCancelled();
  }
}

}

@interface ACQuitAppleEventHandler : NSObject
- (void)handleQuitEvent:(NSAppleEventDescriptor*)event
              withReply:(NSAppleEventDescriptor*)reply;
@end

@implementation ACQuitAppleEventHandler
- (void)handleQuitEvent:(NSAppleEventDescriptor*)event
              withReply:(NSAppleEventDescriptor*)reply {
  [NSApp terminate:nil];
}
@end

namespace ardiacore {

namespace {
void InstallQuitAppleEventHandler() {
  static ACQuitAppleEventHandler* handler = [[ACQuitAppleEventHandler alloc] init];
  [NSAppleEventManager.sharedAppleEventManager
      setEventHandler:handler
          andSelector:@selector(handleQuitEvent:withReply:)
        forEventClass:kCoreEventClass
           andEventID:kAEQuitApplication];
}
}

void InstallAppOverrides() {
  Class app_controller = [AppController class];
  class_replaceMethod(object_getClass(app_controller), @selector(sharedController),
                      reinterpret_cast<IMP>(StandInSharedController), "@@:");
  Class app = [BrowserCrApplication class];
  class_replaceMethod(app, @selector(terminate:), reinterpret_cast<IMP>(ACTerminate),
                      "v@:@");
  class_replaceMethod(app, @selector(cancelTerminate:),
                      reinterpret_cast<IMP>(ACCancelTerminate), "v@:@");
  class_replaceMethod(app, @selector(replyToApplicationShouldTerminate:),
                      reinterpret_cast<IMP>(ACReplyToApplicationShouldTerminate), "v@:c");
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationDidFinishLaunchingNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                InstallQuitAppleEventHandler();
              }];
}

}
