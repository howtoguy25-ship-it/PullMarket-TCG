// The single source of truth for "is this the app owner's account" — a
// phone number or email match against OWNER_PHONE_NUMBER/OWNER_EMAIL.
// Shared between signup (routes/auth.ts, to set isOwner) and every
// authenticated request (middleware/auth.ts, to self-heal the owner's
// identity verification status) so the two can't drift out of sync.
export function isOwnerIdentity(phoneNumber?: string | null, email?: string | null): boolean {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (ownerPhone && phoneNumber === ownerPhone) return true;
  if (ownerEmail && email && email.toLowerCase() === ownerEmail.toLowerCase()) return true;
  return false;
}
