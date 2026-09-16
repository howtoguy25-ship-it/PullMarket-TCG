// Turns a build_project reply's fenced code blocks into the project's real,
// persisted file tree (shared/src/schema.ts's projectFiles) — this is what
// makes "code building" real: the files a Project has accumulated live as
// actual rows, not just text sitting in old chat messages, so a later turn
// (or a SiteSpark export) can read the current file tree directly instead
// of re-deriving it from transcript.
//
// Matches CODE_BUILD_FORMAT's exact required shape (shared/src/nexaPersona.ts):
//   ```html filename="index.html"
//   ...complete file contents...
//   ```
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { projectFiles } from "@shared/schema";

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\s+filename="([^"\n]+)"\r?\n([\s\S]*?)```/g;

export interface ParsedProjectFile {
  path: string;
  content: string;
  language: string | null;
}

/** Pure parsing, no DB — kept separate so it's trivially testable. */
export function parseProjectFilesFromReply(replyText: string): ParsedProjectFile[] {
  const files: ParsedProjectFile[] = [];
  for (const match of replyText.matchAll(FENCE_RE)) {
    const [, language, path, content] = match;
    if (!path.trim()) continue;
    files.push({ path: path.trim(), content: content.replace(/\n$/, ""), language: language.trim() || null });
  }
  return files;
}

/** Upserts each parsed file by (projectId, path) — a re-generated file replaces its old content, it doesn't duplicate. */
export async function persistProjectFiles(projectId: string, replyText: string): Promise<ParsedProjectFile[]> {
  const files = parseProjectFilesFromReply(replyText);
  for (const file of files) {
    const [existing] = await db
      .select()
      .from(projectFiles)
      .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, file.path)));
    if (existing) {
      await db
        .update(projectFiles)
        .set({ content: file.content, language: file.language, updatedAt: new Date() })
        .where(eq(projectFiles.id, existing.id));
    } else {
      await db.insert(projectFiles).values({ projectId, path: file.path, content: file.content, language: file.language });
    }
  }
  return files;
}
