
export type Frame = [number, number, number, number];

export type ProfileColor = "plum" | "blue" | "purple" | "pink" | "red" | "orange" | "yellow" | "green" | "neutral";

export type Profile = {
  id: string;
  name: string;
  color: ProfileColor;
  icon: string | null;
  createdAt: number;
  dataId?: string;
};

export type BrowserWindow = {
  id: string;
  profileId: string;
  incognito: boolean;
  tabIds: string[];
  activeTabIds: Record<string, string>;
  sidebarOpen: boolean;
  tabLayout?: "sidebar" | "top";
  frame: Frame | null;
  createdAt: number;
  kind?: "small";
  originalProfileId?: string;
  chromeWindow?: string;
};

export type Tab = {
  id: string;
  windowId: string;
  profileId: string;
  url: string;
  title: string;
  favicon: string | null;
  pinned: boolean;
  muted: boolean;
  zoom: number;
  customTitle: string | null;
  customIcon: string | null;
  pinnedUrl: string | null;
  navigation: { url: string; seq: number; userInitiated?: boolean } | null;
  adoptId?: string;
  openerId: string | null;
  wakeAdoptId?: string;
  liveItem?: { folderId: string; itemId: string };
  unloaded?: boolean;
  pinKey?: string;
  createdAt: number;
  lastActiveAt: number;
};

export type TabLive = {
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  playingAudio: boolean;
  themeColor: string | null;
};

export type GroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";

export type TabGroup = {
  id: string;
  windowId: string;
  profileId: string;
  name: string;
  icon: string | null;
  color: GroupColor | null;
  collapsed: boolean;
  pinned: boolean;
  tabIds: string[];
  createdAt: number;
  autoUngroup?: boolean;
  pinnedOpenerId?: string;
  pinKey?: string;
};

export type SplitView = {
  id: string;
  windowId: string;
  tabIds: string[];
  orientation: "horizontal" | "vertical";
  sizes: number[];
  stack?: { index: number; sizes: [number, number] };
};

export type HistoryEntry = {
  url: string;
  title: string;
  favicon: string | null;
  visits: number;
  lastVisit: number;
  visitTimes?: number[];
};

export type BookmarkNode =
  | { kind: "url"; id: string; parentId: string; title: string; url: string; favicon: string | null; addedAt: number; syncKey?: string }
  | { kind: "folder"; id: string; parentId: string | null; title: string; children: string[]; addedAt: number; syncKey?: string };

export type BookmarkFolder = Extract<BookmarkNode, { kind: "folder" }>;

export type Bookmarks = {
  nodes: Record<string, BookmarkNode>;
  roots: Record<string, { bar: string; other: string }>;
};

export type TabSnapshot = Pick<
  Tab,
  "url" | "title" | "favicon" | "pinned" | "muted" | "zoom" | "customTitle" | "customIcon" | "profileId"
> &
  Partial<Pick<Tab, "pinnedUrl">>;

export type ClosedTab = {
  kind: "tab";
  id: string;
  tab: TabSnapshot;
  tabId?: string;
  restoreFrom?: string;
  windowId: string;
  index: number;
  group: Pick<TabGroup, "id" | "name" | "icon" | "color"> | null;
  closedAt: number;
  pinnedTile?: boolean;
  small?: boolean;
};

export type ClosedWindow = {
  kind: "window";
  id: string;
  window: Pick<BrowserWindow, "profileId" | "sidebarOpen" | "frame">;
  tabs: (TabSnapshot & { active: boolean; tabId?: string })[];
  groups: (Omit<TabGroup, "tabIds" | "windowId"> & { tabIndexes: number[] })[];
  closedAt: number;
};

export type ParkedPins = {
  tabs: (TabSnapshot & { id: string; groupId: string | null; restoreFrom?: string })[];
  groups: Pick<TabGroup, "id" | "name" | "icon" | "color" | "collapsed">[];
};

export type ClosedGroup = {
  kind: "group";
  id: string;
  group: Pick<TabGroup, "id" | "name" | "icon" | "color" | "pinned">;
  tabs: TabSnapshot[];
  tabIds?: string[];
  windowId: string;
  index: number;
  closedAt: number;
};

export type FindState = {
  open: boolean;
  query: string;
  count: number | null;
  active: number;
  focusRequest?: number;
  replace?: boolean;
};

export type PanelState = { open: boolean; initialText: string };

export type WindowUi = { panel: PanelState; downloadsOpen: boolean };
