// What ArdiaCore's C++ side needs from its ObjC objects (not part of the host API).

#ifndef ARDIA_CORE_ARDIACORE_INTERNAL_H_
#define ARDIA_CORE_ARDIACORE_INTERNAL_H_

#import "ardia/core/public/ArdiaCore.h"

class Profile;

namespace content {
class WebContents;
}

namespace ardiacore {
class WindowHost;

// Profiles Chrome is destroying (their OnProfileWillBeDestroyed was sent; an off-the-record
// one is destroyed once its renderers are gone): never handed out or given a Browser again.
void NoteProfileDying(Profile* profile);
bool IsProfileDying(const Profile* profile);
// Profiles the host asked Chrome to delete (-deleteProfile:completion:): Chrome closes their
// Browsers before it removes their folder, so they never get a Browser again (a new one, a
// hidden page's, would keep the profile and its folder).
void NoteProfileDeleting(Profile* profile);
bool IsProfileDeleting(const Profile* profile);
}

@interface ArdiaCoreProfile ()
+ (ArdiaCoreProfile*)wrapperFor:(Profile*)profile;
@property(readonly) Profile* chromeProfile;
@end

@interface ArdiaCoreTab ()
- (instancetype)initWithContents:(content::WebContents*)contents;
@property(readonly) content::WebContents* contents;
- (void)contentsDestroyed;
- (void)notify:(SEL)selector;
@end

@interface ArdiaCoreWindow ()
@property(readonly) ardiacore::WindowHost* host;
@end

#endif  // ARDIA_CORE_ARDIACORE_INTERNAL_H_
