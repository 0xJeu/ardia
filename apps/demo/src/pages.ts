import { hostOf } from "./frameable";

export const PAGES = {
  wikipedia: { url: "https://en.wikipedia.org/wiki/Web_browser", title: "Web browser - Wikipedia" },
  wikipediaHome: { url: "https://www.wikipedia.org/", title: "Wikipedia" },
  mdn: { url: "https://developer.mozilla.org/en-US/", title: "MDN Web Docs" },
  hackerNews: { url: "https://news.ycombinator.com/", title: "Hacker News" },
  react: { url: "https://react.dev/", title: "React" },
  xkcd: { url: "https://xkcd.com/", title: "xkcd: A webcomic of romance, sarcasm, math, and language" },
  rust: { url: "https://rust-lang.org/", title: "Rust Programming Language" },
  github: { url: "https://github.com/", title: "GitHub" },
  caniuse: { url: "https://caniuse.com/", title: "Can I use… Support tables for HTML5, CSS3, etc" },
  whatwg: { url: "https://html.spec.whatwg.org/", title: "HTML Standard" },
  firstWebsite: { url: "https://info.cern.ch/", title: "http://info.cern.ch" },
  gutenberg: { url: "https://www.gutenberg.org/", title: "Project Gutenberg" },
} as const;

const TITLES = new Map<string, string>(Object.values(PAGES).map((p) => [p.url, p.title]));

const FAVICONS: Record<string, string> = {
  "en.wikipedia.org": "https://en.wikipedia.org/static/favicon/wikipedia.ico",
  "www.wikipedia.org": "https://www.wikipedia.org/static/favicon/wikipedia.ico",
  "developer.mozilla.org": "https://developer.mozilla.org/favicon.ico",
  "news.ycombinator.com": "https://news.ycombinator.com/favicon.ico",
  "react.dev": "https://react.dev/favicon-32x32.png",
  "xkcd.com": "https://xkcd.com/s/919f27.ico",
  "rust-lang.org": "https://rust-lang.org/static/images/favicon-32x32.png",
  "github.com": "https://github.com/favicon.ico",
  "caniuse.com": "https://caniuse.com/img/favicon-128.png",
  "html.spec.whatwg.org": "https://resources.whatwg.org/logo.svg",
  "www.gutenberg.org": "https://www.gutenberg.org/gutenberg/favicon.ico",
};

export const faviconFor = (url: string) => FAVICONS[hostOf(url)] ?? null;

export function pageTitle(url: string) {
  const known = TITLES.get(url);
  if (known) return known;
  const wiki = url.match(/^https:\/\/en\.wikipedia\.org\/wiki\/([^?#]+)/);
  if (wiki) return `${decodeURIComponent(wiki[1]!).replace(/_/g, " ")} - Wikipedia`;
  return hostOf(url).replace(/^www\./, "") || url;
}
