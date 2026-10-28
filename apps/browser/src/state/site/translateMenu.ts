import type { MenuItem } from "../../platform/menus";
import { menuSections } from "../app/menuSections";

export type TranslateMenuState = {
  translated: boolean;
  target: string;
  languages: { id: string; name: string; current: boolean }[];
  neverTranslate: boolean | null;
};

export function translateMenuItems({ translated, target, languages, neverTranslate }: TranslateMenuState): MenuItem[] {
  return menuSections(
    [
      translated ? { id: "original", title: "Show Original", symbol: "arrow.uturn.backward" } : { id: "translate", title: `Translate to ${target}`, symbol: "translate" },
      languages.length > 0 && {
        id: "choose",
        title: "Choose Another Language",
        symbol: "globe",
        children: languages.map((l) => ({ id: `language:${l.id}`, title: l.name, checked: l.current })),
      },
    ],
    [neverTranslate !== null && { id: "never", title: "Never Translate This Site", checked: neverTranslate }],
  );
}
