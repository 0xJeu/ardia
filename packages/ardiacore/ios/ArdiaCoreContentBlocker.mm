#import "ArdiaCoreServices.h"
#import "ArdiaCoreInternal.h"

#include <utility>

namespace {
NSString *const kAppBlockerId = @"fajbdaomknpkicfjcpipdmcpoamdmilh";
NSString *const kEngineBlockerId = @"blockjmkbacgjkknlgpkjjiijinjdanf";
NSString *const kLiteId = @"bnjeokpoejhioagiokhkhmdogkhbnbki";
NSString *const kBundledName = @"ublock";
NSString *const kLiteReaderName = @"ublock-lite-settings";
NSString *const kLiteMovedMarker = @"uBlock Origin Lite settings moved";
bool gFailNextMessage = false;
double gDelayNextLoadMs = 0;
}

@interface ACContentBlockerPage : NSObject <ArdiaCoreTabDelegate>
@property(readonly) ArdiaCoreTab *tab;
@property(readonly) NSString *origin;
@property(readonly) BOOL dead;
@end

@implementation ACContentBlockerPage {
  NSMutableArray<NSArray *> *_calls;
  void (^_inflight)(id value, NSString *error);
  BOOL _started;
  BOOL _loaded;
  BOOL _busy;
}

- (instancetype)initWithTab:(ArdiaCoreTab *)tab origin:(NSString *)origin {
  if ((self = [super init])) {
    _tab = tab;
    _origin = origin;
    _calls = [NSMutableArray array];
    _started = tab.loading;
    tab.delegate = self;
  }
  return self;
}

- (BOOL)onOwnPage {
  return !_dead && [_tab.url hasPrefix:_origin];
}

- (void)run:(NSString *)script completion:(void (^)(id value, NSString *error))completion {
  if (_dead) return completion(nil, @"closed");
  [_calls addObject:@[ script, [completion copy] ]];
  [self next];
}

- (void)leftOwnPage {
  [self fail:[@"not the extension page: " stringByAppendingString:_tab.url ?: @""]];
}

- (void)next {
  if (_dead || !_loaded || _busy || !_calls.count) return;
  if (!self.onOwnPage) return [self leftOwnPage];
  NSArray *call = _calls.firstObject;
  [_calls removeObjectAtIndex:0];
  _inflight = call[1];
  _busy = YES;
  [_tab evaluate:call[0]
      completion:^(NSString *json) {
        void (^completion)(id, NSString *) = self->_inflight;
        if (!completion) return;
        if (!self.onOwnPage) return [self leftOwnPage];
        self->_inflight = nil;
        self->_busy = NO;
        NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *answer = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        NSString *error = ![answer isKindOfClass:NSDictionary.class] ? @"no answer"
                          : [answer[@"error"] isKindOfClass:NSString.class] ? answer[@"error"]
                                                                              : nil;
        id value = error || answer[@"value"] == NSNull.null ? nil : answer[@"value"];
        completion(value, error);
        [self next];
      }];
}

- (void)fail:(NSString *)error {
  if (_dead) return;
  _dead = YES;
  NSArray<NSArray *> *calls = _calls;
  _calls = nil;
  void (^inflight)(id, NSString *) = _inflight;
  _inflight = nil;
  ArdiaCoreTab *tab = _tab;
  dispatch_async(dispatch_get_main_queue(), ^{
    [tab closeNow];
    if (inflight) inflight(nil, error);
    for (NSArray *call in calls) ((void (^)(id, NSString *))call[1])(nil, error);
  });
}

- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab {
  _started = _started || tab.loading;
  _loaded = _started && !tab.loading;
  [self next];
}

- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  if (tab.url.length && !self.onOwnPage) [self leftOwnPage];
}

- (void)tabDidCommitDocument:(ArdiaCoreTab *)tab {
  if (!self.onOwnPage) [self leftOwnPage];
}

- (void)tabWillClose:(ArdiaCoreTab *)tab {
  [self fail:@"closed"];
}

- (void)tab:(ArdiaCoreTab *)tab rendererGone:(NSString *)status code:(int)code {
  [self fail:[@"renderer " stringByAppendingString:status]];
}

- (void)tab:(ArdiaCoreTab *)tab didFailLoad:(NSString *)url code:(int)code description:(NSString *)text {
  if (code != -3) [self fail:text];
}

@end

@interface ACContentBlockerOp : NSObject
@property(copy) NSString *profile;
@property(copy) NSString *extensionId;
@property(copy) NSString *expression;
@property(copy) void (^completion)(id value, NSString *error);
@property int attemptsLeft;
@property BOOL failNext;
@property NSTimeInterval deadline;
@property NSUInteger attempt;
@end

@implementation ACContentBlockerOp
@end

namespace {

NSString *ScriptWith(NSString *format, NSArray *args) {
  NSMutableString *out = [NSMutableString string];
  NSArray<NSString *> *parts = [format componentsSeparatedByString:@"%@"];
  for (NSUInteger i = 0; i < parts.count; i++) {
    [out appendString:parts[i]];
    if (i < args.count) {
      NSData *json = [NSJSONSerialization dataWithJSONObject:args[i] options:NSJSONWritingFragmentsAllowed error:nil];
      [out appendString:json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"null"];
    }
  }
  return out;
}

NSString *const kProfile = @"";

NSMutableOrderedSet<NSString *> *LoadedProfiles() {
  static NSMutableOrderedSet<NSString *> *profiles = [NSMutableOrderedSet orderedSet];
  return profiles;
}

NSMutableDictionary<NSString *, ArdiaCoreWindow *> *PageWindows() {
  static NSMutableDictionary *windows = [NSMutableDictionary dictionary];
  return windows;
}

NSMutableDictionary<NSString *, ACContentBlockerPage *> *Pages() {
  static NSMutableDictionary *pages = [NSMutableDictionary dictionary];
  return pages;
}

NSString *OriginOf(NSString *extensionId) { return [NSString stringWithFormat:@"chrome-extension://%@/", extensionId]; }

ACContentBlockerPage *HiddenPage(NSString *key, NSString *profile, ArdiaCoreProfile *p, NSString *extensionId, NSString *file) {
  ACContentBlockerPage *page = Pages()[key];
  if (page.tab.closed) [page fail:@"closed"];
  if (page && !page.dead) return page;
  ArdiaCoreWindow *window = PageWindows()[profile];
  if (!window) {
    PageWindows()[profile] = window = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)];
    if ([window respondsToSelector:@selector(setInternal:)]) window.internal = YES;
  }
  ArdiaCoreTab *tab = [window openTab:[OriginOf(extensionId) stringByAppendingString:file] profile:p foreground:YES];
  return Pages()[key] = tab ? [[ACContentBlockerPage alloc] initWithTab:tab origin:OriginOf(extensionId)] : nil;
}

bool HasEngineBlocker(ArdiaCoreProfile *p) {
  return [p respondsToSelector:@selector(hasInstalledExtension:)] && [p hasInstalledExtension:kEngineBlockerId];
}

bool MoveToEnginePending(ArdiaCoreProfile *p);

NSHashTable<ArdiaCoreProfile *> *AppBlockerFallbacks() {
  static NSHashTable *profiles = [NSHashTable weakObjectsHashTable];
  return profiles;
}

bool UsesEngineBlocker(ArdiaCoreProfile *p) {
  return HasEngineBlocker(p) && !MoveToEnginePending(p) && ![AppBlockerFallbacks() containsObject:p];
}

NSString *const kEngineBlockerOffMarker = @"uBlock Origin of the engine turned off by Ardia";

NSString *ProfileFile(ArdiaCoreProfile *p, NSString *name) { return [p.path stringByAppendingPathComponent:name]; }

bool CanMoveToEngine(ArdiaCoreProfile *p) {
  return [p respondsToSelector:@selector(commitPendingPreferenceWrites:)] && [p respondsToSelector:@selector(hasEnabledExtension:)];
}

bool EngineBlockerOn(ArdiaCoreProfile *p) {
  return ![p respondsToSelector:@selector(hasEnabledExtension:)] || [p hasEnabledExtension:kEngineBlockerId];
}

NSString *BlockerId(ArdiaCoreProfile *p) { return UsesEngineBlocker(p) ? kEngineBlockerId : kAppBlockerId; }

void SetEngineBlockerEnabled(NSString *profile, BOOL enabled, void (^done)(NSString *error)) {
  done = [done copy];
  [ArdiaCoreServices setExtension:kEngineBlockerId enabled:enabled profile:profile completion:^(NSDictionary<NSString *, id> *result) {
    done([result[@"error"] isKindOfClass:NSString.class] ? result[@"error"] : nil);
  }];
}

void TurnOffEngineBlocker(NSString *profile, ArdiaCoreProfile *p, void (^done)(void)) {
  done = [done copy];
  [@"" writeToFile:ProfileFile(p, kEngineBlockerOffMarker) atomically:YES encoding:NSUTF8StringEncoding error:nil];
  SetEngineBlockerEnabled(profile, NO, ^(NSString *error) {
    if (error) NSLog(@"[blocker] the engine's uBlock Origin didn't turn off (%@)", error);
    done();
  });
}

void TurnOnEngineBlocker(NSString *profile, ArdiaCoreProfile *p, void (^done)(bool on)) {
  done = [done copy];
  if (EngineBlockerOn(p)) {
    [NSFileManager.defaultManager removeItemAtPath:ProfileFile(p, kEngineBlockerOffMarker) error:nil];
    return done(true);
  }
  if (![NSFileManager.defaultManager fileExistsAtPath:ProfileFile(p, kEngineBlockerOffMarker)]) return done(false);
  SetEngineBlockerEnabled(profile, YES, ^(NSString *error) {
    if (error) NSLog(@"[blocker] the engine's uBlock Origin didn't turn back on (%@)", error);
    const bool on = EngineBlockerOn(p);
    if (on) [NSFileManager.defaultManager removeItemAtPath:ProfileFile(p, kEngineBlockerOffMarker) error:nil];
    done(on);
  });
}

void ClosePages(NSString *profile) {
  for (NSString *key in @[ profile, [NSString stringWithFormat:@"%@:%@", kAppBlockerId, profile],
                           [NSString stringWithFormat:@"%@:%@", kEngineBlockerId, profile] ]) {
    [Pages()[key] fail:@"switched blockers"];
    [Pages() removeObjectForKey:key];
  }
}

NSString *PageKey(NSString *profile, ArdiaCoreProfile *p, NSString *extensionId) {
  return [extensionId isEqualToString:BlockerId(p)] ? profile : [NSString stringWithFormat:@"%@:%@", extensionId, profile];
}

ACContentBlockerPage *PageFor(NSString *profile, ArdiaCoreProfile *p, NSString *extensionId) {
  return HiddenPage(PageKey(profile, p, extensionId), profile, p, extensionId, @"blank.html");
}

NSString *BundledExtension() {
  NSString *bundled = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:[@"Extensions" stringByAppendingPathComponent:kBundledName]];
  return [NSFileManager.defaultManager fileExistsAtPath:[bundled stringByAppendingPathComponent:@"manifest.json"]] ? bundled : nil;
}

NSString *gExtensionPath;

void StartPreparing() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    gExtensionPath = BundledExtension();
    NSString *oldCopies = [[ArdiaCoreHost.dataDirectory stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"Built-in Extensions"];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      if ([NSFileManager.defaultManager fileExistsAtPath:oldCopies]) [NSFileManager.defaultManager removeItemAtPath:oldCopies error:nil];
    });
  });
}

NSString *ExtensionPath() {
  StartPreparing();
  return gExtensionPath;
}

void FollowDefault(NSArray<NSString *> *profiles, void (^done)(NSString *error));
void WhenDefaultSettled(void (^then)(void));

bool LoadAppBlocker(ArdiaCoreProfile *p) {
  NSString *path = gExtensionPath;
  if (!path || ![p respondsToSelector:@selector(loadComponentExtension:)]) return false;
  NSString *loaded = [p loadComponentExtension:path];
  if ([loaded isEqualToString:kAppBlockerId]) return true;
  NSLog(@"[blocker] component load failed (%@)", loaded);
  return false;
}

void LoadIntoProfile(NSString *profile, void (^then)(NSString *error)) {
  then = [then copy];
  StartPreparing();
  void (^load)(void) = ^{
    if ([LoadedProfiles() containsObject:profile]) return then(nil);
    ardiacore_host::WithProfile(profile, ^(ArdiaCoreProfile *p) {
      if ([LoadedProfiles() containsObject:profile]) return then(nil);
      if (!p) return then(@"not loaded");
      void (^loadOwn)(void) = ^{
        if (!LoadAppBlocker(p)) {
          NSLog(@"[blocker] profile \"%@\" has no content blocker: the bundled uBlock Origin didn't load", profile);
          return then(@"not loaded");
        }
        NSLog(@"[blocker] profile \"%@\" blocks with the bundled uBlock Origin", profile);
        [LoadedProfiles() addObject:profile];
        then(nil);
      };
      if (!HasEngineBlocker(p)) return loadOwn();
      if (MoveToEnginePending(p)) {
        if (CanMoveToEngine(p)) return loadOwn();
        return TurnOffEngineBlocker(profile, p, loadOwn);
      }
      TurnOnEngineBlocker(profile, p, ^(bool on) {
        if (!on) {
          NSLog(@"[blocker] profile \"%@\": the engine's uBlock Origin is off and Ardia didn't turn it off; the bundled one blocks instead", profile);
          [AppBlockerFallbacks() addObject:p];
          return loadOwn();
        }
        NSLog(@"[blocker] profile \"%@\" blocks with the engine's uBlock Origin", profile);
        [LoadedProfiles() addObject:profile];
        then(nil);
      });
    });
  };
  if (NSThread.isMainThread) load();
  else dispatch_async(dispatch_get_main_queue(), load);
}

NSString *const kOffDirective = @"/^(?:ardia-blocking-off|)/";

bool gDefaultSettled = false;
bool gLaunching = true;
constexpr double kSettleAfterLaunchSeconds = 1.5;

bool SettleWithoutPage() {
  const char *pagelessSettle = getenv("ARDIA_BLOCKER_PAGELESS_SETTLE");
  return !(pagelessSettle && !strcmp(pagelessSettle, "off"));
}

constexpr int kAttempts = 40;
constexpr double kRetryMs = 250;
constexpr double kOpSeconds = 20;

NSString *const kPrelude =
    @"let failing = %@;"
     "const offDirective = %@;"
     "const extensionOrigin = %@;"
     "const deadline = Date.now() + %@;"
     "const left = () => Math.max(0, deadline - Date.now());"
     "let expired = false;"
     "const withDeadline = (promise, what) => new Promise((resolve, reject) => {"
     "  const timer = setTimeout(() => { expired = true; reject(new Error(`${what}: timed out`)); }, left());"
     "  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });"
     "});"
     "const ready = () => new Promise((resolve, reject) => {"
     "  const look = () => {"
     "    const ublock = chrome.extension.getBackgroundPage()?.µBlock;"
     "    if (ublock?.isReadyPromise) return ublock.isReadyPromise.then(resolve, reject);"
     "    if (left() === 0) return reject(new Error('uBlock Origin never started'));"
     "    setTimeout(look, 10);"
     "  };"
     "  look();"
     "});"
     "const loadScript = (src) => new Promise((resolve, reject) => {"
     "  const element = document.createElement('script');"
     "  element.src = src;"
     "  element.onload = resolve;"
     "  element.onerror = () => reject(new Error(`${src} didn't load`));"
     "  document.head.append(element);"
     "});"
     "const client = () => self.vAPI?.messaging ? Promise.resolve()"
     "  : ['js/vapi.js', 'js/vapi-common.js', 'js/vapi-client.js'].reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());"
     "const send = (message) => {"
     "  if (expired) return Promise.reject(new Error(`${message.what}: timed out`));"
     "  if (failing) { failing = false; return Promise.reject(new Error(`${message.what}: failed (dev)`)); }"
     "  return client().then(() => {"
     "    if (expired) throw new Error(`${message.what}: timed out`);"
     "    return vAPI.messaging.send('dashboard', message);"
     "  }).then((reply) => {"
     "    if (reply === undefined) throw new Error(`${message.what}: no reply`);"
     "    return reply;"
     "  });"
     "};"
     "const trusted = () => send({what: 'getWhitelist'}).then((t) => {"
     "  if (!t || !Array.isArray(t.whitelist)) throw new Error('getWhitelist: no answer');"
     "  return t;"
     "});"
     "const lists = () => send({what: 'getLists'}).then((l) => {"
     "  if (!l || !l.available || typeof l.available !== 'object') throw new Error('getLists: no answer');"
     "  return l;"
     "});"
     "const selected = (l) => Object.keys(l.available).filter((k) => l.available[k] && l.available[k].off !== true);"
     "const covers = (directive, host) => !directive.includes('/') && (host === directive || host.endsWith('.' + directive));"
     "const sameSet = (a, b) => [...a].sort().join('\\n') === [...b].sort().join('\\n');"
     "const storageCall = (name, arg) => expired ? Promise.reject(new Error(`storage ${name}: timed out`))"
     "  : new Promise((resolve, reject) => chrome.storage.local[name](arg, (v) =>"
     "    chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(v || {})));"
     "const local = {get: (k) => storageCall('get', k), set: (v) => storageCall('set', v), remove: (k) => storageCall('remove', k)};"
     "const reloadLists = () => send({what: 'reloadAllFilters'}).then(() => local.remove('ardiaReloadPending'));"
     "const applyLists = (toSelect) => local.set({ardiaReloadPending: true})"
     "  .then(() => send({what: 'applyFilterListSelection', toSelect})).then(reloadLists);"
     "const settlePending = () => local.get('ardiaReloadPending').then((b) => b.ardiaReloadPending ? reloadLists() : null);"
     "Promise.resolve().then(() => { if (location.origin !== extensionOrigin) throw new Error(`not the extension page: ${location.href}`); })"
     ".then(() => withDeadline(ready(), 'uBlock Origin'))"
     ".then(() => withDeadline(settlePending().then(() => (%@)), 'the call'))"
     ".then((v) => post('result', JSON.stringify({value: v === undefined ? null : v})),"
     "(e) => post('result', JSON.stringify({error: String(e && e.message || e)})))";

NSMutableDictionary<NSString *, NSMutableArray<ACContentBlockerOp *> *> *Queues() {
  static NSMutableDictionary *queues = [NSMutableDictionary dictionary];
  return queues;
}

NSMutableSet<NSString *> *BusyProfiles() {
  static NSMutableSet *busy = [NSMutableSet set];
  return busy;
}

void Pump(NSString *profile);

constexpr double kPageIdleSeconds = 30;

NSMutableDictionary<NSString *, NSNumber *> *Uses() {
  static NSMutableDictionary *uses = [NSMutableDictionary dictionary];
  return uses;
}

void CloseWhenIdle(NSString *profile) {
  const NSUInteger use = Uses()[profile].unsignedIntegerValue + 1;
  Uses()[profile] = @(use);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPageIdleSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (Uses()[profile].unsignedIntegerValue != use || [BusyProfiles() containsObject:profile] || Queues()[profile].count) return;
    [Pages()[profile] fail:@"idle"];
    [Pages() removeObjectForKey:profile];
  });
}

void Finish(ACContentBlockerOp *op, id value, NSString *error) {
  NSMutableArray *queue = Queues()[op.profile];
  if (queue.firstObject == op) [queue removeObjectAtIndex:0];
  [BusyProfiles() removeObject:op.profile];
  if (error) NSLog(@"[blocker] profile \"%@\": %@", op.profile, error);
  op.completion(value, error);
  Pump(op.profile);
  if (!Queues()[op.profile].count) CloseWhenIdle(op.profile);
}

bool TransportError(NSString *error) {
  for (NSString *sign in @[ @"no reply", @"no answer", @"context invalidated", @"not the extension page", @"renderer ", @"closed", @"uBlock Origin restarting" ])
    if ([error containsString:sign]) return true;
  return false;
}

bool Retriable(NSString *error, ACContentBlockerPage *page) {
  return !page.onOwnPage || TransportError(error);
}

void Attempt(ACContentBlockerOp *op) {
  NSString *profile = op.profile;
  if (!ArdiaCoreHost.isStarted) return Finish(op, nil, @"unavailable");
  if (![LoadedProfiles() containsObject:profile]) {
    return LoadIntoProfile(profile, ^(NSString *error) {
      if (error) Finish(op, nil, error);
      else Attempt(op);
    });
  }
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  NSString *extensionId = op.extensionId ?: BlockerId(p);
  ACContentBlockerPage *page = p ? PageFor(profile, p, extensionId) : nil;
  if (!page) return Finish(op, nil, @"not loaded");
  const double leftMs = MAX(0, (op.deadline - NSDate.timeIntervalSinceReferenceDate) * 1000);
  NSString *script = [NSString stringWithFormat:kPrelude, op.failNext ? @"true" : @"false", ScriptWith(@"%@", @[ kOffDirective ]),
                                                ScriptWith(@"%@", @[ [@"chrome-extension://" stringByAppendingString:extensionId] ]), @((long long)leftMs), op.expression];
  const NSUInteger attempt = ++op.attempt;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((leftMs + 2000) * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    if (op.attempt == attempt && Queues()[profile].firstObject == op) [page fail:@"the call timed out"];
  });
  [page run:script
      completion:^(id value, NSString *error) {
        if (op.attempt != attempt) return;
        if ([error hasSuffix:@"failed (dev)"]) op.failNext = NO;
        if ([error containsString:@"timed out"]) [page fail:error];
        const bool inTime = NSDate.timeIntervalSinceReferenceDate < op.deadline;
        if (error && op.attemptsLeft > 0 && inTime && Retriable(error, page) && [LoadedProfiles() containsObject:profile] &&
            !ardiacore_host::IsDeletedProfile(profile)) {
          op.attemptsLeft--;
          [page fail:@"uBlock Origin restarted"];
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRetryMs * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
            Attempt(op);
          });
          return;
        }
        Finish(op, value, error);
      }];
}

void Pump(NSString *profile) {
  if ([BusyProfiles() containsObject:profile]) return;
  ACContentBlockerOp *op = Queues()[profile].firstObject;
  if (!op) return;
  [BusyProfiles() addObject:profile];
  Attempt(op);
}

void CallBlocker(NSString *profile, NSString *extensionId, int attempts, NSString *expression, void (^completion)(id value, NSString *error)) {
  ACContentBlockerOp *op = [ACContentBlockerOp new];
  op.profile = profile;
  op.extensionId = extensionId;
  op.expression = expression;
  op.completion = completion;
  op.attemptsLeft = attempts;
  op.deadline = NSDate.timeIntervalSinceReferenceDate + kOpSeconds;
  if (gFailNextMessage && ![expression isEqualToString:@"null"]) {
    op.failNext = YES;
    gFailNextMessage = false;
  }
  NSMutableArray *queue = Queues()[profile] ?: (Queues()[profile] = [NSMutableArray array]);
  [queue addObject:op];
  Pump(profile);
}

void Call(NSString *profile, NSString *expression, void (^completion)(id value, NSString *error)) {
  CallBlocker(profile, nil, kAttempts, expression, completion);
}

NSString *const kRead =
    @"Promise.all([lists(), trusted()]).then(([l, t]) => ({lists: selected(l).sort(), whitelist: [...t.whitelist].sort(), autoUpdate: l.autoUpdate !== false}))";

NSString *const kFollow =
    @"Promise.all([lists(), trusted()]).then(([l, t]) => {"
     "  const want = %@;"
     "  if (!Array.isArray(want.lists) || !Array.isArray(want.whitelist)) throw new Error('no settings to copy');"
     "  let written = Promise.resolve(null);"
     "  if (!sameSet(selected(l), want.lists))"
     "    written = written.then(() => applyLists(want.lists));"
     "  if (!sameSet(t.whitelist, want.whitelist))"
     "    written = written.then(() => send({what: 'setWhitelist', whitelist: want.whitelist.join('\\n')}));"
     "  if ((l.autoUpdate !== false) !== (want.autoUpdate !== false))"
     "    written = written.then(() => send({what: 'userSettings', name: 'autoUpdate', value: want.autoUpdate !== false}));"
     "  return written.then(() => null);"
     "})";

void ForgetGoneProfiles() {
  for (NSString *profile in LoadedProfiles().array) {
    if (ardiacore_host::LoadedProfile(profile) && !ardiacore_host::IsDeletedProfile(profile)) continue;
    [LoadedProfiles() removeObject:profile];
    [Pages()[profile] fail:@"profile gone"];
    [Pages() removeObjectForKey:profile];
  }
}

void FollowDefault(NSArray<NSString *> *profiles, void (^done)(NSString *error)) {
  done = [done copy];
  if (!gDefaultSettled && ArdiaCoreHost.isStarted) return WhenDefaultSettled(^{ FollowDefault(profiles, done); });
  if (!profiles) ForgetGoneProfiles();
  profiles = [(profiles ?: LoadedProfiles().array) filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
  if (!profiles.count) return done(nil);
  Call(kProfile, kRead, ^(NSDictionary *settings, NSString *error) {
    if (error) return done(error);
    if (![settings isKindOfClass:NSDictionary.class]) return done(@"no settings to copy");
    dispatch_group_t group = dispatch_group_create();
    __block NSString *failed;
    for (NSString *profile in profiles) {
      dispatch_group_enter(group);
      Call(profile, ScriptWith(kFollow, @[ settings ]), ^(id, NSString *error) {
        const bool gone = !ardiacore_host::LoadedProfile(profile) || ardiacore_host::IsDeletedProfile(profile);
        if (!gone) failed = failed ?: error;
        dispatch_group_leave(group);
      });
    }
    dispatch_group_notify(group, dispatch_get_main_queue(), ^{ done(failed); });
  });
}

NSDictionary<NSString *, NSArray<NSString *> *> *LiteListMap() {
  return @{
    @"ublock-filters" : @[ @"ublock-filters", @"ublock-unbreak", @"ublock-quick-fixes" ],
    @"pgl" : @[ @"plowe-0" ],
    @"urlhaus-full" : @[ @"urlhaus-1" ],
    @"annoyances-ai" : @[ @"fanboy-ai-suggestions" ],
    @"annoyances-cookies" : @[ @"fanboy-cookiemonster", @"ublock-cookies-easylist" ],
    @"annoyances-overlays" : @[ @"easylist-newsletters", @"ublock-annoyances" ],
    @"annoyances-social" : @[ @"fanboy-social" ],
    @"annoyances-widgets" : @[ @"easylist-chat" ],
    @"annoyances-others" : @[ @"easylist-annoyances" ],
    @"annoyances-notifications" : @[ @"easylist-notifications" ],
  };
}

NSString *const kMoveLite =
    @"Promise.all([lists(), trusted()]).then(([l, t]) => {"
     "  const lite = %@;"
     "  const map = %@;"
     "  const none = Array.isArray(lite.filteringModeDetails?.none) ? lite.filteringModeDetails.none : [];"
     "  const off = none.includes('all-urls');"
     "  const hosts = none.filter((h) => typeof h === 'string' && h !== 'all-urls' && /^[a-z0-9.\\-_[\\]:]+$/.test(h));"
     "  const enabled = Array.isArray(lite.rulesetConfig?.enabledRulesets) ? lite.rulesetConfig.enabledRulesets : null;"
     "  const defaults = Array.isArray(lite.defaultRulesetIds) ? lite.defaultRulesetIds : [];"
     "  const keys = Object.keys(l.available);"
     "  const lookup = (id) => (map[id] || keys.filter((k) => k.toLowerCase() === String(id).toLowerCase())).filter((k) => l.available[k]);"
     "  const pick = new Set(selected(l));"
     "  if (enabled) {"
     "    for (const id of defaults) if (!enabled.includes(id)) for (const k of lookup(id)) pick.delete(k);"
     "    for (const id of enabled) if (!defaults.includes(id)) for (const k of lookup(id)) pick.add(k);"
     "  }"
     "  const whitelist = [...new Set(t.whitelist.filter((d) => d !== offDirective).concat(hosts, off ? [offDirective] : []))];"
     "  let written = Promise.resolve(null);"
     "  if (!sameSet(pick, selected(l)))"
     "    written = written.then(() => applyLists([...pick]));"
     "  if (!sameSet(whitelist, t.whitelist))"
     "    written = written.then(() => send({what: 'setWhitelist', whitelist: whitelist.join('\\n')}));"
     "  if (off) written = written.then(() => send({what: 'userSettings', name: 'autoUpdate', value: false}));"
     "  return written.then(() => ({off, hosts: hosts.length, lists: pick.size}));"
     "})";

NSString *LiteReaderPath() {
  NSString *path = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:[@"Extensions" stringByAppendingPathComponent:kLiteReaderName]];
  return [NSFileManager.defaultManager fileExistsAtPath:[path stringByAppendingPathComponent:@"manifest.json"]] ? path : nil;
}

NSString *LiteMarker(ArdiaCoreProfile *p) {
  return p.path.length ? [p.path stringByAppendingPathComponent:kLiteMovedMarker] : nil;
}

bool LiteSettingsPending(ArdiaCoreProfile *p) {
  NSString *marker = LiteMarker(p);
  if (!marker || [NSFileManager.defaultManager fileExistsAtPath:marker]) return false;
  NSString *store = [p.path stringByAppendingPathComponent:[@"Local Extension Settings" stringByAppendingPathComponent:kLiteId]];
  return [NSFileManager.defaultManager fileExistsAtPath:store];
}

void MarkLiteSettingsMoved(ArdiaCoreProfile *p, NSString *summary) {
  NSLog(@"[blocker] uBlock Origin Lite's settings: %@", summary);
  [summary writeToFile:LiteMarker(p) atomically:YES encoding:NSUTF8StringEncoding error:nil];
}

constexpr double kLiteReadSeconds = 10;

void ReadLiteSettings(NSString *profile, ArdiaCoreProfile *p, void (^done)(NSDictionary *lite, NSString *error)) {
  done = [done copy];
  NSString *reader = LiteReaderPath();
  if (!reader) return done(nil, @"the reader isn't in the app");
  if (![[p loadComponentExtension:reader] isEqualToString:kLiteId]) return done(nil, @"the reader didn't load");
  NSString *key = [@"lite:" stringByAppendingString:profile];
  ACContentBlockerPage *page = HiddenPage(key, profile, p, kLiteId, @"read.html");
  __block bool answered = false;
  void (^finish)(NSDictionary *, NSString *) = ^(NSDictionary *lite, NSString *error) {
    if (answered) return;
    answered = true;
    [page fail:@"read"];
    [Pages() removeObjectForKey:key];
    if ([p respondsToSelector:@selector(unloadComponentExtension:)]) [p unloadComponentExtension:kLiteId];
    done(lite, error);
  };
  if (!page) return finish(nil, @"no reader page");
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLiteReadSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    finish(nil, @"the reader timed out");
  });
  [page run:@"chrome.storage.local.get(['filteringModeDetails', 'rulesetConfig', 'defaultRulesetIds'])"
             ".then((v) => post('result', JSON.stringify({value: v})), (e) => post('result', JSON.stringify({error: String(e && e.message || e)})))"
      completion:^(NSDictionary *lite, NSString *error) {
        finish([lite isKindOfClass:NSDictionary.class] ? lite : nil, error ?: ([lite isKindOfClass:NSDictionary.class] ? nil : @"unreadable"));
      }];
}

bool LiteSettingsUsable(NSDictionary *lite) {
  NSDictionary *modes = lite[@"filteringModeDetails"], *config = lite[@"rulesetConfig"];
  const bool modesOk = [modes isKindOfClass:NSDictionary.class] && (!modes[@"none"] || [modes[@"none"] isKindOfClass:NSArray.class]);
  const bool configOk = [config isKindOfClass:NSDictionary.class] && (!config[@"enabledRulesets"] || [config[@"enabledRulesets"] isKindOfClass:NSArray.class]);
  return modesOk || configOk;
}

void MoveLiteSettings(NSString *profile, ArdiaCoreProfile *p, void (^done)(void)) {
  done = [done copy];
  if (!LiteSettingsPending(p)) return done();
  ReadLiteSettings(profile, p, ^(NSDictionary *lite, NSString *error) {
    if (error) {
      NSLog(@"[blocker] uBlock Origin Lite's settings weren't read (%@); trying again next launch", error);
      return done();
    }
    if (!LiteSettingsUsable(lite)) {
      NSLog(@"[blocker] uBlock Origin Lite's settings aren't in a shape we know (%@); trying again next launch", lite.allKeys);
      return done();
    }
    Call(profile, ScriptWith(kMoveLite, @[ lite, LiteListMap() ]), ^(NSDictionary *result, NSString *moveError) {
      if (moveError) {
        NSLog(@"[blocker] uBlock Origin Lite's settings didn't move (%@); trying again next launch", moveError);
        return done();
      }
      MarkLiteSettingsMoved(p, [NSString stringWithFormat:@"moved (%@)", result]);
      done();
    });
  });
}

NSString *const kMovedToEngineMarker = @"uBlock Origin settings moved to the engine's";
NSString *const kEngineBlockerSetUpMarker = @"uBlock Origin set up for Ardia";
NSString *AppBlockerStore(ArdiaCoreProfile *p) {
  return [p.path stringByAppendingPathComponent:[@"Local Extension Settings" stringByAppendingPathComponent:kAppBlockerId]];
}

bool MoveToEnginePending(ArdiaCoreProfile *p) {
  if (!p.path.length || !HasEngineBlocker(p) || !ExtensionPath()) return false;
  NSFileManager *files = NSFileManager.defaultManager;
  return ![files fileExistsAtPath:[p.path stringByAppendingPathComponent:kMovedToEngineMarker]] &&
         [files fileExistsAtPath:AppBlockerStore(p)];
}

bool MarkMovedToEngine(ArdiaCoreProfile *p, NSString *summary) {
#if DEBUG
  if (getenv("ARDIA_BLOCKER_MOVE_MARKER_FAILS")) return false;
#endif
  if (![summary writeToFile:ProfileFile(p, kMovedToEngineMarker) atomically:YES encoding:NSUTF8StringEncoding error:nil]) return false;
  NSLog(@"[blocker] uBlock Origin settings for %@: %@", p.path.lastPathComponent, summary);
  return true;
}

NSString *const kBackupAppBlocker =
    @"Promise.all([send({what: 'backupUserData'}), fetch('/assets/assets.json').then((r) => r.json())]).then(([backup, assets]) => {"
     "  const data = backup && backup.userData;"
     "  if (!data || !Array.isArray(data.selectedFilterLists) || typeof data.userFilters !== 'string') throw new Error('backupUserData: no user data');"
     "  const ublock = chrome.extension.getBackgroundPage().µBlock;"
     "  const byEnvironment = (id) => assets[id].off === true && ublock.listMatchesEnvironment(assets[id]);"
     "  const defaults = Object.keys(assets).filter((id) => assets[id].content === 'filters' && (assets[id].off !== true || byEnvironment(id)));"
     "  const picked = data.selectedFilterLists.filter((id) => id !== 'user-filters');"
     "  const customLists = !sameSet(picked, defaults) || !data.selectedFilterLists.includes('user-filters');"
     "  return {userData: data, customLists, regional: defaults.filter(byEnvironment)};"
     "})";

NSString *const kRestoreIntoEngineBlocker =
    @"Promise.resolve(chrome.extension.getBackgroundPage().performance.timeOrigin).then((before) =>"
     "  send({what: 'restoreUserData', userData: %@, file: %@}).catch((e) => { if (!String(e && e.message).includes('no reply')) throw e; })"
     "    .then(() => before))";

NSString *const kRestartedEngineBlocker =
    @"local.get(['lastRestoreFile']).then((stored) => {"
     "  const want = %@;"
     "  const background = chrome.extension.getBackgroundPage();"
     "  if (stored.lastRestoreFile !== want.restoreFile) throw new Error('uBlock Origin restarting: the restore has not landed');"
     "  if (!background || !(background.performance.timeOrigin > want.restoreStartedAt)) throw new Error('uBlock Origin restarting: not restarted since the restore');"
     "  return lists();"
     "}).then((l) => {"
     "  const want = %@;"
     "  const chosen = selected(l);"
     "  const missing = (want.regional || []).filter((id) => l.available[id] && !chosen.includes(id));"
     "  return missing.length ? applyLists(chosen.concat(missing)) : null;"
     "})";

NSString *const kVerifyEngineBlocker =
    @"Promise.all([lists(), trusted(), send({what: 'readUserFilters'}), send({what: 'userSettings'}), send({what: 'getRules'}), send({what: 'readHiddenSettings'})])"
     ".then(([l, t, f, settings, rules, hidden]) => {"
     "  const want = %@;"
     "  const missing = [];"
     "  if (!sameSet(t.whitelist, want.whitelist || [])) missing.push('trusted sites');"
     "  if ((f && f.content || '').trim() !== (want.userFilters || '').trim()) missing.push('my filters');"
     "  const chosen = selected(l).filter((id) => id !== 'user-filters');"
     "  const lists = (want.lists || want.regional || []).filter((id) => id !== 'user-filters' && l.available[id]);"
     "  if (Array.isArray(want.lists) ? !sameSet(chosen, lists) : lists.some((id) => !chosen.includes(id))) missing.push('filter lists');"
     "  if (Array.isArray(want.lists) && want.lists.includes('user-filters') !== !!(f && f.enabled)) missing.push('my filters on/off');"
     "  const have = new Set(rules && Array.isArray(rules.permanentRules) ? rules.permanentRules : []);"
     "  const lines = [want.dynamicFilteringString, want.hostnameSwitchesString, want.urlFilteringString]"
     "    .flatMap((s) => typeof s === 'string' ? s.split('\\n') : []).map((s) => s.trim()).filter(Boolean);"
     "  if (lines.some((line) => !have.has(line))) missing.push('per-site switches and rules');"
     "  const drifted = Object.keys(want.userSettings || {}).filter((k) => k in settings && JSON.stringify(settings[k]) !== JSON.stringify(want.userSettings[k]));"
     "  if (drifted.length) missing.push('settings ' + drifted.join(' '));"
     "  const current = hidden && hidden.current || {};"
     "  const defaults = hidden && hidden.default || {};"
     "  const hiddenDrifted = Object.keys(want.hiddenSettings || {}).filter((k) => k in defaults &&"
     "    JSON.stringify(want.hiddenSettings[k]) !== JSON.stringify(defaults[k]) && JSON.stringify(current[k]) !== JSON.stringify(want.hiddenSettings[k]));"
     "  if (hiddenDrifted.length) missing.push('advanced settings ' + hiddenDrifted.join(' '));"
     "  if (missing.length) throw new Error('not carried over: ' + missing.join(', '));"
     "  return {trusted: t.whitelist.length, filters: (want.userFilters || '').split('\\n').filter((s) => s.trim()).length,"
     "    lists: want.lists ? lists.length : 'engine defaults', regional: (want.regional || []).length, rules: lines.length,"
     "    settings: Object.keys(want.userSettings || {}).length, advanced: Object.keys(want.hiddenSettings || {}).length};"
     "})";


void MoveToEngine(NSString *profile, ArdiaCoreProfile *p, void (^done)(void)) {
  done = [done copy];
  if (!MoveToEnginePending(p)) return done();
  if (!CanMoveToEngine(p)) {
    NSLog(@"[blocker] this engine can't save the switch to its uBlock Origin; the bundled one keeps blocking");
    return done();
  }
  void (^failed)(NSString *) = ^(NSString *error) {
    NSLog(@"[blocker] uBlock Origin settings didn't move to the engine's (%@); the bundled one keeps blocking, trying again next launch", error);
    ClosePages(profile);
    TurnOffEngineBlocker(profile, p, done);
  };
  CallBlocker(profile, kAppBlockerId, kAttempts, kBackupAppBlocker, ^(NSDictionary *backup, NSString *error) {
    NSMutableDictionary *userData = [backup isKindOfClass:NSDictionary.class] && [backup[@"userData"] isKindOfClass:NSDictionary.class]
                                        ? [backup[@"userData"] mutableCopy]
                                        : nil;
    if (error || !userData) return failed(error ?: @"no backup");
    const bool customLists = [backup[@"customLists"] boolValue];
    if (!customLists) [userData removeObjectForKey:@"selectedFilterLists"];
    NSMutableDictionary *want = [userData mutableCopy];
    want[@"lists"] = userData[@"selectedFilterLists"] ?: NSNull.null;
    want[@"regional"] = !customLists && [backup[@"regional"] isKindOfClass:NSArray.class] ? backup[@"regional"] : @[];
    want[@"restoreFile"] = [NSString stringWithFormat:@"Ardia %.0f", floor(NSDate.date.timeIntervalSince1970 * 1000)];
#if DEBUG
    const char *forcedMismatch = getenv("ARDIA_BLOCKER_MOVE_MISMATCH");
    if (forcedMismatch && !strcmp(forcedMismatch, "filters")) want[@"userFilters"] = [want[@"userFilters"] stringByAppendingString:@"\n||mismatch.invalid^"];
    if (forcedMismatch && !strcmp(forcedMismatch, "lists") && [want[@"lists"] isKindOfClass:NSArray.class]) want[@"lists"] = [want[@"lists"] arrayByAddingObject:@"adguard-generic"];
#endif
    [NSFileManager.defaultManager removeItemAtPath:ProfileFile(p, kEngineBlockerSetUpMarker) error:nil];
    SetEngineBlockerEnabled(profile, YES, ^(NSString *onError) {
      if (onError) return failed([@"the engine's uBlock Origin didn't turn on: " stringByAppendingString:onError]);
      CallBlocker(profile, kEngineBlockerId, kAttempts, @"null", ^(id, NSString *readyError) {
        if (readyError) return failed([@"the engine's uBlock Origin didn't start: " stringByAppendingString:readyError]);
        CallBlocker(profile, kEngineBlockerId, 0, ScriptWith(kRestoreIntoEngineBlocker, @[ userData, want[@"restoreFile"] ]), ^(NSNumber *before, NSString *restoreError) {
          if (restoreError || ![before isKindOfClass:NSNumber.class]) return failed([@"restoreUserData: " stringByAppendingString:restoreError ?: @"no answer"]);
          want[@"restoreStartedAt"] = before;
          CallBlocker(profile, kEngineBlockerId, kAttempts, ScriptWith(kRestartedEngineBlocker, @[ want, want ]), ^(id, NSString *restartError) {
            if (restartError) return failed(restartError);
            CallBlocker(profile, kEngineBlockerId, kAttempts, ScriptWith(kVerifyEngineBlocker, @[ want ]), ^(id moved, NSString *verifyError) {
              if (verifyError) return failed(verifyError);
              [p commitPendingPreferenceWrites:^{
                if (!EngineBlockerOn(p)) return failed(@"the engine's uBlock Origin went off before the switch was saved");
                if (!MarkMovedToEngine(p, [NSString stringWithFormat:@"moved (%@)", moved])) return failed(@"the moved marker didn't save");
                [NSFileManager.defaultManager removeItemAtPath:ProfileFile(p, kEngineBlockerOffMarker) error:nil];
#if DEBUG
                if (getenv("ARDIA_BLOCKER_MOVE_EXIT_AFTER_MARKER")) _exit(9);
#endif
                ClosePages(profile);
                [p unloadComponentExtension:kAppBlockerId];
                NSLog(@"[blocker] profile \"%@\" blocks with the engine's uBlock Origin", profile);
                done();
              }];
            });
          });
        });
      });
    });
  });
}

NSString *const kSetUpEngineBlocker =
    @"send({what: 'userSettings', name: 'contextMenuEnabled', value: false})"
     ".then(() => send({what: 'userSettings', name: 'showIconBadge', value: false}))"
     ".then(() => send({what: 'userSettings'}))"
     ".then((settings) => {"
     "  if (!settings || settings.contextMenuEnabled !== false || settings.showIconBadge !== false) throw new Error('userSettings: not applied');"
     "  return null;"
     "})";

bool EngineBlockerSetUpPending(ArdiaCoreProfile *p) {
  return p.path.length && UsesEngineBlocker(p) &&
         ![NSFileManager.defaultManager fileExistsAtPath:[p.path stringByAppendingPathComponent:kEngineBlockerSetUpMarker]];
}

void SetUpEngineBlocker(NSString *profile, ArdiaCoreProfile *p, void (^done)(void)) {
  done = [done copy];
  if (!EngineBlockerSetUpPending(p)) return done();
  Call(profile, kSetUpEngineBlocker, ^(id, NSString *error) {
    if (error) NSLog(@"[blocker] the engine's uBlock Origin keeps its context menu and badge (%@); trying again next launch", error);
    else [@"context menu and badge off" writeToFile:[p.path stringByAppendingPathComponent:kEngineBlockerSetUpMarker] atomically:YES encoding:NSUTF8StringEncoding error:nil];
    done();
  });
}

void PrepareEngineBlocker(NSString *profile, ArdiaCoreProfile *p, void (^done)(void)) {
  done = [done copy];
  MoveToEngine(profile, p, ^{ SetUpEngineBlocker(profile, p, done); });
}

NSMutableArray<void (^)(void)> *SettledWaiters() {
  static NSMutableArray *waiters = [NSMutableArray array];
  return waiters;
}

void WhenDefaultSettled(void (^then)(void)) {
  if (gDefaultSettled) return then();
  [SettledWaiters() addObject:[then copy]];
}

void DefaultSettled() {
  gDefaultSettled = true;
  gLaunching = false;
  NSArray<void (^)(void)> *waiters = [SettledWaiters() copy];
  [SettledWaiters() removeAllObjects];
  for (void (^waiter)(void) in waiters) waiter();
}

constexpr int kInheritAttempts = 6;

void Inherit(NSString *profile, int attempt, void (^first)(NSString *error)) {
  first = [first copy];
  FollowDefault(@[ profile ], ^(NSString *error) {
    if (first) first(error);
    const bool gone = !ardiacore_host::LoadedProfile(profile) || ardiacore_host::IsDeletedProfile(profile) ||
                      ![LoadedProfiles() containsObject:profile];
    if (!error || gone || attempt + 1 >= kInheritAttempts) {
      if (error && !gone) NSLog(@"[blocker] profile \"%@\" didn't take the default profile's settings: %@", profile, error);
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((1 << attempt) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      Inherit(profile, attempt + 1, nil);
    });
  });
}

void LoadHeld(NSString *profile) {
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  const bool isDefault = profile.length == 0;
  const bool firstLoad = p && ![LoadedProfiles() containsObject:profile];
  const bool hold = firstLoad && [p respondsToSelector:@selector(holdNavigationsUntilRulesetsOf:)] &&
                    (isDefault ? LiteSettingsPending(p) || MoveToEnginePending(p) : !gLaunching);
  if (hold) [p holdNavigationsUntilRulesetsOf:BlockerId(p)];
  void (^release)(NSString *) = ^(NSString *why) {
    if (!hold) return;
    if (!why && [p respondsToSelector:@selector(releaseNavigationHoldReady)]) [p releaseNavigationHoldReady];
    else [p releaseNavigationHold:why ?: @"uBlock Origin is ready"];
  };
  void (^load)(void) = ^{
    LoadIntoProfile(profile, ^(NSString *error) {
      if (error) {
        if (isDefault) DefaultSettled();
        return release([@"the content blocker didn't load: " stringByAppendingString:error]);
      }
      if (!isDefault) {
        return PrepareEngineBlocker(profile, ardiacore_host::LoadedProfile(profile), ^{
          WhenDefaultSettled(^{
            Inherit(profile, 0, ^(NSString *followError) {
              release(followError ? [@"the default profile's settings didn't apply: " stringByAppendingString:followError] : nil);
            });
          });
        });
      }
      void (^settle)(void) = ^{
        ArdiaCoreProfile *current = ardiacore_host::LoadedProfile(profile);
        if (!hold && current && SettleWithoutPage() && !LiteSettingsPending(current) && !MoveToEnginePending(current) &&
            !EngineBlockerSetUpPending(current))
          return DefaultSettled();
        Call(profile, @"null", ^(id, NSString *readyError) {
          ArdiaCoreProfile *loaded = ardiacore_host::LoadedProfile(profile);
          if (readyError || !loaded) {
            DefaultSettled();
            return release(readyError ? [@"uBlock Origin isn't ready: " stringByAppendingString:readyError] : nil);
          }
          PrepareEngineBlocker(profile, loaded, ^{
            MoveLiteSettings(profile, loaded, ^{
              DefaultSettled();
              release(nil);
            });
          });
        });
      };
      if (hold || !gLaunching) return settle();
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kSettleAfterLaunchSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), settle);
    });
  };
  const double delay = std::exchange(gDelayNextLoadMs, 0);
  if (delay > 0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_MSEC)), dispatch_get_main_queue(), load);
  else load();
}

NSString *Category(NSString *listId, NSString *group) {
  if ([group isEqual:@"regions"]) return @"regional";
  if ([listId containsString:@"cookie"]) return @"cookies";
  if ([listId hasSuffix:@"-annoyances"]) return @"annoyances";
  if ([group isEqual:@"privacy"] || [listId isEqual:@"ublock-privacy"]) return @"trackers";
  if ([group isEqual:@"malware"] || [listId isEqual:@"ublock-badware"]) return @"security";
  if ([group isEqual:@"annoyances"] || [group isEqual:@"social"]) return @"annoyances";
  return @"ads";
}

double Count(id value) { return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0; }

NSString *BundledVersion() {
  NSString *path = [ExtensionPath() stringByAppendingPathComponent:@"manifest.json"];
  NSData *data = path ? [NSData dataWithContentsOfFile:path] : nil;
  NSDictionary *manifest = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![manifest isKindOfClass:NSDictionary.class]) return @"";
  for (NSString *key in @[ @"version_name", @"version" ])
    if ([manifest[key] isKindOfClass:NSString.class]) return manifest[key];
  return @"";
}

NSString *const kState =
    @"Promise.all([lists(), trusted(), fetch('/assets/assets.json').then((r) => r.json())]).then(([l, t, assets]) => {"
     "  const langs = new Set([chrome.i18n.getUILanguage(), ...(navigator.languages || [])].map((x) => (/^[a-z]+/.exec(x) || [])[0]).filter(Boolean));"
     "  const forLanguages = (lang) => typeof lang === 'string' && lang.split(/\\s+/).some((x) => langs.has(x));"
     "  const onByDefault = (id) => !!assets[id] && (assets[id].off !== true || forLanguages(assets[id].lang));"
     "  return {"
     "    lists: Object.entries(l.available)"
     "      .filter(([id, list]) => list && list.content === 'filters' && list.group !== 'user' && list.group !== 'custom')"
     "      .map(([id, list]) => ({id, title: list.title || id, group: list.group || '', enabled: list.off !== true,"
     "        defaultOn: onByDefault(id), filters: list.entryCount || 0})),"
     "    networkFilters: l.netFilterCount || 0,"
     "    cosmeticFilters: l.cosmeticFilterCount || 0,"
     "    enabled: !t.whitelist.includes(offDirective),"
     "    allowedHosts: t.whitelist.filter((d) => !d.includes('/') && !d.startsWith('#') && !(t.whitelistDefault || []).includes(d)),"
     "    version: chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version,"
     "  };"
     "})";

void State(void (^completion)(NSDictionary *state)) {
  completion = [completion copy];
  if (!gDefaultSettled && ArdiaCoreHost.isStarted) return WhenDefaultSettled(^{ State(completion); });
  Call(kProfile, kState, ^(NSDictionary *read, NSString *error) {
    if (![read isKindOfClass:NSDictionary.class] || ![read[@"lists"] isKindOfClass:NSArray.class]) {
      return completion(@{
        @"enabled" : @NO, @"lists" : @[], @"allowedHosts" : @[], @"version" : BundledVersion(),
        @"stats" : @{@"ready" : @NO, @"enabled" : @NO, @"parseMs" : @0, @"lookups" : @0, @"averageLookupMicros" : @0,
                     @"maxLookupMicros" : @0, @"error" : error ?: @"unavailable"},
      });
    }
    NSMutableArray *lists = [NSMutableArray array];
    for (NSDictionary *l in read[@"lists"]) {
      if (![l isKindOfClass:NSDictionary.class] || ![l[@"id"] isKindOfClass:NSString.class]) continue;
      [lists addObject:@{
        @"id" : l[@"id"],
        @"title" : [l[@"title"] isKindOfClass:NSString.class] ? l[@"title"] : l[@"id"],
        @"category" : Category(l[@"id"], [l[@"group"] isKindOfClass:NSString.class] ? l[@"group"] : @""),
        @"enabled" : @([l[@"enabled"] boolValue]),
        @"defaultOn" : @([l[@"defaultOn"] boolValue]),
        @"filters" : @(Count(l[@"filters"])),
      }];
    }
    NSMutableArray *allowed = [NSMutableArray array];
    for (NSString *host in [read[@"allowedHosts"] isKindOfClass:NSArray.class] ? read[@"allowedHosts"] : @[])
      if ([host isKindOfClass:NSString.class]) [allowed addObject:host];
    const BOOL on = [read[@"enabled"] boolValue];
    completion(@{
      @"enabled" : @(on),
      @"version" : [read[@"version"] isKindOfClass:NSString.class] ? read[@"version"] : BundledVersion(),
      @"lists" : lists,
      @"allowedHosts" : allowed,
      @"stats" : @{
        @"ready" : @YES, @"enabled" : @(on), @"networkFilters" : @(Count(read[@"networkFilters"])),
        @"cosmeticFilters" : @(Count(read[@"cosmeticFilters"])), @"parseMs" : @0, @"lookups" : @0,
        @"averageLookupMicros" : @0, @"maxLookupMicros" : @0,
      },
    });
  });
}

void Changed(NSString *error, void (^completion)(NSString *error)) {
  if (error) return completion(error);
  completion = [completion copy];
  FollowDefault(nil, ^(NSString *followError) {
    State(^(NSDictionary *state) { if (ArdiaCoreHost.eventHandler) ArdiaCoreHost.eventHandler(@"contentBlocker", state[@"stats"]); });
    completion(followError);
  });
}

}

namespace ardiacore_host {
void PrepareContentBlocker() {
  StartPreparing();
}

void LoadContentBlocker(NSString *profile) {
  if (!IsIncognito(profile)) LoadHeld(profile ?: @"");
}
}

@implementation ArdiaCoreContentBlocker

+ (void)state:(void (^)(NSDictionary<NSString *, id> *))completion {
  State(completion);
}

+ (void)setEnabled:(BOOL)enabled completion:(void (^)(NSString *))completion {
  if (!gDefaultSettled && ArdiaCoreHost.isStarted) {
    completion = [completion copy];
    return WhenDefaultSettled(^{ [self setEnabled:enabled completion:completion]; });
  }
  NSString *script = @"trusted().then((t) => {"
                      "  const on = %@;"
                      "  const kept = t.whitelist.filter((d) => d !== offDirective);"
                      "  return send({what: 'setWhitelist', whitelist: (on ? kept : kept.concat([offDirective])).join('\\n')});"
                      "}).then(() => send({what: 'userSettings', name: 'autoUpdate', value: %@}))";
  Call(kProfile, ScriptWith(script, @[ @(enabled), @(enabled) ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(NSString *))completion {
  if (!gDefaultSettled && ArdiaCoreHost.isStarted) {
    completion = [completion copy];
    return WhenDefaultSettled(^{ [self setList:listId enabled:enabled completion:completion]; });
  }
  NSString *script = @"lists().then((l) => {"
                      "  const [id, on] = [%@, %@];"
                      "  if (!l.available[id]) throw new Error(`no list ${id}`);"
                      "  const keep = selected(l).filter((x) => x !== id);"
                      "  return applyLists(on ? keep.concat([id]) : keep);"
                      "})";
  Call(kProfile, ScriptWith(script, @[ listId, @(enabled) ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL))completion {
  NSString *script = @"trusted().then((t) => t.whitelist.some((d) => covers(d, %@)))";
  Call(kProfile, ScriptWith(script, @[ host.lowercaseString ]), ^(id allowed, NSString *error) {
    completion(!error && [allowed isKindOfClass:NSNumber.class] && [allowed boolValue]);
  });
}

+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(NSString *))completion {
  if (!gDefaultSettled && ArdiaCoreHost.isStarted) {
    completion = [completion copy];
    return WhenDefaultSettled(^{ [self setAllowed:allowed onHost:host completion:completion]; });
  }
  NSString *script = @"trusted().then((t) => {"
                      "  const [allowed, host] = [%@, %@];"
                      "  const kept = t.whitelist.filter((d) => allowed ? d !== host : !covers(d, host));"
                      "  return send({what: 'setWhitelist', whitelist: (allowed ? kept.concat([host]) : kept).join('\\n')});"
                      "})";
  Call(kProfile, ScriptWith(script, @[ @(allowed), host.lowercaseString ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)devFailNextMessage {
  gFailNextMessage = true;
}

+ (void)devDelayNextLoad:(double)ms {
  gDelayNextLoadMs = ms;
}

@end
