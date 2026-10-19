// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_input_frame_rate.h"

#import <AppKit/AppKit.h>

#include <cstdlib>
#include <cstring>
#include <set>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/performance_manager/public/user_tuning/battery_saver_mode_manager.h"

namespace ardia {

namespace {

using performance_manager::user_tuning::BatterySaverModeManager;

constexpr base::TimeDelta kHoldEvery = base::Milliseconds(100);
constexpr base::TimeDelta kLongestSpan = base::Seconds(30);

struct InputSpans {
  bool mouse = false;
  bool scroll = false;
  std::set<unsigned short> keys;
  bool reported = false;
  base::TimeTicks last_hold;
  base::OneShotTimer longest_span;
};

InputSpans& Spans() {
  static base::NoDestructor<InputSpans> spans;
  return *spans;
}

void ReportSpan() {
  InputSpans& spans = Spans();
  const bool active = spans.mouse || spans.scroll || !spans.keys.empty();
  if (active == spans.reported) {
    return;
  }
  spans.reported = active;
  if (active) {
    spans.longest_span.Start(FROM_HERE, kLongestSpan, base::BindOnce([] {
                               InputSpans& stale = Spans();
                               stale.mouse = false;
                               stale.scroll = false;
                               stale.keys.clear();
                               ReportSpan();
                             }));
  } else {
    spans.longest_span.Stop();
  }
  if (BatterySaverModeManager::HasInstance()) {
    BatterySaverModeManager::GetInstance()->SetFullFrameRateInputInProgress(
        active);
  }
}

bool PhaseEnds(NSEventPhase phase) {
  return phase & (NSEventPhaseEnded | NSEventPhaseCancelled);
}

void TrackSpan(NSEvent* event) {
  InputSpans& spans = Spans();
  switch (event.type) {
    case NSEventTypeLeftMouseDown:
    case NSEventTypeRightMouseDown:
    case NSEventTypeOtherMouseDown:
      spans.mouse = true;
      break;
    case NSEventTypeLeftMouseUp:
    case NSEventTypeRightMouseUp:
    case NSEventTypeOtherMouseUp:
      spans.mouse = false;
      break;
    case NSEventTypeKeyDown:
      spans.keys.insert(event.keyCode);
      break;
    case NSEventTypeKeyUp:
      spans.keys.erase(event.keyCode);
      break;
    case NSEventTypeScrollWheel:
      if (event.momentumPhase != NSEventPhaseNone) {
        spans.scroll = !PhaseEnds(event.momentumPhase);
      } else if (event.phase != NSEventPhaseNone) {
        spans.scroll = !PhaseEnds(event.phase);
      }
      break;
    default:
      break;
  }
  ReportSpan();
}

void EndHeldSpans() {
  InputSpans& spans = Spans();
  spans.mouse = false;
  spans.keys.clear();
  ReportSpan();
}

}

void HoldFullFrameRateDuringInput() {
  static id monitor = nil;
  if (monitor) {
    return;
  }
  const char* switch_value = getenv("ARDIA_SCROLL_FULL_RATE");
  if (switch_value && !strcmp(switch_value, "off")) {
    return;
  }
  const NSEventMask input =
      NSEventMaskScrollWheel | NSEventMaskKeyDown | NSEventMaskKeyUp |
      NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp |
      NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDown |
      NSEventMaskRightMouseUp | NSEventMaskRightMouseDragged |
      NSEventMaskOtherMouseDown | NSEventMaskOtherMouseUp |
      NSEventMaskOtherMouseDragged | NSEventMaskMouseMoved |
      NSEventMaskMagnify | NSEventMaskSmartMagnify | NSEventMaskSwipe |
      NSEventMaskRotate;
  monitor = [NSEvent
      addLocalMonitorForEventsMatchingMask:input
                                   handler:^NSEvent*(NSEvent* event) {
                                     TrackSpan(event);
                                     InputSpans& spans = Spans();
                                     const base::TimeTicks now =
                                         base::TimeTicks::Now();
                                     if (now - spans.last_hold >= kHoldEvery &&
                                         BatterySaverModeManager::
                                             HasInstance()) {
                                       spans.last_hold = now;
                                       BatterySaverModeManager::GetInstance()
                                           ->HoldFullFrameRateForInput();
                                     }
                                     return event;
                                   }];
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationDidResignActiveNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                EndHeldSpans();
              }];
}

}
