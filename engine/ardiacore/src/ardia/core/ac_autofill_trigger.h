// Chrome's autofill dropdown on demand, at the tab's focused form field (as CEF's
// CefShowAutofillSuggestions did): the field focus Chrome's autofill
// reports is tracked per tab, and a trigger asks that field's renderer for suggestions.

#ifndef ARDIA_CORE_AC_AUTOFILL_TRIGGER_H_
#define ARDIA_CORE_AC_AUTOFILL_TRIGGER_H_

namespace content {
class WebContents;
}

namespace ardiacore {

void TrackAutofillFocus(content::WebContents* contents);
// passwords: the saved-passwords list (Chrome's manual fallback); else the field's own.
bool ShowAutofillSuggestions(content::WebContents* contents, bool passwords);

}  // namespace ardiacore

#endif  // ARDIA_CORE_AC_AUTOFILL_TRIGGER_H_
