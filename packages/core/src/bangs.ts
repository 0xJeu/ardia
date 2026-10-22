export type Bang = { trigger: string; name: string; template: string; home: string };

export type BangTable = { size: number; get(trigger: string): Bang | undefined };

export type BangMatch = { bang: Bang; query: string };

export const BANG_PLACEHOLDER = "{searchTerms}";
const STORED_PLACEHOLDER = "{s}";
const MIN_BANGS = 1000;

function endOfString(text: string, from: number): number {
  let at = from;
  for (;;) {
    const quote = text.indexOf('"', at);
    if (quote < 0) return text.length;
    let slashes = 0;
    while (text.charCodeAt(quote - 1 - slashes) === 92) slashes++;
    if (slashes % 2 === 0) return quote + 1;
    at = quote + 1;
  }
}

function skipBlank(text: string, from: number): number {
  let at = from;
  for (;;) {
    while (at < text.length && /\s/.test(text[at]!)) at++;
    if (text.startsWith("//", at)) {
      const end = text.indexOf("\n", at);
      at = end < 0 ? text.length : end;
    } else if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 2;
    } else return at;
  }
}

export function parseLooseJson(text: string): unknown {
  const parts: string[] = [];
  const special = /["/,]/g;
  let from = 0;
  for (let m = special.exec(text); m; m = special.exec(text)) {
    const at = m.index;
    const c = m[0];
    if (c === '"') {
      special.lastIndex = endOfString(text, at + 1);
    } else if (c === "/") {
      const next = text[at + 1];
      if (next !== "/" && next !== "*") continue;
      parts.push(text.slice(from, at));
      const end = next === "/" ? text.indexOf("\n", at) : text.indexOf("*/", at + 2);
      from = end < 0 ? text.length : next === "/" ? end : end + 2;
      special.lastIndex = from;
    } else {
      const close = text[skipBlank(text, at + 1)];
      if (close === "]" || close === "}") {
        parts.push(text.slice(from, at));
        from = at + 1;
      }
    }
  }
  parts.push(text.slice(from));
  return JSON.parse(parts.join(""));
}

const VALID_TEMPLATE = /^https?:\/\/[^/?#\s@:]+(?::\d+)?(?:[/?#]\S*)?$/i;

export function slimBangs(json: string): string | null {
  let list: unknown;
  try {
    list = parseLooseJson(json);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of list as unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { s, ts, u } = entry as Record<string, unknown>;
    if (typeof s !== "string" || !Array.isArray(ts) || typeof u !== "string") continue;
    if (!VALID_TEMPLATE.test(u) || u.includes(STORED_PLACEHOLDER)) continue;
    const name = s.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const triggers: string[] = [];
    for (const t of ts) {
      if (typeof t !== "string") continue;
      const trigger = t.trim().toLowerCase();
      if (!trigger || /[\s!]/.test(trigger) || seen.has(trigger)) continue;
      seen.add(trigger);
      triggers.push(trigger);
    }
    if (!triggers.length) continue;
    const stored = u.replace(/^https:\/\//i, "").split(BANG_PLACEHOLDER).join(STORED_PLACEHOLDER);
    lines.push(`${triggers.join(" ")}\t${name}\t${stored}`);
  }
  return lines.length >= MIN_BANGS ? lines.join("\n") : null;
}

function homeOf(template: string): string {
  const origin = /^https?:\/\/[^/?#]+/i.exec(template)?.[0];
  return origin ? `${origin}/` : template;
}

function indexTriggers(slim: string): Map<string, number> {
  const lines = new Map<string, number>();
  for (let at = 0; at < slim.length; ) {
    let end = slim.indexOf("\n", at);
    if (end < 0) end = slim.length;
    const tab = slim.indexOf("\t", at);
    if (tab > at && tab < end) {
      for (let from = at; from < tab; ) {
        const space = slim.indexOf(" ", from);
        const stop = space < 0 || space > tab ? tab : space;
        const trigger = slim.slice(from, stop);
        if (trigger && !lines.has(trigger)) lines.set(trigger, at);
        from = stop + 1;
      }
    }
    at = end + 1;
  }
  return lines;
}

export function bangTable(slim: string): BangTable {
  const lines = indexTriggers(slim);
  const parsed = new Map<string, Bang | null>();
  const get = (trigger: string): Bang | undefined => {
    const key = trigger.toLowerCase();
    const cached = parsed.get(key);
    if (cached !== undefined) return cached ?? undefined;
    const at = lines.get(key);
    let bang: Bang | null = null;
    if (at !== undefined) {
      const end = slim.indexOf("\n", at);
      const [, name = "", stored = ""] = slim.slice(at, end < 0 ? slim.length : end).split("\t");
      const template = (/^https?:\/\//i.test(stored) ? stored : `https://${stored}`).split(STORED_PLACEHOLDER).join(BANG_PLACEHOLDER);
      if (name && VALID_TEMPLATE.test(template)) bang = { trigger: key, name, template, home: homeOf(template) };
    }
    parsed.set(key, bang);
    return bang ?? undefined;
  };
  return { size: lines.size, get };
}

export function joinBangTables(tables: readonly BangTable[]): BangTable {
  return {
    size: tables.reduce((n, t) => n + t.size, 0),
    get: (trigger) => {
      for (const t of tables) {
        const bang = t.get(trigger);
        if (bang) return bang;
      }
      return undefined;
    },
  };
}

export function findBang(text: string, table: BangTable | null | undefined): BangMatch | null {
  if (!table || !text.includes("!")) return null;
  const words = text.trim().split(/\s+/);
  const last = words.length - 1;
  for (const at of last > 0 ? [0, last] : [0]) {
    const word = words[at]!;
    if (word.length < 2 || word[0] !== "!") continue;
    const bang = table.get(word.slice(1));
    if (bang) return { bang, query: words.filter((_, i) => i !== at).join(" ") };
  }
  return null;
}

function wellFormed(text: string): string {
  return Array.from(text, (c) => (c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff ? "�" : c)).join("");
}

const PATH_UNSAFE = /[^\x21-\x7e]+|["#%:<>?[\\\]^`{|}]/g;

export function escapeSearchTerms(terms: string, inQuery: boolean): string {
  const text = wellFormed(terms);
  return inQuery ? encodeURIComponent(text).replace(/%20/g, "+") : text.replace(PATH_UNSAFE, (m) => encodeURIComponent(m));
}

export function fillBangTemplate(template: string, terms: string): string {
  const at = template.indexOf(BANG_PLACEHOLDER);
  if (at < 0) return template;
  const question = template.indexOf("?");
  const escaped = escapeSearchTerms(terms, question >= 0 && at > question);
  return template.split(BANG_PLACEHOLDER).join(escaped);
}

export function bangUrl({ bang, query }: BangMatch): string {
  return query ? fillBangTemplate(bang.template, query) : bang.home;
}
