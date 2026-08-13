import { db } from "../db";
import { blocks } from "@shared/schema";
import { and, eq, or } from "drizzle-orm";

// A block is treated as fully mutual for interaction purposes: if either
// side has blocked the other, neither can message or friend-request the
// other. This is the one check shared by chat.ts (sending/starting a
// conversation, forwarding) and friends.ts (sending a friend request).
export async function isBlockedEitherWay(aId: string, bId: string): Promise<boolean> {
  const [row] = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, aId), eq(blocks.blockedId, bId)), and(eq(blocks.blockerId, bId), eq(blocks.blockedId, aId))))
    .limit(1);
  return !!row;
}
