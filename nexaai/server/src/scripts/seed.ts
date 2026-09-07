import "dotenv/config";
import { db, pool } from "../db";
import { businesses, voiceCharacters } from "@shared/schema";

async function seed() {
  console.log("Seeding NexaAi demo data...");

  await db.insert(businesses).values([
    {
      name: "NRMA Roadside Assistance",
      category: "roadside_assistance",
      phone: "132132",
      address: "Sydney NSW",
      lat: "-33.8688",
      lng: "151.2093",
      website: "https://www.nrma.com.au",
      notes: "24/7 roadside callout, membership or pay-per-use.",
    },
    {
      name: "Ultra Tune Parramatta",
      category: "mechanic",
      phone: "0298931234",
      address: "12 Church St, Parramatta NSW",
      lat: "-33.8151",
      lng: "151.0011",
      website: "https://www.ultratune.com.au",
    },
    {
      name: "RACV Emergency Roadside",
      category: "roadside_assistance",
      phone: "137228",
      address: "Melbourne VIC",
      lat: "-37.8136",
      lng: "144.9631",
      website: "https://www.racv.com.au",
    },
  ]).onConflictDoNothing();

  await db.insert(voiceCharacters).values([
    { id: "nova-neutral", displayName: "Nova", gender: "neutral", tone: "warm", ttsVoiceId: "com.apple.voice.compact.en-US.Samantha" },
    { id: "atlas-male-direct", displayName: "Atlas", gender: "male", tone: "direct", ttsVoiceId: "com.apple.voice.compact.en-US.Alex" },
    { id: "luna-female-energetic", displayName: "Luna", gender: "female", tone: "energetic", ttsVoiceId: "com.apple.voice.compact.en-US.Samantha" },
    { id: "sol-male-calm", displayName: "Sol", gender: "male", tone: "calm", ttsVoiceId: "com.apple.voice.compact.en-US.Fred" },
  ]).onConflictDoNothing();

  console.log("Done.");
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
