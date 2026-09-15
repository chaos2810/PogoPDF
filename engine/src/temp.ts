import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export class TempWorkspace {
  private dirs = new Set<string>();

  constructor(private baseDir: string) {}

  dirFor(jobId: string): string {
    const dir = join(this.baseDir, jobId);
    mkdirSync(dir, { recursive: true });
    this.dirs.add(dir);
    return dir;
  }

  cleanup(jobId: string) {
    const dir = join(this.baseDir, jobId);
    rmSync(dir, { recursive: true, force: true });
    this.dirs.delete(dir);
  }

  cleanupAll() {
    for (const dir of this.dirs) rmSync(dir, { recursive: true, force: true });
    this.dirs.clear();
  }
}
