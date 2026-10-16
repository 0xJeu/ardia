import type { HydrateData } from "../../browser/src/store/browser";
import { DEFAULT_PROFILE } from "../../browser/src/store/profiles";
import type { HistoryEntry, Profile, Tab } from "../../browser/src/store/types";
import { faviconFor, PAGES } from "./pages";

const WINDOW_ID = "w_demo";
const WORK: Profile = { id: "p_work", name: "Work", color: "blue", icon: null, createdAt: 0 };

type Page = { url: string; title: string };

function tab(id: string, profileId: string, page: Page, pinned = false, ageMinutes = 0): Tab {
  const at = Date.now() - ageMinutes * 60_000;
  return {
    id,
    windowId: WINDOW_ID,
    profileId,
    url: page.url,
    title: page.title,
    favicon: faviconFor(page.url),
    pinned,
    muted: false,
    zoom: 1,
    customTitle: null,
    customIcon: null,
    pinnedUrl: pinned ? page.url : null,
    navigation: null,
    openerId: null,
    createdAt: at,
    lastActiveAt: at,
  };
}

const personal = DEFAULT_PROFILE.id;

const TABS: Tab[] = [
  tab("t_pin_wikipedia", personal, PAGES.wikipediaHome, true, 300),
  tab("t_pin_mdn", personal, PAGES.mdn, true, 290),
  tab("t_pin_github", personal, PAGES.github, true, 280),
  tab("t_browser", personal, PAGES.wikipedia, false, 1),
  tab("t_hn", personal, PAGES.hackerNews, false, 12),
  tab("t_react", personal, PAGES.react, false, 25),
  tab("t_xkcd", personal, PAGES.xkcd, false, 40),
  tab("t_rust", personal, PAGES.rust, false, 55),
  tab("t_caniuse", personal, PAGES.caniuse, false, 70),
  tab("t_pin_whatwg", WORK.id, PAGES.whatwg, true, 400),
  tab("t_cern", WORK.id, PAGES.firstWebsite, false, 30),
  tab("t_gutenberg", WORK.id, PAGES.gutenberg, false, 45),
];

const HISTORY_PAGES: Page[] = [
  ...Object.values(PAGES),
  { url: "https://en.wikipedia.org/wiki/Hypertext", title: "Hypertext - Wikipedia" },
  { url: "https://en.wikipedia.org/wiki/World_Wide_Web", title: "World Wide Web - Wikipedia" },
  { url: "https://en.wikipedia.org/wiki/Tim_Berners-Lee", title: "Tim Berners-Lee - Wikipedia" },
  { url: "https://react.dev/learn", title: "Quick Start – React" },
  { url: "https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter", title: "backdrop-filter - CSS | MDN" },
  { url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe", title: "<iframe>: The Inline Frame element - HTML | MDN" },
  { url: "https://xkcd.com/927/", title: "xkcd: Standards" },
  { url: "https://vite.dev/guide/", title: "Getting Started | Vite" },
  { url: "https://caniuse.com/css-backdrop-filter", title: "CSS Backdrop Filter | Can I use..." },
];

function history(pages: Page[]): HistoryEntry[] {
  const now = Date.now();
  return pages.map((page, i) => {
    const visits = Math.max(1, 14 - i);
    const lastVisit = now - (i + 1) * 3_600_000;
    return { url: page.url, title: page.title, favicon: faviconFor(page.url), visits, lastVisit, visitTimes: Array.from({ length: visits }, (_, v) => lastVisit - v * 86_400_000) };
  });
}

export function demoSession(): HydrateData {
  const now = Date.now();
  return {
    profiles: { [personal]: DEFAULT_PROFILE, [WORK.id]: WORK },
    profileOrder: [personal, WORK.id],
    windows: {
      [WINDOW_ID]: {
        id: WINDOW_ID,
        profileId: personal,
        incognito: false,
        tabIds: TABS.map((t) => t.id),
        activeTabIds: { [personal]: "t_browser", [WORK.id]: "t_cern" },
        sidebarOpen: true,
        frame: null,
        createdAt: now,
      },
    },
    windowOrder: [WINDOW_ID],
    focusedWindowId: WINDOW_ID,
    tabs: Object.fromEntries(TABS.map((t) => [t.id, t])),
    history: { [personal]: history(HISTORY_PAGES), [WORK.id]: history(HISTORY_PAGES.slice(8)) },
  };
}
