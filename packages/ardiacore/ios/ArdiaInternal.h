#import <AppKit/AppKit.h>

#import "ArdiaCore.h"
#import "ArdiaHost.h"
#import "ArdiaTabStrip.h"

@class ArdiaWebView;

NS_ASSUME_NONNULL_BEGIN

namespace ardia_host {

ArdiaCoreProfile *_Nullable LoadedProfile(NSString *name);
bool IsDeletedProfile(NSString *name);
void WithProfile(NSString *name, void (^completion)(ArdiaCoreProfile *_Nullable profile));
NSString *ProfileName(ArdiaCoreProfile *_Nullable profile);
NSString *ProfileNameOfDirectory(NSString *directory);
ArdiaCoreProfile *_Nullable PersonalIfLoaded(ArdiaCoreEngine *engine);
bool IsIncognito(NSString *name);
NSString *OriginalProfileName(NSString *_Nullable name);
NSString *OriginalProfileNameOf(ArdiaCoreProfile *_Nullable profile);
bool IsOffTheRecordOf(ArdiaCoreProfile *_Nullable profile, NSString *_Nullable name);
NSArray<NSString *> *LoadedProfileNames();

int BrowserId(ArdiaCoreTab *tab);
ArdiaCoreTab *_Nullable TabWithBrowserId(int browserId);

NSString *AppDisposition(NSString *chromeDisposition);

void InstallActivationGuardsEarly();
void InstallActivationGuardsLate();
bool Background();
void LogActivation(NSString *what);
void SetAppActive(bool active);
void ActToggleFullScreen(NSWindow *window);
void InstallTestCrashGuard(NSString *_Nullable dataDir);

void OpenPopupWindow(ArdiaCoreTab *tab, ArdiaWebView *_Nullable opener);
bool IsReservedKeyEvent(NSEvent *event);
bool IsReservedBinding(NSString *key, NSString *unshiftedKey, NSEventModifierFlags modifiers);
NSUInteger PopupWindowCount();
bool AskPermissionInPopupWindow(ArdiaCoreTab *tab, NSDictionary *request);
void DropPopupWindowPermission(NSString *requestId);
void NotePasswordPromptSource(ArdiaWebView *view, ArdiaCoreTab *_Nullable source);
ArdiaCoreTab *_Nullable PasswordPromptTab(ArdiaWebView *view, ArdiaCoreTab *_Nullable own);

}

@interface ArdiaWindowController : NSObject <ArdiaCoreWindowDelegate>
+ (nullable ArdiaWindowController *)forNSWindow:(nullable NSWindow *)window;
+ (NSArray<ArdiaWindowController *> *)all;
@property(nonatomic, readonly) ArdiaCoreWindow *coreWindow;
@property(nonatomic, strong, nullable) NSView *root;
@property(nonatomic) NSInteger hostChanges;
@property(nonatomic, copy, nullable) NSString *appWindowId;
+ (ArdiaWindowController *)strayWindowForProfile:(ArdiaCoreProfile *)profile;
+ (nullable ArdiaWindowController *)chromeMadeWindowForProfile:(ArdiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL stray;
+ (ArdiaWindowController *)standaloneWindowForProfile:(ArdiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL standalone;
- (void)noteClosing:(ArdiaCoreTab *)tab;
+ (nullable ArdiaWindowController *)holding:(ArdiaCoreTab *)tab;
+ (nullable ArdiaWebView *)hostingViewForProfile:(nullable ArdiaCoreProfile *)profile;
+ (BOOL)userSees:(nullable NSWindow *)window;
@end
extern NSNotificationName const ArdiaWindowSeenDidChange;

@interface ArdiaTabStrip (Engine)
+ (void)changedInWindow:(ArdiaWindowController *)controller profile:(ArdiaCoreProfile *)profile;
+ (void)changedInWindow:(ArdiaWindowController *)controller profile:(ArdiaCoreProfile *)profile cause:(nullable id)cause;
+ (void)windowClosed:(ArdiaWindowController *)controller;
+ (void)activated:(ArdiaCoreTab *)tab inWindow:(ArdiaWindowController *)controller;
+ (nullable ArdiaCoreTab *)activeTabInWindow:(ArdiaWindowController *)controller profile:(ArdiaCoreProfile *)profile;
+ (void)removed:(ArdiaCoreTab *)tab fromWindow:(ArdiaWindowController *)controller;
+ (void)setPinned:(BOOL)pinned tab:(ArdiaCoreTab *)tab;
@end

@interface ArdiaCoreProfile (Pending)
- (nullable NSString *)loadComponentExtension:(NSString *)path;
- (void)releaseNavigationHoldReady;
- (void)unloadComponentExtension:(NSString *)extensionId;
@end

namespace ardia_host {
NSArray<ArdiaCoreProfile *> *LoadedProfiles();
void LoadContentBlocker(NSString *profile);
void PrepareContentBlocker();
bool EngineHasTabModel();
}

@interface ArdiaTabRegistry : NSObject
+ (void)setView:(nullable ArdiaWebView *)view forTab:(ArdiaCoreTab *)tab;
+ (nullable ArdiaWebView *)viewForTab:(ArdiaCoreTab *)tab;
+ (NSString *)offerTab:(ArdiaCoreTab *)tab;
+ (NSString *)offerTab:(ArdiaCoreTab *)tab prefix:(NSString *)prefix;
+ (nullable ArdiaCoreTab *)takeOffered:(NSString *)adoptId;
+ (nullable ArdiaCoreTab *)offeredTab:(NSString *)adoptId;
+ (void)forget:(ArdiaCoreTab *)tab;
@end

@interface ArdiaFavicons (Tabs)
+ (void)noteImage:(nullable NSImage *)image forURL:(nullable NSString *)url profile:(nullable NSString *)profile;
@end

NS_ASSUME_NONNULL_END
