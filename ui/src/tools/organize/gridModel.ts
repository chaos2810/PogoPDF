export type Rotate = 0 | 90 | 180 | 270;

export type GridPage = {
  id: string;
  srcIndex: number;
  rotate: Rotate;
};

export type OrganizePage = { srcIndex: number; rotate: Rotate };

let seq = 0;
const nextId = () => `p${++seq}`;

export function initPages(count: number): GridPage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: nextId(),
    srcIndex: i,
    rotate: 0 as Rotate,
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
