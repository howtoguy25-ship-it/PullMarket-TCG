// Parses the REAL streaming text of a build_project reply (see
// shared/src/nexaPersona.ts's CODE_BUILD_FORMAT: each file is its own
// ```lang filename="path" fenced block) into a live task list — which
// files are done, which one is being written right now, straight from
// however much of the actual reply has streamed in so far. Nothing here
// is simulated: a file only appears once its opening fence has actually
// arrived, and only flips to "done" once its closing fence has actually
// arrived.

export interface BuildFileTask {
  path: string;
  language: string;
  lineCount: number;
  done: boolean;
}

const FENCE_OPEN = /^```\s*([a-zA-Z0-9_+-]*)\s*(?:filename="([^"]+)")?/;

export function parseBuildFileTasks(text: string): BuildFileTask[] {
  const lines = text.split("\n");
  const tasks: BuildFileTask[] = [];
  let current: BuildFileTask | null = null;

  for (const line of lines) {
    if (current) {
      if (line.trim() === "```") {
        current.done = true;
        current = null;
      } else {
        current.lineCount++;
      }
      continue;
    }
    const match = line.match(FENCE_OPEN);
    if (match) {
      const [, lang, filename] = match;
      current = { path: filename || `file${tasks.length + 1}.${lang || "txt"}`, language: lang || "text", lineCount: 0, done: false };
      tasks.push(current);
    }
  }

  return tasks;
}
