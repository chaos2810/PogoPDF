import { normalizeRotate } from "../../app/pdfthumbs";

export type Rotate = 0 | 90 | 180 | 270;

export type GridPage = {
  id: string;
  srcIndex: number;
  rotate: Rotate;
};

export type OrganizePage = { srcIndex: number; rotate: Rotate };

let seq = 0;
const nextId = () => `p${++seq}`;

// `intrinsicRotates` is one entry per rendered thumbnail: the page's /Rotate.
// The grid seeds each page's ABSOLUTE rotation from it, so an untouched
// pre-rotated scan round-trips instead of being flattened to 0.
export function initPages(intrinsicRotates: number[]): GridPage[] {
  return intrinsicRotates.map((rotate, i) => ({
    id: nextId(),
    srcIndex: i,
    rotate: normalizeRotate(rotate),
  }));
}

export function rotatePage(pages: GridPage[], id: string): GridPage[] {
  return pages.map((p) =>
    p.id === id ? { ...p, rotate: ((p.rotate + 90) % 360) as Rotate } : p
  );
}

export function duplicatePage(pages: GridPage[], id: string): GridPage[] {
  const i = pages.findIndex((p) => p.id === id);
  if (i === -1) return pages;
  const copy = { ...pages[i], id: nextId() };
  return [...pages.slice(0, i + 1), copy, ...pages.slice(i + 1)];
}

export function deletePage(pages: GridPage[], id: string): GridPage[] {
  return pages.filter((p) => p.id !== id);
}

export function movePage(pages: GridPage[], from: number, to: number): GridPage[] {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) {
    return pages;
  }
  const next = pages.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function toInput(pages: GridPage[]): OrganizePage[] {
  return pages.map((p) => ({ srcIndex: p.srcIndex, rotate: p.rotate }));
}
