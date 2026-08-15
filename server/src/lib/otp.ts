import { db } from "../db";
import { otpCodes } from "@shared/schema";
import { and, desc, eq, gt, lt, or, isNull, sql } from "drizzle-orm";
import { sendSms } from "./sms";
import { sendEmail } from "./mailer";

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

// App Store Review Guideline 2.1 requires a way for Apple's reviewer to
// actually sign in and test the app — but PullMarket is passwordless (phone
// or email OTP, or Google), so there's no username/password to hand over,
// and a reviewer can't receive a real text/email during review. "+1 555 01xx"
// is reserved by the North American Numbering Plan for fictional use — it
// can never be a real, assignable number, so this can't collide with an
// actual user's phone number. Only this exact number ever bypasses OTP
// delivery/verification; every other destination goes through the real
// flow unchanged.
export const REVIEWER_PHONE = "+15555550199";
const REVIEWER_OTP_CODE = "424242";

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function issueOtp(destination: string, channel: "sms" | "email", purpose: "signin" | "signup") {
  if (destination === REVIEWER_PHONE) return; // fixed code below, nothing to actually send

  // Invalidate any still-outstanding codes for this destination first, so
  // verify always checks against the code that was just sent — otherwise a
  // user who requests a second code (e.g. "resend") gets stuck being
  // checked against the first, already-forgotten one.
  await db.update(otpCodes).set({ consumed: true }).where(and(eq(otpCodes.destination, destination), eq(otpCodes.consumed, false)));

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  await db.insert(otpCodes).values({ destination, channel, code, purpose, expiresAt });

  const message = `Your PullMarket TCG verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`;
  if (channel === "sms") {
    await sendSms(destination, message);
  } else {
    await sendEmail({ to: destination, subject: "Your PullMarket TCG verification code", text: message });
  }
}

export async function verifyOtp(destination: string, code: string): Promise<boolean> {
  // Never expires, never consumed, no DB row involved — App Review may test
  // sign-in more than once, on different days, and it must keep working
  // every time. See REVIEWER_PHONE above.
  if (destination === REVIEWER_PHONE) return code === REVIEWER_OTP_CODE;

  // Claiming the code is a single atomic UPDATE, not a SELECT followed by a
  // separate UPDATE — the old two-step version had a real race: iOS's SMS
  // autofill is known to fire the verify screen's change handler more than
  // once for the same code, and two near-simultaneous requests could both
  // read `consumed: false` before either write committed, both pass, and
  // each mint their own sign-in token. Postgres only lets one concurrent
  // UPDATE match a given row, so at most one of these calls can ever return
  // true for the same code.
  const [claimed] = await db
    .update(otpCodes)
    .set({ consumed: true })
    .where(
      and(
        eq(otpCodes.destination, destination),
        eq(otpCodes.consumed, false),
        gt(otpCodes.expiresAt, new Date()),
        eq(otpCodes.code, code),
        or(isNull(otpCodes.attempts), lt(otpCodes.attempts, MAX_ATTEMPTS)),
      ),
    )
    .returning({ id: otpCodes.id });

  if (claimed) return true;

  // Wrong code (or no active/claimable code) — best-effort attempt
  // tracking on whatever's still outstanding for this destination, doesn't
  // need the same atomicity guarantee as the claim above.
  await db
    .update(otpCodes)
    .set({ attempts: sql`coalesce(${otpCodes.attempts}, 0) + 1` })
    .where(and(eq(otpCodes.destination, destination), eq(otpCodes.consumed, false), gt(otpCodes.expiresAt, new Date())));
  return false;
}
