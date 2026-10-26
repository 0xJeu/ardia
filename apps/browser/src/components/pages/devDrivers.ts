import { applyResult, applySafari, importArcSpace, importBookmarks, importTabs } from "../../state/import/apply";
import { importModule } from "../../platform/importModule";
import { openImport, openSettings, useSettingsNav } from "../../state/settings/settingsWindows";
import { useBookmarkDialog } from "../../state/bookmarks/actions";
import { useBookmarkEditor } from "../../state/bookmarks/edit";
import { useClearDataRequest } from "./ClearDataDialog";
import { openInternalPage } from "../../state/pages/urls";

export const pagesDrivers = {
  openInternalPage,
  openSettings,
  openImport,
  settingsNav: useSettingsNav,
  importModule,
  bookmarkDialog: useBookmarkDialog,
  bookmarkEditor: useBookmarkEditor,
  clearDataRequest: useClearDataRequest,
  applyResult,
  applySafari,
  importArcSpace,
  importBookmarks,
  importTabs,
};
