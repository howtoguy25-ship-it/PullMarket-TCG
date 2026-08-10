import "dotenv/config";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db, pool } from "../db";
import { users, listings, listingImages } from "@shared/schema";
import { eq } from "drizzle-orm";
import { UPLOAD_DIR_PATH } from "../lib/upload";

// Demo data only — real listings come from real sellers through the real
// upload flow (POST /api/listings). Run with `npm run seed`.
// Images are copied from server/src/seed-assets into the same uploads dir
// (and served the same /api/uploads/* way) that real seller uploads use —
// no dependency on an external image host.
const SEED_ASSETS_DIR = path.resolve(process.cwd(), "server/src/seed-assets");

const DEMO_LISTINGS: Array<{
  title: string;
  description: string;
  priceCents: number;
  condition: "brand_new" | "great_condition" | "used";
  franchise: "pokemon" | "one_piece";
  quantity: number;
  imageSlug: string;
}> = [
  { title: "Charizard VMAX Pokémon Rainbow Rare", description: "Champion's Path CHR, near mint, straight from a booster box.", priceCents: 45000, condition: "brand_new", franchise: "pokemon", quantity: 1, imageSlug: "charizard" },
  { title: "Luffy Gear 5 One Piece Leader Parallel", description: "OP-07 leader rare, pulled and sleeved immediately.", priceCents: 32000, condition: "brand_new", franchise: "one_piece", quantity: 2, imageSlug: "luffy" },
  { title: "Pikachu Pokémon Illustrator Promo Reprint", description: "Great condition, light play from a binder.", priceCents: 8000, condition: "great_condition", franchise: "pokemon", quantity: 3, imageSlug: "pikachu" },
  { title: "Trafalgar Law One Piece Super Rare Alt Art", description: "OP-05, used but no creases, sleeved since day one.", priceCents: 12000, condition: "used", franchise: "one_piece", quantity: 1, imageSlug: "law" },
  { title: "Mewtwo Pokémon Base Set Shadowless Holo", description: "Vintage grail, great condition with light edge wear.", priceCents: 60000, condition: "great_condition", franchise: "pokemon", quantity: 1, imageSlug: "mewtwo" },
  { title: "Shanks One Piece Red Hair Special Card", description: "Brand new from a manga box promo pack.", priceCents: 15000, condition: "brand_new", franchise: "one_piece", quantity: 4, imageSlug: "shanks" },
];

function copySeedImage(slug: string, variant: "front" | "back"): string {
  const src = path.join(SEED_ASSETS_DIR, `${slug}-${variant}.jpg`);
  const filename = `seed-${slug}-${variant}-${randomUUID().slice(0, 8)}.jpg`;
  const dest = path.join(UPLOAD_DIR_PATH, filename);
  fs.copyFileSync(src, dest);
  return `/api/uploads/${filename}`;
}

async function main() {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER || "+61474011265";

  const [owner] = await db
    .insert(users)
    .values({ username: "owner", phoneNumber: ownerPhone, displayName: "App Owner", isOwner: true })
    .onConflictDoNothing({ target: users.phoneNumber })
    .returning();

  const [seller] = await db
    .insert(users)
    .values({ username: "demo_seller", email: "demo.seller@example.com", displayName: "Demo Seller" })
    .onConflictDoNothing({ target: users.email })
    .returning();

  const sellerRow = seller ?? (await db.select().from(users).where(eq(users.email, "demo.seller@example.com")))[0];
  if (!sellerRow) throw new Error("Could not create/find demo seller");

  for (const item of DEMO_LISTINGS) {
    const [listing] = await db
      .insert(listings)
      .values({
        sellerId: sellerRow.id,
        title: item.title,
        description: item.description,
        franchise: item.franchise,
        priceCents: item.priceCents,
        condition: item.condition,
        quantityTotal: item.quantity,
        quantityAvailable: item.quantity,
      })
      .returning();

    await db.insert(listingImages).values([
      { listingId: listing.id, url: copySeedImage(item.imageSlug, "front"), position: 0 },
      { listingId: listing.id, url: copySeedImage(item.imageSlug, "back"), position: 1 },
    ]);
  }

  console.log(`Seeded ${DEMO_LISTINGS.length} demo listings, owner=${owner ? owner.username : "(already existed)"}, seller=${sellerRow.username}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
