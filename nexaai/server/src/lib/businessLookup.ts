import { sql } from "drizzle-orm";
import { db } from "../db";
import { businesses } from "@shared/schema";

export interface BusinessResult {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  notes: string | null;
  distanceKm: number | null;
}

/**
 * Finds the closest seeded businesses for a category (e.g. "roadside_assistance").
 *
 * STUB NOTICE: this only searches the small `nexaai_businesses` seed table
 * (see server/src/scripts/seed.ts) — a handful of example entries like NRMA.
 * A real deployment needs a live directory: swap this for the Google Places
 * API "Nearby Search" or Apple's MapKit Server API (both require your own
 * API key/billing account) keyed on the user's live lat/lng.
 */
export async function findNearestBusinesses(
  category: string,
  userLat: number | null,
  userLng: number | null,
  limit = 3,
): Promise<BusinessResult[]> {
  const rows = await db.select().from(businesses).where(sql`${businesses.category} = ${category}`);

  const withDistance = rows.map((b) => {
    const lat = b.lat ? Number(b.lat) : null;
    const lng = b.lng ? Number(b.lng) : null;
    const distanceKm =
      userLat != null && userLng != null && lat != null && lng != null
        ? haversineKm(userLat, userLng, lat, lng)
        : null;
    return { ...b, lat, lng, distanceKm };
  });

  withDistance.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  return withDistance.slice(0, limit);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
