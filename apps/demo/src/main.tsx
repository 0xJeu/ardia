import "./styles.css";
import { createRoot } from "react-dom/client";
import { unstable_batchedUpdates } from "react-native";
import { emitCommand } from "@ardia/shell";
import type { BrowserCommand } from "@ardia-real/shell";
import { WindowRoot } from "../../browser/src/App";
import { startNativeSync } from "../../browser/src/lib/native";
import { startTabPages } from "../../browser/src/lib/tabPages";
import { setStoreBatching, useBrowser } from "../../browser/src/store/browser";
import { demoSession } from "./seed";
import { MenuHost } from "./shims/web/menus";
import { TrafficLights } from "./shims/web/windowChrome";

setStoreBatching(unstable_batchedUpdates);
useBrowser.getState().hydrate(demoSession());
startTabPages();
startNativeSync();

const SHORTCUTS: { key: string; shift?: boolean; command: BrowserCommand }[] = [
  { key: "l", command: "focusCommandBar" },
  { key: "k", command: "focusCommandBar" },
  { key: "t", command: "newTab" },
  { key: "t", shift: true, command: "reopenClosedTab" },
  { key: "s", command: "toggleSidebar" },
  { key: "[", command: "back" },
  { key: "]", command: "forward" },
  { key: "w", command: "closeTab" },
];

window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const shortcut = SHORTCUTS.find((s) => s.key === e.key.toLowerCase() && !!s.shift === e.shiftKey);
  if (!shortcut) return;
  e.preventDefault();
  emitCommand({ command: shortcut.command, arg: null, windowId: useBrowser.getState().ui.focusedWindowId });
}, true);

function DemoWindow() {
  return (
    <div className="ardia-desktop">
      <div className="ardia-window">
        <WindowRoot />
        <TrafficLights />
      </div>
      <MenuHost />
    </div>
  );
}

createRoot(document.getElementById("root")!, { onUncaughtError: (error) => console.error("[ardia demo] crashed", error) }).render(<DemoWindow />);
