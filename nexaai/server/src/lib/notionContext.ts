// Real Notion workspace context — actually fetches live page content
// (not just titles) from the pages a user shared with NexaAi's Notion
// integration, and formats it for injection into the chat system prompt,
// the same real mechanism as lib/memory.ts's getMemoryContext.

import { eq, and } from "drizzle-orm";
import { connectors } from "@shared/schema";
import { db } from "../db";

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";

interface NotionSearchResult {
  id: string;
  properties?: Record<string, { type: string; title?: { plain_text: string }[] }>;
  last_edited_time: string;
}

async function searchRecentPages(accessToken: string): Promise<NotionSearchResult[]> {
  const response = await fetch(`${NOTION_BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, "Notion-Version": NOTION_VERSION },
    body: JSON.stringify({
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 5,
    }),
  });
  if (!response.ok) return []; // best-effort — never break a chat turn over Notion being briefly unreachable
  const json = (await response.json()) as { results: NotionSearchResult[] };
  return json.results;
}

function pageTitle(page: NotionSearchResult): string {
  const titleProp = Object.values(page.properties ?? {}).find((p) => p.type === "title");
  return titleProp?.title?.map((t) => t.plain_text).join("") || "Untitled";
}

interface NotionBlock {
  type: string;
  [key: string]: any;
}

/** Pulls plain text out of a page's top-level blocks — enough for real context without a full recursive block-tree walk. */
async function fetchPageText(accessToken: string, pageId: string): Promise<string> {
  const response = await fetch(`${NOTION_BASE}/blocks/${pageId}/children?page_size=30`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Notion-Version": NOTION_VERSION },
  });
  if (!response.ok) return "";
  const json = (await response.json()) as { results: NotionBlock[] };

  const lines: string[] = [];
  for (const block of json.results) {
    const richText = block[block.type]?.rich_text as { plain_text: string }[] | undefined;
    if (richText?.length) lines.push(richText.map((t) => t.plain_text).join(""));
  }
  return lines.join("\n").slice(0, 1200); // keep each page's contribution bounded
}

/** Formats real, live Notion page content for injection into a chat system prompt. Returns "" if not connected or nothing shared. */
export async function getNotionContext(userId: string): Promise<string> {
  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.provider, "notion"), eq(connectors.status, "connected")));
  if (!connector?.accessToken) return "";

  let pages: NotionSearchResult[];
  try {
    pages = await searchRecentPages(connector.accessToken);
  } catch {
    return "";
  }
  if (!pages.length) return "";

  const sections = await Promise.all(
    pages.map(async (page) => {
      const text = await fetchPageText(connector.accessToken!, page.id).catch(() => "");
      return text ? `### ${pageTitle(page)}\n${text}` : null;
    }),
  );
  const withContent = sections.filter((s): s is string => !!s);
  if (!withContent.length) return "";

  return (
    "\n\nReal, live content from Notion pages this user shared with NexaAi's integration (use it naturally when " +
    "relevant — don't just dump it back):\n" +
    withContent.join("\n\n")
  );
}
