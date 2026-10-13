#import <Security/Security.h>
#import <objc/runtime.h>

#import "ArdiaCoreInternal.h"
#import "ArdiaCoreServices.h"
#import "ArdiaCoreNavigationDownloads.h"
#import "ArdiaCoreStartup.h"
#import "ArdiaCoreWebView.h"

#include <cctype>
#include <cstring>
#include <string>
#include <vector>

namespace {

id<NSApplicationDelegate> (^gMakeDelegate)(void);
id<NSApplicationDelegate> gAppDelegate;
BOOL gStarted;
NSString *gDataDirectory;

NSMutableDictionary<NSString *, ArdiaCoreProfile *> *Profiles() {
  static NSMutableDictionary *profiles = [NSMutableDictionary dictionary];
  return profiles;
}

NSMutableDictionary<NSString *, NSMutableArray *> *ProfileWaiters() {
  static NSMutableDictionary *waiters = [NSMutableDictionary dictionary];
  return waiters;
}

NSMutableSet<NSString *> *DeletedProfiles() {
  static NSMutableSet *deleted = [NSMutableSet set];
  return deleted;
}

NSMutableSet<NSString *> *ReleasedPrivateNames() {
  static NSMutableSet *released = [NSMutableSet set];
  return released;
}

NSMutableDictionary<NSString *, void (^)(ArdiaCoreProfile *)> *DeletionsAfterLoad() {
  static NSMutableDictionary *deletions = [NSMutableDictionary dictionary];
  return deletions;
}

NSString *DirectoryName(NSString *name) {
  return name.length ? [@"Profile " stringByAppendingString:name] : @"Default";
}

NSString *InstalledDataDirectory() {
  NSString *support = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
  NSString *bundleId = NSBundle.mainBundle.bundleIdentifier ?: @"com.ardia.browser";
  return [[support stringByAppendingPathComponent:bundleId] stringByAppendingPathComponent:@"Chromium"];
}

bool IsTeamSigned() {
  SecCodeRef code = nullptr;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return false;
  CFDictionaryRef info = nullptr;
  OSStatus status = SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSSigningInformation, &info);
  CFRelease(code);
  if (status != errSecSuccess || !info) return false;
  bool team = CFDictionaryGetValue(info, kSecCodeInfoTeamIdentifier) != nullptr;
  CFRelease(info);
  return team;
}

}

@interface ArdiaCoreBootstrapDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, readonly) NSMutableArray<NSURL *> *urls;
@end

@implementation ArdiaCoreBootstrapDelegate
- (instancetype)init {
  if ((self = [super init])) _urls = [NSMutableArray array];
  return self;
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
  [_urls addObjectsFromArray:urls];
}
@end

namespace {
ArdiaCoreBootstrapDelegate *gBootstrap;
bool gScratchDataDir = false;
bool gAppKitWillFinish = false;
bool gAppKitDidFinish = false;
NSArray<NSURL *> *gPendingLaunchURLs;
void (^gEventHandler)(NSString *, NSDictionary *);
void (^gChromeUIHandler)(NSString *, NSDictionary *);
void (^gExtensionsEventHandler)(NSString *, NSDictionary *);
NSMutableDictionary<NSString *, NSDictionary *> *gInstallPrompts = [NSMutableDictionary dictionary];
}

static void StartLaunchTab() {
  NSString *dir = gScratchDataDir ? [gDataDirectory stringByDeletingLastPathComponent] : nil;
  if (!dir) {
    NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
    dir = [support URLByAppendingPathComponent:NSBundle.mainBundle.bundleIdentifier ?: @"Ardia"].path;
  }
  NSData *data = dir ? [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"session.json"]] : nil;
  NSDictionary *session = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  NSDictionary *hint = [session isKindOfClass:NSDictionary.class] ? session[@"launchTab"] : nil;
  if (![hint isKindOfClass:NSDictionary.class]) return;
  NSString *key = hint[@"id"], *url = hint[@"url"], *profile = hint[@"profile"];
  if (![key isKindOfClass:NSString.class] || ![url isKindOfClass:NSString.class] || ![profile isKindOfClass:NSString.class]) return;
  [ArdiaCoreWebView startLaunchTab:key url:url profile:profile];
}

@interface ArdiaCoreHostEngineDelegate : NSObject <ArdiaCoreEngineDelegate>
@end

@implementation ArdiaCoreHostEngineDelegate

- (void)engineDidStart {
  NSLog(@"[ardiacore] engine started (Chromium %@)", ArdiaCoreEngine.sharedEngine.chromiumVersion);
  gStarted = YES;
  ardiacore_host::InstallActivationGuardsLate();
  if (gScratchDataDir && ardiacore_host::Background())
    ardiacore_host::InstallTestCrashGuard([gDataDirectory stringByDeletingLastPathComponent]);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  if (ArdiaCoreProfile *profile = ardiacore_host::PersonalIfLoaded(engine)) Profiles()[@""] = profile;
  ardiacore_host::LoadContentBlocker(@"");
  [ArdiaCoreWebView installScrollZoom];
  [ArdiaCoreServices watchDownloads:@""];

  NSBundle *bundle = [NSBundle bundleForClass:ArdiaCoreHostEngineDelegate.class];
  NSString *path = [bundle pathForResource:@"page_script" ofType:@"js"];
  NSString *script = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] : nil;
  if (script && [engine respondsToSelector:@selector(setPageScript:)]) engine.pageScript = script;

  CFRunLoopObserverRef idle = CFRunLoopObserverCreateWithHandler(
      nullptr, kCFRunLoopBeforeWaiting, false, 0, ^(CFRunLoopObserverRef observer, CFRunLoopActivity) {
        CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
        __block id started = [NSNotificationCenter.defaultCenter
            addObserverForName:@"RCTJavaScriptWillStartExecutingNotification"
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification *) {
                      [NSNotificationCenter.defaultCenter removeObserver:started];
                      started = nil;
                      dispatch_async(dispatch_get_main_queue(), ^{ StartLaunchTab(); });
                    }];
        [self launchApp];
      });
  CFRunLoopAddObserver(CFRunLoopGetMain(), idle, kCFRunLoopCommonModes);
  CFRelease(idle);
}

- (void)launchApp {
  NSArray<NSURL *> *launchURLs = gBootstrap.urls.copy;
  gAppDelegate = gMakeDelegate();
  NSApp.delegate = gAppDelegate;
  gBootstrap = nil;
  NSNotification *note = [NSNotification notificationWithName:NSApplicationWillFinishLaunchingNotification object:NSApp];
  if (gAppKitWillFinish && [gAppDelegate respondsToSelector:@selector(applicationWillFinishLaunching:)])
    [gAppDelegate applicationWillFinishLaunching:note];
  if (!gAppKitDidFinish) {
    NSLog(@"[ardiacore] app delegate %@ set before AppKit finished launching", NSStringFromClass([gAppDelegate class]));
    gPendingLaunchURLs = launchURLs;
    return;
  }
  note = [NSNotification notificationWithName:NSApplicationDidFinishLaunchingNotification object:NSApp];
  if ([gAppDelegate respondsToSelector:@selector(applicationDidFinishLaunching:)])
    [gAppDelegate applicationDidFinishLaunching:note];
  NSLog(@"[ardiacore] app delegate %@ launched", NSStringFromClass([gAppDelegate class]));
  if (launchURLs.count && [gAppDelegate respondsToSelector:@selector(application:openURLs:)])
    [gAppDelegate application:NSApp openURLs:launchURLs];
}

- (void)engineWillShutDown {
  gStarted = NO;
}

- (void)engineQuitCancelled {
  NSLog(@"[ardiacore] quit cancelled");
  [NSNotificationCenter.defaultCenter postNotificationName:@"ArdiaCoreQuitCancelled" object:nil];
}

- (void)engine:(ArdiaCoreEngine *)engine permissionRequest:(NSDictionary *)request tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [request mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if (gEventHandler) gEventHandler(@"permission", payload);
}

- (void)engine:(ArdiaCoreEngine *)engine deviceChooser:(NSDictionary *)chooser tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [chooser mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if (auto handler = ArdiaCoreHost.chromeUIHandler) handler(@"deviceChooser", payload);
  else if ([payload[@"open"] boolValue] && [ArdiaCoreEngine respondsToSelector:@selector(cancelDeviceChooser:)])
    [ArdiaCoreEngine cancelDeviceChooser:[payload[@"id"] intValue]];
}

- (void)engine:(ArdiaCoreEngine *)engine castDialog:(NSDictionary *)dialog tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [dialog mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if (gChromeUIHandler) gChromeUIHandler(@"castDialog", payload);
  else if ([payload[@"open"] boolValue] && [ArdiaCoreEngine respondsToSelector:@selector(closeCastDialog:)])
    [ArdiaCoreEngine closeCastDialog:[payload[@"id"] intValue]];
}

- (void)engine:(ArdiaCoreEngine *)engine castRoutes:(NSArray *)routes profile:(ArdiaCoreProfile *)profile {
  if (!gChromeUIHandler) return;
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  if (profile.offTheRecord)
    for (NSString *name in ardiacore_host::LoadedProfileNames())
      if (ardiacore_host::LoadedProfile(name) == profile) [names addObject:name];
  if (!names.count) [names addObject:ardiacore_host::ProfileName(profile)];
  for (NSString *name in names) gChromeUIHandler(@"castRoutes", @{@"profile" : name, @"routes" : routes ?: @[]});
}

- (void)engine:(ArdiaCoreEngine *)engine extensionSidePanel:(NSDictionary *)panel tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [panel mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if (gChromeUIHandler) gChromeUIHandler(@"sidePanel", payload);
}

- (BOOL)engine:(ArdiaCoreEngine *)engine extensionActionPopup:(NSDictionary *)popup tab:(ArdiaCoreTab *)tab {
  if (!gChromeUIHandler || !tab) {
    NSLog(@"[ardiacore] action.openPopup for %@: %@", popup[@"extensionId"], tab ? @"the app isn't listening yet" : @"no tab");
    return NO;
  }
  NSMutableDictionary *payload = [popup mutableCopy];
  payload[@"browserId"] = @(ardiacore_host::BrowserId(tab));
  gChromeUIHandler(@"actionPopup", payload);
  return YES;
}

- (void)engine:(ArdiaCoreEngine *)engine extensionInstallPrompt:(NSDictionary *)prompt tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [prompt mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  gInstallPrompts[payload[@"requestId"] ?: @""] = payload;
  if (gExtensionsEventHandler) gExtensionsEventHandler(@"installPrompt", payload);
}

- (void)engine:(ArdiaCoreEngine *)engine permissionRequestDismissed:(NSString *)requestId {
  if (gEventHandler) gEventHandler(@"permissionDismissed", @{@"id" : requestId ?: @""});
}

- (ArdiaCoreWindow *)engineWindowForNewBrowserOfProfile:(ArdiaCoreProfile *)profile type:(NSString *)type {
  if (![type isEqualToString:@"normal"] && ![type isEqualToString:@"popup"]) return nil;
  return [ArdiaCoreWindowController strayWindowForProfile:profile].coreWindow;
}

@end

@implementation ArdiaCoreHost

+ (int)runWithArgc:(int)argc argv:(char **)argv delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate {
  const char *dataDir = getenv("ARDIA_DATA_DIR");
  gScratchDataDir = dataDir && *dataDir;
#if DEBUG
  if (!gScratchDataDir) {
    fprintf(stderr, "[ardiacore] set ARDIA_DATA_DIR to a scratch directory\n");
    return 1;
  }
#endif
  gMakeDelegate = [makeDelegate copy];
  NSString *scratch = gScratchDataDir ? @(dataDir) : nil;
  if (scratch && !scratch.absolutePath)
    scratch = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:scratch];
  gDataDirectory = scratch ? [scratch.stringByStandardizingPath stringByAppendingPathComponent:@"Chromium"] : InstalledDataDirectory();
  NSError *dirError;
  if (![NSFileManager.defaultManager createDirectoryAtPath:gDataDirectory withIntermediateDirectories:YES attributes:nil error:&dirError]) {
    fprintf(stderr, "[ardiacore] can't use the data dir %s: %s\n", gDataDirectory.fileSystemRepresentation,
            dirError.localizedDescription.UTF8String ?: "");
    return 1;
  }
  ardiacore_host::InstallTestCrashGuard(scratch && ardiacore_host::Background() ? scratch.stringByStandardizingPath : nil);
  ardiacore_host::InstallActivationGuardsEarly();
  ardiacore_host::PrepareContentBlocker();
  Method finishLaunching = class_getInstanceMethod(NSApplication.class, @selector(finishLaunching));
  IMP appKitFinishLaunching = method_getImplementation(finishLaunching);
  method_setImplementation(finishLaunching, imp_implementationWithBlock(^(NSApplication *app) {
    if (!gAppDelegate && !app.delegate) {
      gBootstrap = [ArdiaCoreBootstrapDelegate new];
      app.delegate = gBootstrap;
    }
    ((void (*)(id, SEL))appKitFinishLaunching)(app, @selector(finishLaunching));
  }));
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                gAppKitWillFinish = true;
                                              }];
  if (getenv("ARDIA_TRACE_VISIBILITY")) {
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidChangeOcclusionStateNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *note) {
                                                  NSWindow *w = note.object;
                                                  id chrome = [w respondsToSelector:NSSelectorFromString(@"isOccluded")]
                                                                  ? [w valueForKey:@"occluded"] : nil;
                                                  NSLog(@"[ardiacore-vis] window %ld occlusion macOSVisible=%d chromeOccluded=%@ fromChecker=%d",
                                                        (long)w.windowNumber, (w.occlusionState & NSWindowOcclusionStateVisible) != 0,
                                                        chrome, note.userInfo.count > 0);
                                                }];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSNotificationName name in @[ NSWorkspaceScreensDidSleepNotification, NSWorkspaceScreensDidWakeNotification,
                                        NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceSessionDidBecomeActiveNotification ])
      [workspace addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) {
        NSLog(@"[ardiacore-vis] workspace %@", note.name);
      }];
  }
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                gAppKitDidFinish = true;
                                                if (!gPendingLaunchURLs.count) return;
                                                dispatch_async(dispatch_get_main_queue(), ^{
                                                  NSArray<NSURL *> *urls = gPendingLaunchURLs;
                                                  gPendingLaunchURLs = nil;
                                                  if (urls.count && [gAppDelegate respondsToSelector:@selector(application:openURLs:)])
                                                    [gAppDelegate application:NSApp openURLs:urls];
                                                });
                                              }];

  std::vector<std::string> extra = {
      "--user-data-dir=" + std::string(gDataDirectory.UTF8String),
      "--enable-smooth-scrolling",
      "--disable-stack-profiler",
      "--disable-features=MacAppCodeSignClone",
      "--enable-features=WebContentsDiscard,ImprovedStartupBestEffortDelay:StartupDelayStopOnLoadingTimedOut/true",
      "--profile-directory=Default",
  };
  if (gScratchDataDir || !IsTeamSigned()) extra.push_back("--use-mock-keychain");
  ardiacore_host::PrepareStartup(gDataDirectory, extra);
  if (getenv("ARDIA_BACKGROUND") && !getenv("ARDIA_ALLOW_OCCLUSION")) {
    extra.push_back("--disable-backgrounding-occluded-windows");
    if (Method occluded = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(@"isOccluded")))
      method_setImplementation(occluded, imp_implementationWithBlock(^BOOL(id) { return NO; }));
  }
  if (getenv("ARDIA_BACKGROUND") && !getenv("ARDIA_ALLOW_AUDIO")) extra.push_back("--mute-audio");
  if (getenv("ARDIA_BACKGROUND")) extra.push_back("--use-fake-device-for-media-stream");
  if (getenv("ARDIA_BACKGROUND")) extra.push_back("--disable-modal-animations");
  auto autoAccepts = [](const char *sw) {
    return getenv("ARDIA_BACKGROUND") && (!strncmp(sw, "--use-fake-ui-for-media-stream", 30) ||
                                              !strncmp(sw, "--auto-accept-camera-and-microphone-capture", 43));
  };
  if (const char *port = getenv("ARDIA_REMOTE_DEBUGGING_PORT")) {
    extra.push_back(std::string("--remote-debugging-port=") + port);
    extra.push_back("--remote-allow-origins=*");
  }
  if (const char *switches = getenv("ARDIA_CHROMIUM_SWITCHES")) {
    NSString *all = [@" " stringByAppendingString:@(switches)];
    for (NSString *item in [all componentsSeparatedByString:@" --"]) {
      NSString *sw = [item stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
      std::string full = std::string("--") + sw.UTF8String;
      if (sw.length && !autoAccepts(full.c_str())) extra.push_back(full);
    }
  }
  std::vector<const char *> args = {argc > 0 && argv[0] ? argv[0] : "Ardia"};
  for (const std::string &s : extra) args.push_back(s.c_str());
  for (int i = 1; i < argc; i++) {
    const char *arg = argv[i];
    if (!arg) break;
    const bool cocoaDefault = arg[0] == '-' && arg[1] != '-' && isalpha((unsigned char)arg[1]) &&
                              strncmp(arg, "-psn_", 5) != 0 && i + 1 < argc;
    if (cocoaDefault) {
      i++;
      continue;
    }
    if (autoAccepts(arg)) continue;
    args.push_back(arg);
  }
  static ArdiaCoreHostEngineDelegate *engineDelegate = [ArdiaCoreHostEngineDelegate new];
  return [ArdiaCoreEngine runWithArgc:(int)args.size() argv:args.data() delegate:engineDelegate];
}

+ (void (^)(NSString *, NSDictionary *))eventHandler {
  return gEventHandler;
}

+ (void)setEventHandler:(void (^)(NSString *, NSDictionary *))handler {
  gEventHandler = [handler copy];
}

+ (void (^)(NSString *, NSDictionary *))extensionsEventHandler {
  return gExtensionsEventHandler;
}

+ (void)setExtensionsEventHandler:(void (^)(NSString *, NSDictionary *))handler {
  gExtensionsEventHandler = [handler copy];
  if (handler)
    for (NSDictionary *prompt in gInstallPrompts.allValues) handler(@"installPrompt", prompt);
}

+ (void)resolveExtensionInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted {
  [gInstallPrompts removeObjectForKey:requestId ?: @""];
  if ([ArdiaCoreEngine respondsToSelector:@selector(resolveExtensionInstallPrompt:accepted:)])
    [ArdiaCoreEngine resolveExtensionInstallPrompt:requestId accepted:accepted];
}

+ (void)beginTracing:(void (^)(BOOL))completion {
  if (![ArdiaCoreEngine respondsToSelector:@selector(beginTracing:)]) return completion(NO);
  [ArdiaCoreEngine beginTracing:completion];
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *))completion {
  if (![ArdiaCoreEngine respondsToSelector:@selector(endTracing:completion:)]) return completion(nil);
  [ArdiaCoreEngine endTracing:keep completion:completion];
}

+ (BOOL)isTracing {
  return [ArdiaCoreEngine respondsToSelector:@selector(isTracing)] && ArdiaCoreEngine.isTracing;
}

+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *))completion {
  if (ardiacore_host::IsIncognito(profile)) return completion(@[]);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  if (!profile.length || ![engine respondsToSelector:@selector(deleteProfile:completion:)]) return completion(@[ @"data" ]);
  [DeletedProfiles() addObject:profile];
  void (^remove)(ArdiaCoreProfile *) = ^(ArdiaCoreProfile *loaded) {
    if (!loaded) {
      NSString *path = [gDataDirectory stringByAppendingPathComponent:[@"Profile " stringByAppendingString:profile]];
      [NSFileManager.defaultManager removeItemAtPath:path error:nil];
      return completion([NSFileManager.defaultManager fileExistsAtPath:path] ? @[ @"files" ] : @[]);
    }
    [engine deleteProfile:loaded completion:^(BOOL deleted) {
      if (deleted) [Profiles() removeObjectForKey:profile];
      else [DeletedProfiles() removeObject:profile];
      completion(deleted ? @[] : @[ @"data" ]);
    }];
  };
  if (!p && ProfileWaiters()[profile]) {
    DeletionsAfterLoad()[profile] = [remove copy];
    return;
  }
  remove(p);
}

+ (void)releaseProfile:(NSString *)profile {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  if (ardiacore_host::IsIncognito(profile)) {
    if (profile) [ReleasedPrivateNames() addObject:profile];
    [Profiles() removeObjectForKey:profile];
    NSArray *waiting = ProfileWaiters()[profile];
    [ProfileWaiters() removeObjectForKey:profile];
    for (void (^waiter)(ArdiaCoreProfile *) in waiting) waiter(nil);
    ardiacore_host::ForgetPrivateNavigationDownloads(profile);
    if ([Profiles().allValues containsObject:p]) return;
  }
  if (p && [engine respondsToSelector:@selector(releaseProfile:)]) [engine releaseProfile:p];
}

+ (BOOL)stopCapture:(int)browserId {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(stopCapture)] && [tab stopCapture];
}

+ (BOOL)showAutofillSuggestions:(int)browserId passwords:(BOOL)passwords {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(showAutofillSuggestions:)] && [tab showAutofillSuggestions:passwords];
}

+ (void (^)(NSString *, NSDictionary *))chromeUIHandler {
  return gChromeUIHandler;
}

+ (void)setChromeUIHandler:(void (^)(NSString *, NSDictionary *))handler {
  gChromeUIHandler = [handler copy];
}

+ (void)deviceChooser:(int)chooserId select:(int)index {
  if ([ArdiaCoreEngine respondsToSelector:@selector(selectDevice:index:)]) [ArdiaCoreEngine selectDevice:chooserId index:index];
}

+ (void)deviceChooser:(int)chooserId action:(NSString *)action {
  if ([action isEqualToString:@"cancel"] && [ArdiaCoreEngine respondsToSelector:@selector(cancelDeviceChooser:)])
    [ArdiaCoreEngine cancelDeviceChooser:chooserId];
  else if ([action isEqualToString:@"refresh"] && [ArdiaCoreEngine respondsToSelector:@selector(refreshDeviceChooser:)])
    [ArdiaCoreEngine refreshDeviceChooser:chooserId];
  else if ([action isEqualToString:@"settings"] && [ArdiaCoreEngine respondsToSelector:@selector(openDeviceChooserSettings:)])
    [ArdiaCoreEngine openDeviceChooserSettings:chooserId];
}

+ (NSArray<NSDictionary *> *)testExternalLaunches {
  return ArdiaCoreEngine.testExternalLaunches ?: @[];
}

+ (BOOL)devShowBluetoothChooser:(int)browserId unauthorized:(BOOL)unauthorized {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(devShowBluetoothChooser:)] && [tab devShowBluetoothChooser:unauthorized];
}

+ (NSArray<NSDictionary *> *)testChooserEvents {
  return [ArdiaCoreEngine respondsToSelector:@selector(testChooserEvents)] ? ArdiaCoreEngine.testChooserEvents ?: @[] : @[];
}

+ (BOOL)shareTabInstead:(int)capturerBrowserId target:(int)targetBrowserId {
  ArdiaCoreTab *capturer = ardiacore_host::TabWithBrowserId(capturerBrowserId);
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(targetBrowserId);
  return capturer && [tab respondsToSelector:@selector(shareThisTabInsteadFor:)] && [tab shareThisTabInsteadFor:capturer];
}

+ (BOOL)showCastDialog:(int)browserId {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(showCastDialog)] && [tab showCastDialog];
}

+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode {
  if ([ArdiaCoreEngine respondsToSelector:@selector(startCasting:sink:mode:)]) [ArdiaCoreEngine startCasting:dialogId sink:sink mode:mode];
}

+ (void)castDialog:(int)dialogId stop:(NSString *)route {
  if ([ArdiaCoreEngine respondsToSelector:@selector(stopCasting:route:)]) [ArdiaCoreEngine stopCasting:dialogId route:route];
}

+ (void)closeCastDialog:(int)dialogId {
  if ([ArdiaCoreEngine respondsToSelector:@selector(closeCastDialog:)]) [ArdiaCoreEngine closeCastDialog:dialogId];
}

+ (void)watchCastRoutes:(NSString *)profileName {
  ardiacore_host::WithProfile(profileName, ^(ArdiaCoreProfile *profile) {
    if ([profile respondsToSelector:@selector(watchCastRoutes)]) [profile watchCastRoutes];
  });
}

+ (void)terminateCastRoute:(NSString *)route {
  if ([ArdiaCoreEngine respondsToSelector:@selector(terminateCastRoute:)]) [ArdiaCoreEngine terminateCastRoute:route];
}

+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember {
  if ([ArdiaCoreEngine respondsToSelector:@selector(resolveExternalApp:open:remember:)])
    [ArdiaCoreEngine resolveExternalApp:requestId open:open remember:remember];
}

+ (NSDictionary *)actionStates:(int)browserId extensions:(NSArray<NSString *> *)ids {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(actionStatesForExtensions:)] ? [tab actionStatesForExtensions:ids] ?: @{} : @{};
}

+ (NSString *)sidePanelURL:(int)browserId extension:(NSString *)extensionId {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(sidePanelURLForExtension:)] ? [tab sidePanelURLForExtension:extensionId] : nil;
}

+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  if ([engine respondsToSelector:@selector(resolvePermission:result:remember:)])
    [engine resolvePermission:requestId result:result remember:remember];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)displayMediaSources {
  NSMutableArray *sources = [NSMutableArray array];
  NSUInteger index = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *display = screen.deviceDescription[@"NSScreenNumber"];
    index++;
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"screen:%u:0", display.unsignedIntValue],
      @"kind" : @"screen",
      @"name" : screen.localizedName ?: [NSString stringWithFormat:@"Screen %lu", (unsigned long)index],
      @"width" : @(screen.frame.size.width),
      @"height" : @(screen.frame.size.height),
    }];
  }
  NSArray *windows = CFBridgingRelease(
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  const pid_t me = getpid();
  for (NSDictionary *w in windows) {
    if ([w[(id)kCGWindowLayer] intValue] != 0 || [w[(id)kCGWindowOwnerPID] intValue] == me) continue;
    NSDictionary *bounds = w[(id)kCGWindowBounds];
    const CGFloat width = [bounds[@"Width"] doubleValue], height = [bounds[@"Height"] doubleValue];
    if (width < 50 || height < 50) continue;
    NSString *app = w[(id)kCGWindowOwnerName] ?: @"";
    NSString *title = w[(id)kCGWindowName];
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"window:%u:0", [w[(id)kCGWindowNumber] unsignedIntValue]],
      @"kind" : @"window",
      @"name" : title.length ? title : app,
      @"app" : app,
      @"pid" : w[(id)kCGWindowOwnerPID] ?: @0,
      @"width" : @(width),
      @"height" : @(height),
    }];
  }
  return sources;
}

+ (BOOL)isStarted {
  return gStarted;
}

+ (NSString *)dataDirectory {
  return gDataDirectory ?: @"";
}

+ (NSDictionary<NSString *, id> *)engineInfo {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  NSInteger chromeWindows = 0;
  for (ArdiaCoreWindowController *c in ArdiaCoreWindowController.all) chromeWindows += c.coreWindow ? 1 : 0;
  return @{
    @"pid" : @(NSProcessInfo.processInfo.processIdentifier),
    @"dataDirectory" : gDataDirectory ?: @"",
    @"engine" : @"ardiacore",
    @"chromiumVersion" : engine.chromiumVersion ?: @"",
    @"liveBrowsers" : @0,
    @"popupWindows" : @(ardiacore_host::PopupWindowCount()),
    @"chromeWindows" : @(chromeWindows),
    @"keepAlive" : engine.keepAliveState ?: @"",
    @"lastUsedProfile" : engine.defaultProfile.name ?: @"",
  };
}

+ (NSArray<NSDictionary<NSString *, id> *> *)chromeWindows {
  NSMutableArray *list = [NSMutableArray array];
  for (ArdiaCoreWindowController *c in ArdiaCoreWindowController.all) {
    NSWindow *w = c.coreWindow.window;
    if (!w) continue;
    ArdiaCoreProfile *active = c.coreWindow.activeProfile;
    [list addObject:@{
      @"profile" : ardiacore_host::ProfileName(active),
      @"window" : @(w.windowNumber),
      @"frame" : NSStringFromRect(w.frame),
      @"alpha" : @(w.alphaValue),
      @"key" : @(w.isKeyWindow),
      @"canBecomeKey" : @(w.canBecomeKeyWindow),
      @"visible" : @(w.isVisible),
      @"occlusionVisible" : @((w.occlusionState & NSWindowOcclusionStateVisible) != 0),
      @"chromeOccluded" : [w respondsToSelector:NSSelectorFromString(@"isOccluded")] ? [w valueForKey:@"occluded"] : NSNull.null,
      @"parentWindow" : @(w.parentWindow.windowNumber),
      @"chromeWindows" : @1,
      @"anchorBrowserId" : @0,
      @"anyTabBrowserId" : @0,
      @"ready" : @YES,
      @"active" : @(w.isMainWindow),
      @"pageInsets" : @[ @0, @0, @0, @0 ],
      @"hosting" : @(c.root != nil),
      @"group" : @"",
      @"hasRoot" : @(c.root != nil),
      @"translucent" : @(!w.opaque),
    }];
  }
  return list;
}

@end

namespace ardiacore_host {

void ForgetDestroyedProfiles() {
  for (NSString *name in Profiles().allKeys)
    if (Profiles()[name].destroyed) [Profiles() removeObjectForKey:name];
}

NSArray<NSString *> *LoadedProfileNames() {
  ForgetDestroyedProfiles();
  return Profiles().allKeys;
}

NSArray<ArdiaCoreProfile *> *LoadedProfiles() {
  ForgetDestroyedProfiles();
  NSMutableArray *profiles = [NSMutableArray array];
  for (ArdiaCoreProfile *profile in Profiles().allValues)
    if (![profiles containsObject:profile]) [profiles addObject:profile];
  return profiles;
}

bool IsIncognito(NSString *name) {
  return [name hasPrefix:@"incognito"];
}

NSString *OriginalProfileName(NSString *name) {
  if (!IsIncognito(name)) return name ?: @"";
  NSRange at = [name rangeOfString:@"@"];
  return at.location == NSNotFound ? @"" : [name substringFromIndex:NSMaxRange(at)];
}

NSString *OriginalProfileNameOf(ArdiaCoreProfile *profile) {
  if (!profile.offTheRecord) return ProfileName(profile);
  NSString *dir = profile.name;
  return [dir hasPrefix:@"Profile "] ? [dir substringFromIndex:8] : @"";
}

bool IsOffTheRecordOf(ArdiaCoreProfile *profile, NSString *name) {
  return profile.offTheRecord && IsIncognito(name) &&
         [profile.name isEqualToString:DirectoryName(OriginalProfileName(name))];
}

bool IsDeletedProfile(NSString *name) {
  return [DeletedProfiles() containsObject:name ?: @""];
}

ArdiaCoreProfile *LoadedProfile(NSString *name) {
  ArdiaCoreProfile *profile = Profiles()[name ?: @""];
  if (!profile.destroyed) return profile;
  [Profiles() removeObjectForKey:name ?: @""];
  return nil;
}

namespace {

void WithPrivateProfile(NSString *name, void (^completion)(ArdiaCoreProfile *)) {
  if ([ReleasedPrivateNames() containsObject:name]) return completion(nil);
  if (NSMutableArray *waiters = ProfileWaiters()[name]) return (void)[waiters addObject:completion];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:completion];
  NSString *original = OriginalProfileName(name);
  WithProfile(original, ^(ArdiaCoreProfile *base) {
    ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
    void (^answer)(ArdiaCoreProfile *, NSString *) = ^(ArdiaCoreProfile *otr, NSString *error) {
      NSArray *pending = ProfileWaiters()[name];
      [ProfileWaiters() removeObjectForKey:name];
      if (IsDeletedProfile(original)) {
        if (otr && ![Profiles().allValues containsObject:otr]) [engine releaseProfile:otr];
        if (pending) NSLog(@"[ardiacore] no private profile for %@: its profile was deleted", name);
        for (void (^waiter)(ArdiaCoreProfile *) in pending) waiter(nil);
        return;
      }
      if (!pending) {
        if (otr && ![Profiles().allValues containsObject:otr]) [engine releaseProfile:otr];
        return;
      }
      if (otr && !otr.destroyed) Profiles()[name] = otr;
      else NSLog(@"[ardiacore] no private profile for %@: %@", name, error ?: @"it went");
      for (void (^waiter)(ArdiaCoreProfile *) in pending) waiter(Profiles()[name]);
    };
    if (!base) return answer(nil, [NSString stringWithFormat:@"profile \"%@\" isn't loaded", original]);
    if (![engine respondsToSelector:@selector(offTheRecordProfileFor:completion:)]) return answer(nil, @"the engine is too old");
    [engine offTheRecordProfileFor:base completion:answer];
  });
}

}

void WithProfile(NSString *name, void (^completion)(ArdiaCoreProfile *)) {
  name = name ?: @"";
  if ([DeletedProfiles() containsObject:name]) return completion(nil);
  if (ArdiaCoreProfile *profile = LoadedProfile(name)) return completion(profile);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  if (!engine) return completion(nil);
  if (IsIncognito(name)) return WithPrivateProfile(name, [completion copy]);
  if (name.length == 0) {
    if (ArdiaCoreProfile *personal = PersonalIfLoaded(engine)) {
      Profiles()[@""] = personal;
      return completion(personal);
    }
  }
  NSMutableArray *waiters = ProfileWaiters()[name];
  if (waiters) return (void)[waiters addObject:[completion copy]];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:[completion copy]];
  [engine loadProfile:DirectoryName(name)
           completion:^(ArdiaCoreProfile *loaded) {
             NSArray *pending = ProfileWaiters()[name];
             [ProfileWaiters() removeObjectForKey:name];
             if (void (^deletion)(ArdiaCoreProfile *) = DeletionsAfterLoad()[name]) {
               [DeletionsAfterLoad() removeObjectForKey:name];
               deletion(loaded);
             }
             ArdiaCoreProfile *profile = [DeletedProfiles() containsObject:name] ? nil : loaded;
             if (profile) Profiles()[name] = profile;
             if (profile) ardiacore_host::LoadContentBlocker(name);
             if (profile) [ArdiaCoreServices watchDownloads:name];
             for (void (^waiter)(ArdiaCoreProfile *) in pending) waiter(profile);
           }];
}

ArdiaCoreProfile *PersonalIfLoaded(ArdiaCoreEngine *engine) {
  ArdiaCoreProfile *profile = engine.defaultProfile;
  return [profile.name isEqualToString:@"Default"] ? profile : nil;
}

NSString *ProfileName(ArdiaCoreProfile *profile) {
  if (!profile) return @"";
  for (NSString *name in Profiles())
    if (Profiles()[name] == profile) return name;
  NSString *dir = profile.name;
  if ([dir hasPrefix:@"Profile "]) return [dir substringFromIndex:8];
  return @"";
}

NSString *AppDisposition(NSString *chrome) {
  static NSDictionary *map = @{
    @"foreground_tab" : @"foreground",
    @"background_tab" : @"background",
    @"popup" : @"popup",
    @"window" : @"window",
    @"off_the_record" : @"incognito",
    @"current_tab" : @"current",
    @"split_view" : @"split",
    @"singleton_tab" : @"foreground",
  };
  return map[chrome] ?: @"foreground";
}

}
