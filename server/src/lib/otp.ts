import { db } from "../db";
import { otpCodes } from "@shared/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { sendSms } from "./sms";
import { sendEmail } from "./mailer";

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function issueOtp(destination: string, channel: "sms" | "email", purpose: "signin" | "signup") {
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
  const [row] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.destination, destination), eq(otpCodes.consumed, false), gt(otpCodes.expiresAt, new Date())))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!row) return false;
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) return false;

  if (row.code !== code) {
    await db.update(otpCodes).set({ attempts: (row.attempts ?? 0) + 1 }).where(eq(otpCodes.id, row.id));
    return false;
  }

  await db.update(otpCodes).set({ consumed: true }).where(eq(otpCodes.id, row.id));
  return true;
}
