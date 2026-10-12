import type { ImageMetadata } from "astro";
import type { Focus, Loop } from "../components/Shot.astro";
import addressToolbar from "../assets/shots/address-toolbar.webp";
import addressSidebar from "../assets/shots/address-sidebar.webp";
import split from "../assets/shots/split.webp";
import personal from "../assets/shots/profile-personal.webp";
import work from "../assets/shots/profile-work.webp";
import sideProject from "../assets/shots/profile-side-project.webp";
import extensions from "../assets/shots/extensions.webp";
import privacy from "../assets/shots/privacy.webp";
import pip from "../assets/shots/pip.webp";
import pipPoster from "../assets/shots/pip-loop-poster.webp";
import pipMp4 from "../assets/shots/pip-loop.mp4";
import pipWebm from "../assets/shots/pip-loop.webm";

// Every image here is a real capture of Ardia (see apps/site/README.md). Window shots are
// ScreenCaptureKit captures of the window; `panel` shots are the app's own render of one view
// (no window frame), used where a window capture wasn't possible.
interface Feature {
  id: string;
  title: string;
  /** One line. If it needs two, cut it. */
  body: string;
  /** One window, or several fanned out (front last). */
  shots: ImageMetadata[];
  alt: string;
  caption: string;
  panel?: boolean;
  /** The part worth showing on a phone. */
  focus?: Focus;
  /** A clip of the part that moves, over the one shot. */
  loop?: Loop;
}

export const features: Feature[] = [
  {
    id: "address-bar",
    title: "Lose the toolbar.",
    body: "Move the address bar into the sidebar and the page runs to the top of the window.",
    shots: [addressToolbar, addressSidebar],
    alt: "Two Ardia windows on the same Wikipedia page: behind, the address bar in a toolbar above the page; in front, the address bar in the sidebar under the traffic lights and the page running to the top of the window.",
    caption: "Before and after",
    focus: { x: 0, y: 0, zoom: 2.1, ratio: 0.8 },
  },
  {
    id: "split",
    title: "Two pages, one window.",
    body: "Drag a tab onto the page. Up to three panes.",
    shots: [split],
    alt: "Ardia in split view: MDN on the left, Wikipedia on the right, both in one window.",
    caption: "Split view",
    focus: { x: 0.5, y: 0, zoom: 1.3, ratio: 0.8 },
  },
  {
    id: "mini-player",
    title: "Refuses to leave the picture.",
    body: "Switch tabs mid-video and it floats along in the corner. Go back to its tab and it slips back into the page.",
    shots: [pip],
    alt: "Ardia on Wikipedia’s article about Big Buck Bunny, while the film keeps playing in a small floating window at the bottom right. Its tab, muted, is in the sidebar, with a player at the foot of the sidebar.",
    caption: "Picture in Picture, still playing",
    focus: { x: 1, y: 1, zoom: 2.4, ratio: 0.8 },
    // The capture's floating window, 336 × 189 pt at 2×, where it opened over the 1440 × 900 window.
    loop: { mp4: pipMp4, webm: pipWebm, poster: pipPoster, rect: { x: 2170, y: 1384, w: 672, h: 378 } },
  },
  {
    id: "profiles",
    title: "Work stays at work.",
    body: "Each profile keeps its own logins, history and colour. Swipe the sidebar to switch.",
    shots: [sideProject, work, personal],
    alt: "Three Ardia windows, one per profile, each tinted in its colour with its name next to the window buttons: Side project in orange, Work in blue and, in front, Personal in plum, its New Tab page showing the painted hills in plum.",
    caption: "Three profiles",
    focus: { x: 0, y: 0, zoom: 2.4, ratio: 0.8 },
  },
  {
    id: "extensions",
    title: "Your extensions come along.",
    body: "The Chrome Web Store, with a button that says Add to Ardia.",
    shots: [extensions],
    alt: "Dark Reader’s page on the Chrome Web Store, open in Ardia, with an Add to Ardia button.",
    caption: "The Chrome Web Store, working",
    focus: { x: 1, y: 0.1, zoom: 1.19, ratio: 0.8 },
  },
  {
    id: "privacy",
    title: "Leave no trace.",
    body: "uBlock Origin Lite is built in. Google’s pings are compiled out. Crash reports are opt-in: no sites, no searches.",
    shots: [privacy],
    panel: true,
    alt: "Ardia’s Privacy & Security settings: switches to block ads, trackers and cookie banners, and the number of filter rules loaded.",
    caption: "Settings › Privacy & Security",
    focus: { x: 0.96, y: 0, zoom: 1.4, ratio: 0.75 },
  },
];

/** In the app, without a screenshot. */
export const extras: { title: string; body: string }[] = [
  { title: "Brings your things", body: "Bookmarks, history, passwords and logins from Chrome, Safari, Firefox, Arc, Dia and five more." },
  { title: "Keeps secrets", body: "Passwords and passkeys per profile, and a strong new password when you sign up somewhere." },
  { title: "Syncs without signing in", body: "End to end encrypted, through a folder in your own iCloud Drive. No account, no server." },
  { title: "Now in glass", body: "Pinned tabs and the address bar in Liquid Glass, on macOS 26." },
  { title: "Knows your shortcuts", body: "Chrome’s and Dia’s. Where they disagree, Dia’s wins." },
  { title: "Updates itself", body: "In the background, then shows you what changed." },
  { title: "Formerly Netnyahoo", body: "Same app, new name. The update brings your tabs, passwords and the rest along." },
  { title: "Sits still", body: "Idles under half a percent of CPU with a tab open." },
];
