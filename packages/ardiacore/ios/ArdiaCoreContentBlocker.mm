#import "ArdiaCoreServices.h"
#import "ArdiaCoreInternal.h"

#import <CommonCrypto/CommonDigest.h>
#include <sys/clonefile.h>
#include <sys/stat.h>

#include <utility>

namespace {
NSString *ExtensionId() { return @"bnjeokpoejhioagiokhkhmdogkhbnbki"; }
bool gFailNextMessage = false;
double gDelayNextLoadMs = 0;
}

@interface ACContentBlockerPage : NSObject <ArdiaCoreTabDelegate>
@property(readonly) ArdiaCoreTab *tab;
@property(readonly) BOOL dead;
@end

@implementation ACContentBlockerPage {
  NSMutableArray<NSArray *> *_calls;
  BOOL _loaded;
  BOOL _busy;
}

- (instancetype)initWithTab:(ArdiaCoreTab *)tab {
  if ((self = [super init])) {
    _tab = tab;
    _calls = [NSMutableArray array];
    tab.delegate = self;
  }
  return self;
}

- (void)run:(NSString *)script completion:(void (^)(id value, NSString *error))completion {
  if (_dead) return completion(nil, @"closed");
  [_calls addObject:@[ script, [completion copy] ]];
  [self next];
}

- (void)next {
  if (_dead || !_loaded || _busy || !_calls.count) return;
  NSArray *call = _calls.firstObject;
  [_calls removeObjectAtIndex:0];
  void (^completion)(id, NSString *) = call[1];
  _busy = YES;
  [_tab evaluate:call[0]
      completion:^(NSString *json) {
        self->_busy = NO;
        NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *answer = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        NSString *error = ![answer isKindOfClass:NSDictionary.class] ? @"no answer"
                          : [answer[@"error"] isKindOfClass:NSString.class] ? answer[@"error"]
                                                                              : nil;
        id value = error || answer[@"value"] == NSNull.null ? nil : answer[@"value"];
        completion(value, error);
        if ([error containsString:@"context invalidated"]) [self fail:error];
        [self next];
      }];
}

- (void)fail:(NSString *)error {
  if (_dead) return;
  _dead = YES;
  NSArray<NSArray *> *calls = _calls;
  _calls = nil;
  for (NSArray *call in calls) ((void (^)(id, NSString *))call[1])(nil, error);
  [_tab closeNow];
}

- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab {
  _loaded = !tab.loading;
  [self next];
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

namespace {

NSString *ExtensionPath();

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

constexpr int kModeNone = 0;
constexpr int kModeOptimal = 2;

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

ACContentBlockerPage *PageFor(NSString *profile, ArdiaCoreProfile *p) {
  ACContentBlockerPage *page = Pages()[profile];
  if (page.tab.closed) [page fail:@"closed"];
  if (page && !page.dead) return page;
  ArdiaCoreWindow *window = PageWindows()[profile];
  if (!window) {
    PageWindows()[profile] = window = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)];
    if ([window respondsToSelector:@selector(setInternal:)]) window.internal = YES;
  }
  ArdiaCoreTab *tab = [window openTab:[NSString stringWithFormat:@"chrome-extension://%@/manifest.json", ExtensionId()] profile:p foreground:YES];
  return Pages()[profile] = tab ? [[ACContentBlockerPage alloc] initWithTab:tab] : nil;
}

NSString *Fingerprint(NSString *dir) {
  NSString *stamped = [NSString stringWithContentsOfFile:[dir stringByAppendingString:@".fingerprint"]
                                                encoding:NSUTF8StringEncoding
                                                   error:nil];
  stamped = [stamped stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (stamped.length) return stamped;
  NSData *manifest = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"manifest.json"]];
  if (!manifest) return nil;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(manifest.bytes, (CC_LONG)manifest.length, digest);
  NSMutableString *fingerprint = [NSMutableString string];
  for (unsigned char byte : digest) [fingerprint appendFormat:@"%02x", byte];
  unsigned long long files = 0, bytes = 0;
  NSDirectoryEnumerator<NSURL *> *entries = [NSFileManager.defaultManager enumeratorAtURL:[NSURL fileURLWithPath:dir]
                                                               includingPropertiesForKeys:@[ NSURLFileSizeKey ]
                                                                                  options:0
                                                                             errorHandler:nil];
  for (NSURL *entry in entries) {
    if ([entry.lastPathComponent isEqualToString:@"_metadata"]) {
      [entries skipDescendants];
      continue;
    }
    NSNumber *size;
    [entry getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
    files++;
    bytes += size.unsignedLongLongValue;
  }
  [fingerprint appendFormat:@"-%llu-%llu", files, bytes];
  return fingerprint;
}

NSString *WritableCopy(NSString *bundled) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *dir = [[ArdiaCoreHost.dataDirectory stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"Built-in Extensions"];
  NSString *copy = [dir stringByAppendingPathComponent:@"ublock-lite"];
  NSString *stampPath = [dir stringByAppendingPathComponent:@"ublock-lite.source"];
  NSString *fingerprint = Fingerprint(bundled);
  NSString *stamp = [NSString stringWithContentsOfFile:stampPath encoding:NSUTF8StringEncoding error:nil];
  if (fingerprint && [stamp isEqualToString:fingerprint] &&
      [fm fileExistsAtPath:[copy stringByAppendingPathComponent:@"manifest.json"]])
    return copy;

  NSError *error;
  if (![fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:&error]) {
    NSLog(@"[blocker] %@: %@", dir, error);
    return nil;
  }
  for (NSString *name in [fm contentsOfDirectoryAtPath:dir error:nil])
    if ([name hasPrefix:@".ublock-lite"]) [fm removeItemAtPath:[dir stringByAppendingPathComponent:name] error:nil];
  NSString *staging = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@".ublock-lite-%d", getpid()]];
  bool cloned = clonefile(bundled.fileSystemRepresentation, staging.fileSystemRepresentation, 0) == 0;
  if (!cloned) [fm removeItemAtPath:staging error:nil];
  if (!cloned && ![fm copyItemAtPath:bundled toPath:staging error:&error]) {
    NSLog(@"[blocker] copying %@: %@", bundled, error);
    [fm removeItemAtPath:staging error:nil];
    return nil;
  }
  NSDirectoryEnumerator<NSString *> *entries = [fm enumeratorAtPath:staging];
  for (NSString *entry = @""; entry; entry = entries.nextObject) {
    NSString *path = [staging stringByAppendingPathComponent:entry];
    struct stat info;
    if (lstat(path.fileSystemRepresentation, &info) == 0 && !S_ISLNK(info.st_mode) && !(info.st_mode & S_IWUSR))
      chmod(path.fileSystemRepresentation, info.st_mode | S_IWUSR);
  }
  [fm removeItemAtPath:[staging stringByAppendingPathComponent:@"_metadata"] error:nil];

  NSString *old = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@".ublock-lite-old-%d", getpid()]];
  bool hadCopy = [fm fileExistsAtPath:copy];
  if ((hadCopy && ![fm moveItemAtPath:copy toPath:old error:&error]) || ![fm moveItemAtPath:staging toPath:copy error:&error]) {
    NSLog(@"[blocker] installing %@: %@", copy, error);
    [fm removeItemAtPath:staging error:nil];
    return nil;
  }
  if (hadCopy) [fm removeItemAtPath:old error:nil];
  [fingerprint writeToFile:stampPath atomically:YES encoding:NSUTF8StringEncoding error:nil];
  return copy;
}

NSString *gExtensionPath;
dispatch_group_t Preparing() {
  static dispatch_group_t group = dispatch_group_create();
  return group;
}

void StartPreparing() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    dispatch_group_async(Preparing(), dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSString *bundled = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"Extensions/ublock-lite"];
      if ([NSFileManager.defaultManager fileExistsAtPath:[bundled stringByAppendingPathComponent:@"manifest.json"]])
        gExtensionPath = WritableCopy(bundled);
    });
  });
}

NSString *ExtensionPath() {
  StartPreparing();
  dispatch_group_wait(Preparing(), DISPATCH_TIME_FOREVER);
  return gExtensionPath;
}

void FollowDefault(NSArray<NSString *> *profiles, void (^done)(NSString *error));

void LoadIntoProfile(NSString *profile, void (^then)(NSString *error)) {
  then = [then copy];
  StartPreparing();
  dispatch_group_notify(Preparing(), dispatch_get_main_queue(), ^{
    if ([LoadedProfiles() containsObject:profile]) return then(nil);
    ardiacore_host::WithProfile(profile, ^(ArdiaCoreProfile *p) {
      if ([LoadedProfiles() containsObject:profile]) return then(nil);
      NSString *path = gExtensionPath;
      if (!p || !path || ![p respondsToSelector:@selector(loadComponentExtension:)]) return then(@"not loaded");
      NSString *loaded = [p loadComponentExtension:path];
      if (![loaded isEqualToString:ExtensionId()]) {
        NSLog(@"[blocker] component load failed (%@)", loaded);
        return then(@"not loaded");
      }
      [LoadedProfiles() addObject:profile];
      if (profile.length) FollowDefault(@[ profile ], ^(NSString *) {});
      then(nil);
    });
  });
}

void LoadHeld(NSString *profile) {
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  const bool hold = p && ![LoadedProfiles() containsObject:profile] && [p respondsToSelector:@selector(holdNavigationsUntilRulesetsOf:)];
  if (hold) [p holdNavigationsUntilRulesetsOf:ExtensionId()];
  void (^load)(void) = ^{
    LoadIntoProfile(profile, ^(NSString *error) {
      if (error && hold) [p releaseNavigationHold:[NSString stringWithFormat:@"the content blocker didn't load: %@", error]];
    });
  };
  const double delay = std::exchange(gDelayNextLoadMs, 0);
  if (delay > 0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_MSEC)), dispatch_get_main_queue(), load);
  else load();
}

void Call(NSString *profile, NSString *expression, void (^completion)(id value, NSString *error)) {
  completion = [completion copy];
  if (!ArdiaCoreHost.isStarted) return completion(nil, @"unavailable");
  if (![LoadedProfiles() containsObject:profile]) {
    return LoadIntoProfile(profile, ^(NSString *error) {
      if (error) completion(nil, error);
      else Call(profile, expression, completion);
    });
  }
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  ACContentBlockerPage *page = p ? PageFor(profile, p) : nil;
  if (!page) return completion(nil, @"not loaded");
  NSString *script = [NSString stringWithFormat:
      @"let failing = %@;"
       "const send = (message) => failing ? (failing = false, Promise.reject(new Error(`${message.what}: failed (dev)`)))"
       "  : chrome.runtime.sendMessage(message);"
       "Promise.resolve().then(() => (%@)).then("
       "(v) => post('result', JSON.stringify({value: v === undefined ? null : v})),"
       "(e) => post('result', JSON.stringify({error: String(e && e.message || e)})))",
      gFailNextMessage ? @"true" : @"false", expression];
  gFailNextMessage = false;
  [page run:script
      completion:^(id value, NSString *error) {
        if (error) NSLog(@"[blocker] profile \"%@\": %@", profile, error);
        completion(value, error);
      }];
}

NSString *const kFollow =
    @"Promise.all([send({what: 'getFilteringModeDetails'}), send({what: 'getEnabledRulesets'})]).then(([modes, lists]) => {"
     "  const want = %@;"
     "  if (!modes || typeof modes !== 'object' || !Array.isArray(lists)) throw new Error('no settings to compare');"
     "  const key = (m) => JSON.stringify(Object.keys(m).sort().map((k) => [k, Array.isArray(m[k]) ? [...m[k]].sort() : m[k]]));"
     "  let written = Promise.resolve(null);"
     "  if (key(modes) !== key(want.modes)) written = written.then(() => send({what: 'setFilteringModeDetails', modes: want.modes}));"
     "  if ([...lists].sort().join() !== [...want.lists].sort().join())"
     "    written = written.then(() => send({what: 'applyRulesets', enabledRulesets: want.lists}));"
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
  if (!profiles) ForgetGoneProfiles();
  profiles = [(profiles ?: LoadedProfiles().array) filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
  if (!profiles.count) return done(nil);
  NSString *read = @"Promise.all([send({what: 'getFilteringModeDetails'}), send({what: 'getEnabledRulesets'})]).then(([modes, lists]) => {"
                    "  if (!modes || typeof modes !== 'object' || !Array.isArray(lists)) throw new Error('no settings to copy');"
                    "  return {modes, lists};"
                    "})";
  Call(kProfile, read, ^(NSDictionary *settings, NSString *error) {
    if (error) return done(error);
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

NSString *Category(NSDictionary *ruleset) {
  NSString *rulesetId = ruleset[@"id"], *group = ruleset[@"group"];
  if ([group isEqual:@"regions"]) return @"regional";
  if ([rulesetId isEqual:@"annoyances-cookies"]) return @"cookies";
  if ([group isEqual:@"privacy"] || [rulesetId isEqual:@"easyprivacy"]) return @"trackers";
  if ([group isEqual:@"annoyances"]) return @"annoyances";
  if ([group isEqual:@"malware"]) return @"security";
  return @"ads";
}

double Count(NSDictionary *d, NSString *key) { return [d[key] isKindOfClass:NSNumber.class] ? [d[key] doubleValue] : 0; }

NSString *BundledVersion() {
  NSString *path = [ExtensionPath() stringByAppendingPathComponent:@"manifest.json"];
  NSData *data = path ? [NSData dataWithContentsOfFile:path] : nil;
  NSDictionary *manifest = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [manifest isKindOfClass:NSDictionary.class] && [manifest[@"version"] isKindOfClass:NSString.class] ? manifest[@"version"] : @"";
}

void State(void (^completion)(NSDictionary *state)) {
  Call(kProfile, @"Promise.all([send({what: 'getOptionsPageData'}), send({what: 'getFilteringModeDetails'})])", ^(NSArray *both, NSString *error) {
    NSDictionary *options = [both isKindOfClass:NSArray.class] && both.count == 2 ? both[0] : nil;
    id modes = options ? both[1] : nil;
    if (![options isKindOfClass:NSDictionary.class]) {
      return completion(@{
        @"enabled" : @NO, @"lists" : @[], @"allowedHosts" : @[], @"version" : BundledVersion(),
        @"stats" : @{@"ready" : @NO, @"enabled" : @NO, @"parseMs" : @0, @"lookups" : @0, @"averageLookupMicros" : @0,
                     @"maxLookupMicros" : @0, @"error" : error ?: @"unavailable"},
      });
    }
    NSSet *enabledIds = [NSSet setWithArray:options[@"enabledRulesets"] ?: @[]];
    BOOL on = [options[@"defaultFilteringMode"] intValue] != kModeNone;
    NSMutableArray *lists = [NSMutableArray array];
    double network = 0, cosmetic = 0;
    for (NSDictionary *r in options[@"rulesetDetails"]) {
      if (![r isKindOfClass:NSDictionary.class] || [r[@"id"] isEqual:@"ubol-tests"]) continue;
      BOOL enabled = [enabledIds containsObject:r[@"id"]];
      NSDictionary *rules = [r[@"rules"] isKindOfClass:NSDictionary.class] ? r[@"rules"] : @{};
      NSDictionary *css = [r[@"css"] isKindOfClass:NSDictionary.class] ? r[@"css"] : @{};
      NSDictionary *filters = [r[@"filters"] isKindOfClass:NSDictionary.class] ? r[@"filters"] : @{};
      double count = Count(rules, @"total");
      if (enabled) {
        network += count;
        cosmetic += Count(css, @"generic") + Count(css, @"specific");
      }
      [lists addObject:@{
        @"id" : r[@"id"],
        @"title" : r[@"name"] ?: r[@"id"],
        @"category" : Category(r),
        @"enabled" : @(enabled),
        @"defaultOn" : @([r[@"enabled"] boolValue]),
        @"filters" : @(Count(filters, @"accepted") ?: count),
      }];
    }
    NSMutableArray *allowed = [NSMutableArray array];
    NSArray *none = [modes isKindOfClass:NSDictionary.class] && [modes[@"none"] isKindOfClass:NSArray.class] ? modes[@"none"] : @[];
    for (NSString *host in none)
      if ([host isKindOfClass:NSString.class] && ![host isEqualToString:@"all-urls"]) [allowed addObject:host];
    completion(@{
      @"enabled" : @(on),
      @"version" : BundledVersion(),
      @"lists" : lists,
      @"allowedHosts" : allowed,
      @"stats" : @{
        @"ready" : @YES, @"enabled" : @(on), @"networkFilters" : @(network), @"cosmeticFilters" : @(cosmetic),
        @"parseMs" : @0, @"lookups" : @0, @"averageLookupMicros" : @0, @"maxLookupMicros" : @0,
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
  Call(kProfile, ScriptWith(@"send({what: 'setDefaultFilteringMode', level: %@})", @[ @(enabled ? kModeOptimal : kModeNone) ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(NSString *))completion {
  NSString *script = @"send({what: 'getEnabledRulesets'}).then((ids) => {"
                      "  const [id, on] = [%@, %@];"
                      "  if (!Array.isArray(ids)) throw new Error('getEnabledRulesets: no answer');"
                      "  return send({what: 'applyRulesets', enabledRulesets: ids.filter((x) => x !== id).concat(on ? [id] : [])});"
                      "})";
  Call(kProfile, ScriptWith(script, @[ listId, @(enabled) ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL))completion {
  Call(kProfile, ScriptWith(@"send({what: 'getFilteringMode', hostname: %@})", @[ host.lowercaseString ]), ^(id level, NSString *error) {
    completion(!error && [level isKindOfClass:NSNumber.class] && [level intValue] == kModeNone);
  });
}

+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(NSString *))completion {
  NSString *script = @"(%@ ? Promise.resolve(%@) : send({what: 'getDefaultFilteringMode'})).then((level) => {"
                      "  if (typeof level !== 'number') throw new Error('getDefaultFilteringMode: no answer');"
                      "  return send({what: 'setFilteringMode', hostname: %@, level});"
                      "})";
  Call(kProfile, ScriptWith(script, @[ @(allowed), @(kModeNone), host.lowercaseString ]), ^(id, NSString *error) {
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
