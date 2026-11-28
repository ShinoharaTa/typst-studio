import { readPref, usePref, writePref } from "./prefs";

// 最後に開いた編集先（端末ごと）。プロジェクト一覧の「続きから」と、記事一覧の「前回」に使う

export interface LastEdit {
  project: string;
  article: string;
  file: string;
}

export const LAST_EDIT_KEY = "typst-studio.lastEdit";

export function parseLastEdit(raw: string): LastEdit | null {
  try {
    const v = JSON.parse(raw) as Partial<LastEdit> | null;
    if (v && typeof v.project === "string" && typeof v.article === "string" && typeof v.file === "string" && v.project && v.article) {
      return { project: v.project, article: v.article, file: v.file || v.article };
    }
  } catch {
    // 壊れた値は無いものとして扱う
  }
  return null;
}

export function readLastEdit(): LastEdit | null {
  return parseLastEdit(readPref(LAST_EDIT_KEY, ""));
}

export function writeLastEdit(e: LastEdit): void {
  const raw = JSON.stringify(e);
  if (readPref(LAST_EDIT_KEY, "") !== raw) writePref(LAST_EDIT_KEY, raw);
}

export function useLastEdit(): LastEdit | null {
  const [raw] = usePref(LAST_EDIT_KEY, "");
  return parseLastEdit(raw);
}
