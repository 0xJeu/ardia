import type { BrowserCommand } from "@ardia-real/shell";
import { emitCommand } from "@ardia/shell";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowser, type BrowserState } from "../../browser/src/store/browser";
import { splitOf } from "../../browser/src/store/splits";
import { isFrameable } from "./frameable";
import { Symbol } from "./shims/web/Symbol";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const CMD = isMac ? "⌘" : "Ctrl+";
const CTRL = isMac ? "⌃" : "Alt+";

const run = (command: BrowserCommand, arg: string | null = null) => emitCommand({ command, arg, windowId: useBrowser.getState().ui.focusedWindowId });

function focusedWindow(s: BrowserState) {
  return s.windows[s.ui.focusedWindowId ?? ""];
}

function activeTab(s: BrowserState) {
  const w = focusedWindow(s);
  return w ? w.activeTabIds[w.profileId] : undefined;
}

function toggleSplit() {
  const s = useBrowser.getState();
  const w = focusedWindow(s);
  const active = activeTab(s);
  if (!w || !active) return;
  const split = splitOf(s, active);
  if (split) return s.separateSplit(split.id);
  const partner = w.tabIds.map((id) => s.tabs[id]).find((t) => t && t.id !== active && t.profileId === w.profileId && !t.pinned && t.url && isFrameable(t.url));
  if (partner) s.createSplit([active, partner.id]);
  else run("openSplitPane");
}

function Button({ icon, label, hint, on, disabled, onPress }: { icon: string; label: string; hint?: string; on?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      className="ardia-control"
      aria-pressed={on}
      disabled={disabled}
      title={hint ? `${label} (${hint})` : label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      <Symbol name={icon} size={13} weight="medium" style={{ width: 15, height: 15 }} />
      <span>{label}</span>
    </button>
  );
}

const Group = ({ children }: { children: ReactNode }) => <div className="ardia-control-group">{children}</div>;

export function Controls() {
  const state = useBrowser(
    useShallow((s) => {
      const w = focusedWindow(s);
      const active = activeTab(s);
      const tabsOnTop = (w?.tabLayout ?? s.settings.tabLayout) === "top";
      return {
        sidebar: !!w?.sidebarOpen,
        tabsOnTop,
        addressInSidebar: s.settings.addressBar === "sidebar",
        autoHide: s.settings.hideToolbarWhileScrolling,
        split: !!(active && splitOf(s, active)),
        dark: s.ui.appDark,
        profileId: w?.profileId ?? null,
      };
    }),
  );
  const profiles = useBrowser(useShallow((s) => s.profileOrder.map((id) => s.profiles[id]!).filter(Boolean)));
  const addressInSidebar = state.addressInSidebar && !state.tabsOnTop;

  return (
    <div className="ardia-controls" role="toolbar" aria-label="Try Ardia">
      <Group>
        <Button icon="sidebar.left" label="Sidebar" hint={`${CMD}S`} on={state.sidebar && !state.tabsOnTop} disabled={state.tabsOnTop} onPress={() => run("toggleSidebar")} />
        <Button icon="menubar.rectangle" label="Tabs on top" hint={`⇧${CMD}S`} on={state.tabsOnTop} onPress={() => run("toggleTabLayout")} />
        <Button icon="rectangle.lefthalf.filled" label="Address bar in sidebar" on={addressInSidebar} disabled={state.tabsOnTop} onPress={() => run("toggleAddressBar")} />
        <Button
          icon="eye.slash"
          label="Auto-hide toolbar"
          on={state.autoHide && !addressInSidebar}
          disabled={addressInSidebar}
          onPress={() => useBrowser.getState().updateSettings({ hideToolbarWhileScrolling: !state.autoHide })}
        />
      </Group>
      <Group>
        <Button icon="rectangle.split.2x1" label="Split view" hint={`${CTRL}⇧=`} on={state.split} onPress={toggleSplit} />
        <Button icon="magnifyingglass" label="Command bar" hint={`${CMD}L`} onPress={() => run("focusCommandBar")} />
      </Group>
      <Group>
        {profiles.map((p, i) => (
          <Button key={p.id} icon="person.crop.circle" label={p.name} hint={`${CTRL}${i + 1}`} on={state.profileId === p.id} onPress={() => run("switchProfile", p.id)} />
        ))}
      </Group>
      <Group>
        <Button icon={state.dark ? "moon" : "sun.max"} label={state.dark ? "Dark" : "Light"} onPress={() => run("setAppearance", state.dark ? "light" : "dark")} />
      </Group>
    </div>
  );
}
