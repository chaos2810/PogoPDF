import { en, type Key } from "./en";
import { zhTW } from "./zh-tw";

export type Lang = "en" | "zh-TW";
export const catalogs = { en, "zh-TW": zhTW } as const;

export function t(key: string, lang: Lang, vars?: Record<string, string>): string {
  const catalog = catalogs[lang];
  const s = (catalog as Record<string, string>)[key] ?? en[key as Key] ?? key;
  if (!vars) return s;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v), s
  );
}

export function keys(): string[] { return Object.keys(en); }
