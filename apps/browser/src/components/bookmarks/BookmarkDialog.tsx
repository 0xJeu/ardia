import { prompt, Surface } from "@ardia/shell";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { hex, layout, useTheme } from "../ui/theme";
import { useWindowId } from "../../state/browser/hooks";
import { Button, TextField, useFormColors } from "../ui";
import { addBookmarkFolder, addBookmarkTree, closeBookmarkDialog, moveBookmark, profileOfBookmark, removeBookmark, updateBookmark, useBookmarkDialog, type BookmarkDialogState } from "../../state/bookmarks/actions";
import { useBookmarks } from "../../state/bookmarks/hooks";
import { currentBookmarks } from "../../state/browser/current";
import { FolderTree } from "./FolderTree";
import { SIDEBAR_HEADER_WITH_FIELD, useAddressBarInSidebar } from "../../state/windows/layout";

export function BookmarkDialog() {
  const windowId = useWindowId();
  const open = useBookmarkDialog((d) => (d.open?.windowId === windowId ? d.open : null));
  if (!open) return null;
  return <DialogPanel key={open.kind === "page" ? open.bookmarkId : "all"} state={open} />;
}

function DialogPanel({ state }: { state: BookmarkDialogState }) {
  const theme = useTheme();
  const colors = useFormColors();
  const addressBar = useAddressBarInSidebar();
  const bookmark = useBookmarks((b) => (state.kind === "page" ? b.nodes[state.bookmarkId] : undefined));
  const profileId = state.kind === "page" ? profileOfBookmark(state.bookmarkId) : state.profileId;
  const [name, setName] = useState(() => (state.kind === "page" ? (bookmark?.title ?? "") : ""));
  const [folderId, setFolderId] = useState<string | null>(() =>
    state.kind === "page" ? (bookmark?.parentId ?? null) : (currentBookmarks().roots[state.profileId]?.bar ?? null),
  );
  const close = closeBookmarkDialog;

  useEffect(() => {
    if (state.kind === "page" && !bookmark) close();
  }, [bookmark]);

  const done = () => {
    if (state.kind === "page") {
      if (!currentBookmarks().nodes[state.bookmarkId]) return close();
      if (name.trim() && name !== bookmark?.title) updateBookmark(state.bookmarkId, { title: name.trim() });
      if (folderId && folderId !== bookmark?.parentId) moveBookmark(state.bookmarkId, folderId);
    } else {
      const title = name.trim() || "Tabs";
      addBookmarkTree(state.profileId, [{ title, children: state.tabs.map((t) => ({ title: t.title, url: t.url })) }], folderId ?? undefined);
    }
    close();
  };

  const remove = () => {
    if (state.kind === "page") removeBookmark(state.bookmarkId);
    close();
  };

  const newFolder = async () => {
    const title = await prompt({ title: "New Folder", placeholder: "Folder name", confirmTitle: "Create", windowId: state.windowId });
    if (!title || !profileId) return;
    const id = addBookmarkFolder({ profileId, title, parentId: folderId ?? undefined });
    setFolderId(id);
  };

  const heading = state.kind === "allTabs" ? `Bookmark ${state.tabs.length} Tabs` : "Bookmark Added";

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={done} />
      <Surface
        fill={hex(theme.panel)}
        cornerRadius={14}
        borderColor={hex(theme.panelBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.panelShadowOpacity}
        shadowRadius={24}
        shadowOffset={[0, 10]}
        style={{
          position: "absolute",
          ...(addressBar ? { top: SIDEBAR_HEADER_WITH_FIELD + 4, left: layout.sidebarInset } : { top: layout.cardTop + layout.toolbarHeight - 2, right: layout.cardInset + 10 }),
          width: 320,
          padding: 14,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>{heading}</Text>
        <Text style={{ fontSize: 11.5, marginTop: 12, marginBottom: 5, color: theme.textSecondary }}>{state.kind === "allTabs" ? "Folder name" : "Name"}</Text>
        <TextField value={name} onChangeText={setName} autoFocus selectOnFocus placeholder={state.kind === "allTabs" ? "Tabs" : "Name"} onSubmit={done} onEscape={done} />
        <Text style={{ fontSize: 11.5, marginTop: 12, marginBottom: 5, color: theme.textSecondary }}>Folder</Text>
        <View
          style={{
            height: 176,
            borderRadius: 7,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.fieldBorder,
            backgroundColor: colors.field,
            overflow: "hidden",
          }}
        >
          <ScrollView contentContainerStyle={{ padding: 4 }}>
            {profileId && <FolderTree profileId={profileId} selectedId={folderId} onSelect={setFolderId} rowHeight={24} />}
          </ScrollView>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, gap: 8 }}>
          <Button title="New Folder" onPress={newFolder} />
          <View style={{ flex: 1 }} />
          {state.kind === "page" ? <Button title="Remove" onPress={remove} /> : <Button title="Cancel" onPress={close} />}
          <Button title={state.kind === "page" ? "Done" : "Save"} kind="primary" onPress={done} />
        </View>
      </Surface>
    </View>
  );
}
