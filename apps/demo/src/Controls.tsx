import type { BrowserCommand } from "@ardia-real/shell";
import { emitCommand } from "@ardia/shell";
import { useShallow } from "zustand/react/shallow";
import { noteScroll } from "../../browser/src/components/layout/toolbarAutoHide";
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

type TabsMode = "sidebar" | "autoHide" | "top";
type AddressMode = "toolbar" | "autoHide" | "sidebar";

function setTabs(mode: TabsMode) {
  const s = useBrowser.getState();
  const w = focusedWindow(s);
  if (!w) return;
  const onTop = (w.tabLayout ?? s.settings.tabLayout) === "top";
  if (onTop !== (mode === "top")) s.toggleTabLayout(w.id);
  if (mode !== "top" && w.sidebarOpen !== (mode === "sidebar")) s.toggleSidebar(w.id);
}

function shownTabs(s: BrowserState) {
  const active = activeTab(s);
  if (!active) return [];
  return splitOf(s, active)?.tabIds ?? [active];
}

function setAddress(mode: AddressMode) {
  const s = useBrowser.getState();
  s.updateSettings({ addressBar: mode === "sidebar" ? "sidebar" : "toolbar", hideToolbarWhileScrolling: mode === "autoHide" });
  if (mode === "autoHide") for (const id of shownTabs(s)) noteScroll(id, { state: "down" });
}

type Option<T extends string> = { value: T; label: string; hint?: string; disabled?: boolean };

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Option<T>[]; onChange: (value: T) => void }) {
  return (
    <div className="ardia-control-group" role="radiogroup" aria-label={label}>
      <span className="ardia-control-label">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          className="ardia-control"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.hint ? `${label}: ${o.label} (${o.hint})` : `${label}: ${o.label}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Action({ icon, label, hint, on, onPress }: { icon: string; label: string; hint: string; on?: boolean; onPress: () => void }) {
  return (
    <button type="button" className="ardia-control" aria-pressed={on} title={`${label} (${hint})`} onMouseDown={(e) => e.preventDefault()} onClick={onPress}>
      <Symbol name={icon} size={13} weight="medium" style={{ width: 15, height: 15 }} />
      <span>{label}</span>
    </button>
  );
}

export function Controls() {
  const state = useBrowser(
    useShallow((s) => {
      const w = focusedWindow(s);
      const active = activeTab(s);
      const onTop = (w?.tabLayout ?? s.settings.tabLayout) === "top";
      const tabs: TabsMode = onTop ? "top" : w?.sidebarOpen ? "sidebar" : "autoHide";
      const address: AddressMode = s.settings.addressBar === "sidebar" && !onTop ? "sidebar" : s.settings.hideToolbarWhileScrolling ? "autoHide" : "toolbar";
      return { tabs, address, split: !!(active && splitOf(s, active)), dark: s.ui.appDark, profileId: w?.profileId ?? "" };
    }),
  );
  const profiles = useBrowser(useShallow((s) => s.profileOrder.map((id) => s.profiles[id]!).filter(Boolean)));

  return (
    <div className="ardia-controls" role="toolbar" aria-label="Try Ardia">
      <Choice
        label="Tabs"
        value={state.tabs}
        onChange={setTabs}
        options={[
          { value: "sidebar", label: "Sidebar" },
          { value: "autoHide", label: "Auto-hide", hint: `${CMD}S` },
          { value: "top", label: "Top", hint: `⇧${CMD}S` },
        ]}
      />
      <Choice
        label="Address bar"
        value={state.address}
        onChange={setAddress}
        options={[
          { value: "toolbar", label: "Toolbar" },
          { value: "autoHide", label: "Auto-hide" },
          { value: "sidebar", label: "Sidebar", disabled: state.tabs === "top" },
        ]}
      />
      <div className="ardia-control-group">
        <Action icon="rectangle.split.2x1" label="Split view" hint={`${CTRL}⇧=`} on={state.split} onPress={toggleSplit} />
        <Action icon="magnifyingglass" label="Command bar" hint={`${CMD}L`} onPress={() => run("focusCommandBar")} />
      </div>
      <Choice
        label="Profile"
        value={state.profileId}
        onChange={(id) => run("switchProfile", id)}
        options={profiles.map((p, i) => ({ value: p.id, label: p.name, hint: `${CTRL}${i + 1}` }))}
      />
      <Choice
        label="Theme"
        value={state.dark ? "dark" : "light"}
        onChange={(mode) => run("setAppearance", mode)}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
    </div>
  );
}
