import { resolveInput } from "@ardia/core";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { currentBookmarks, currentSettings } from "../../state/browser/current";
import { addBookmark, addBookmarkFolder, moveBookmark, updateBookmark } from "../../state/bookmarks/actions";
import { useWindowId } from "../../state/browser/hooks";
import { searchUrlPrefix } from "../../state/settings/settings";
import { Button, Dialog, TextField, useFormColors } from "../ui";
import { closeBookmarkEditor, useBookmarkEditor, type EditorState } from "../../state/bookmarks/edit";
import { FolderTree } from "./FolderTree";

export function EditBookmarkDialog() {
  const windowId = useWindowId();
  const open = useBookmarkEditor((e) => (e.open?.windowId === windowId ? e.open : null));
  if (!open) return null;
  return <Sheet key={`${open.bookmarkId}:${open.folder}`} state={open} />;
}

function Sheet({ state }: { state: EditorState }) {
  const theme = useTheme();
  const colors = useFormColors();
  const node = currentBookmarks().nodes[state.bookmarkId ?? ""];
  const [title, setTitle] = useState(node?.title ?? "");
  const [url, setUrl] = useState(node?.kind === "url" ? node.url : "");
  const [parentId, setParentId] = useState<string | null>(
    node?.parentId ?? state.parentId ?? currentBookmarks().roots[state.profileId]?.bar ?? null,
  );
  const close = closeBookmarkEditor;
  const resolvedUrl = url.trim() ? resolveInput(url, searchUrlPrefix(currentSettings())) : "";
  const valid = state.folder ? !!title.trim() : !!resolvedUrl;

  const save = () => {
    if (!valid) return;
    if (node) {
      updateBookmark(node.id, state.folder ? { title: title.trim() } : { title: title.trim(), url: resolvedUrl });
      if (parentId && parentId !== node.parentId) moveBookmark(node.id, parentId);
    } else if (state.folder) {
      addBookmarkFolder({ profileId: state.profileId, title: title.trim(), parentId: parentId ?? undefined, index: state.index });
    } else {
      addBookmark({ profileId: state.profileId, url: resolvedUrl, title: title.trim() || resolvedUrl, parentId: parentId ?? undefined, index: state.index });
    }
    close();
  };

  const heading = state.folder ? (node ? "Rename Folder" : "New Folder") : node ? "Edit Bookmark" : "Add Bookmark";

  return (
    <Dialog width={420} pad="xlx" onDismiss={close}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{heading}</Text>
      <Label text="Name" />
      <TextField value={title} onChangeText={setTitle} autoFocus selectOnFocus onSubmit={save} onEscape={close} />
      {!state.folder && (
        <>
          <Label text="URL" />
          <TextField value={url} onChangeText={setUrl} placeholder="https://" onSubmit={save} onEscape={close} />
        </>
      )}
      {(!state.folder || !node) && (
        <>
          <Label text="Folder" />
          <View
            style={{ height: 180, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.fieldBorder, backgroundColor: colors.field }}
          >
            <ScrollView contentContainerStyle={{ padding: 4 }}>
              <FolderTree profileId={state.profileId} selectedId={parentId} onSelect={setParentId} rowHeight={24} />
            </ScrollView>
          </View>
        </>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Button title="Cancel" onPress={close} />
        <Button title="Save" kind="primary" disabled={!valid} onPress={save} />
      </View>
    </Dialog>
  );
}

function Label({ text }: { text: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 11.5, marginTop: 12, marginBottom: 5, color: theme.textSecondary }}>{text}</Text>;
}
