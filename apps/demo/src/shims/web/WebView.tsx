import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import type { NavigationState, WebViewHandle, WebViewProps } from "@ardia-real/ardiacore";
import { hostOf, isFrameable } from "../../frameable";
import { faviconFor, pageTitle } from "../../pages";
import { RefusedPage } from "./RefusedPage";

let nextBrowserId = 1;

const isBlank = (url: string) => !url || url === "about:blank";

type Page = { url: string; key: number };

export const WebView = forwardRef<WebViewHandle, WebViewProps>(function WebView(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const [page, setPage] = useState<Page | null>(null);
  const stack = useRef<{ entries: string[]; index: number }>({ entries: [], index: -1 });
  const keys = useRef(0);

  const report = (url: string, isLoading: boolean) => {
    const { entries, index } = stack.current;
    const state: NavigationState = {
      url,
      title: pageTitle(url),
      canGoBack: index > 0,
      canGoForward: index < entries.length - 1,
      isLoading,
      themeColor: null,
      themeColorSource: null,
    };
    latest.current.onNavigationChange?.(state);
  };

  const show = (url: string) => {
    setPage({ url, key: ++keys.current });
    const framed = isFrameable(url);
    report(url, framed);
    latest.current.onProgress?.(framed ? 0.3 : 1);
    const favicon = faviconFor(url);
    if (favicon) latest.current.onFavicon?.(favicon, [favicon]);
  };

  const visit = (url: string) => {
    if (isBlank(url)) return;
    const { entries, index } = stack.current;
    stack.current = { entries: [...entries.slice(0, index + 1), url], index: index + 1 };
    show(url);
  };

  const step = (offset: number) => {
    const { entries, index } = stack.current;
    const target = index + offset;
    if (target < 0 || target >= entries.length) return;
    stack.current = { entries, index: target };
    show(entries[target]!);
  };

  useEffect(() => {
    const id = nextBrowserId++;
    queueMicrotask(() => latest.current.onReady?.(id, id));
    if (props.url) visit(props.url);
  }, []);

  useImperativeHandle(ref, () => {
    const done = Promise.resolve();
    const handle: Partial<WebViewHandle> = {
      loadUrl: async (url) => visit(url),
      goBack: async () => step(-1),
      goForward: async () => step(1),
      goToOffset: async (offset) => step(offset),
      reload: async () => {
        const current = stack.current.entries[stack.current.index];
        if (current) show(current);
      },
      forceReload: async () => handle.reload?.(),
      navigationEntries: async () => stack.current.entries.map((url, i) => ({ url, title: pageTitle(url), current: i === stack.current.index })),
      evaluate: async () => null,
      discard: async () => "unsupported",
      capturePicture: async () => null,
      getSecurityInfo: async () => {
        const url = stack.current.entries[stack.current.index] ?? "";
        return { level: url.startsWith("https://") ? "secure" : "none", url, origin: url ? new URL(url).origin : null };
      },
    };
    return new Proxy(handle, { get: (target, key) => (key in target ? target[key as keyof WebViewHandle] : () => done) }) as WebViewHandle;
  }, []);

  const visible = props.visible !== false;
  const framed = page && isFrameable(page.url);
  return (
    <View style={[props.style, { overflow: "hidden", backgroundColor: "#FFFFFF" }, !visible && { display: "none" }]}>
      {page && framed ? (
        <iframe
          key={page.key}
          src={page.url}
          title={pageTitle(page.url)}
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          style={{ border: 0, width: "100%", height: "100%", display: "block", background: "#FFFFFF" }}
          onLoad={() => {
            latest.current.onProgress?.(1);
            report(page.url, false);
          }}
        />
      ) : null}
      {page && !framed ? <RefusedPage host={hostOf(page.url) || page.url} /> : null}
    </View>
  );
});
