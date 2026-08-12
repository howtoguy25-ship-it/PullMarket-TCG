import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { cartItems, listings, listingImages, orders, orderItems, users } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { getStripe, getPlatformFeeCents, isStripeConfigured } from "../lib/stripeClient";
import { getCartWithDetails } from "./cart";
import { SHIPPING_COUNTRIES } from "@shared/validation";

const router = Router();
router.use(authenticateToken);

// ── Seller payout onboarding (Stripe Connect Express) ─────────────────────
router.post("/connect/onboard", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ message: "Payments aren't configured yet. Set STRIPE_SECRET_KEY (see .env.example)." });
  }
  const stripe = getStripe();
  let accountId = req.user!.stripeConnectAccountId;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: req.user!.email ?? undefined,
      capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
    });
    accountId = account.id;
    await db.update(users).set({ stripeConnectAccountId: accountId }).where(eq(users.id, req.user!.id));
  }

  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5050";
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${baseUrl}/connect/refresh`,
    return_url: `${baseUrl}/connect/complete`,
    type: "account_onboarding",
  });

  res.json({ url: link.url });
});

router.get("/connect/status", async (req, res) => {
  if (!req.user!.stripeConnectAccountId) return res.json({ onboarded: false, payoutsEnabled: false, availableCents: 0, pendingCents: 0, currency: null });
  if (!isStripeConfigured()) return res.json({ onboarded: false, payoutsEnabled: false, availableCents: 0, pendingCents: 0, currency: null });

  const stripe = getStripe();
  const accountId = req.user!.stripeConnectAccountId;
  const account = await stripe.accounts.retrieve(accountId);
  const payoutsEnabled = !!account.payouts_enabled;
  await db
    .update(users)
    .set({ stripeConnectOnboarded: !!account.details_submitted, stripeConnectPayoutsEnabled: payoutsEnabled })
    .where(eq(users.id, req.user!.id));

  // The connected account's own balance — what's actually available to pay
  // out vs still clearing — not the platform account's balance, since this
  // is a destination-charges Connect setup where funds land on the seller's
  // account, not the platform's.
  let availableCents = 0;
  let pendingCents = 0;
  let currency: string | null = null;
  if (payoutsEnabled) {
    try {
      const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
      const available = balance.available[0];
      const pending = balance.pending[0];
      availableCents = available?.amount ?? 0;
      pendingCents = pending?.amount ?? 0;
      currency = (available?.currency ?? pending?.currency ?? null)?.toUpperCase() ?? null;
    } catch (err) {
      console.error("Failed to retrieve Connect balance:", err);
    }
  }

  res.json({ onboarded: !!account.details_submitted, payoutsEnabled, availableCents, pendingCents, currency });
});

// ── Create a Stripe Checkout Session for one seller's items in the cart ──
// One session per seller: Stripe Connect destination charges only support a
// single destination account per PaymentIntent, so a cart spanning multiple
// sellers checks out as multiple sequential "Pay now" sessions (the client
// groups the cart by seller and shows one Pay Now button per group).
router.post("/session", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ message: "Payments aren't configured yet. Ask the app owner to set STRIPE_SECRET_KEY." });
  }
  const schema = z.object({ sellerId: z.string(), returnUrl: z.string().url().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const cart = await getCartWithDetails(req.user!.id);
  const group = cart.groups.find((g) => g.sellerId === parsed.data.sellerId);
  if (!group || group.items.length === 0) return res.status(400).json({ message: "No items from that seller in your cart" });

  const [seller] = await db.select().from(users).where(eq(users.id, group.sellerId));
  if (!seller?.stripeConnectAccountId || !seller.stripeConnectPayoutsEnabled) {
    return res.status(400).json({ message: "This seller hasn't finished setting up payouts yet. Try again later." });
  }

  // Re-check stock at checkout time.
  const listingIds = group.items.map((i) => i.listingId);
  const freshListings = await db.select().from(listings).where(inArray(listings.id, listingIds));
  for (const item of group.items) {
    const fresh = freshListings.find((l) => l.id === item.listingId);
    if (!fresh || fresh.status !== "active" || fresh.quantityAvailable < item.quantity) {
      return res.status(409).json({ message: `"${item.title}" no longer has enough stock available` });
    }
  }

  const platformFeeCents = getPlatformFeeCents();

  const [order] = await db
    .insert(orders)
    .values({
      buyerId: req.user!.id,
      sellerId: group.sellerId,
      status: "pending_payment",
      subtotalCents: group.subtotalCents,
      platformFeeCents,
      totalCents: group.totalCents,
    })
    .returning();

  await db.insert(orderItems).values(
    group.items.map((i) => ({
      orderId: order.id,
      listingId: i.listingId,
      titleSnapshot: i.title,
      priceCentsSnapshot: i.priceCents,
      imageUrlSnapshot: i.image,
      quantity: i.quantity,
    })),
  );

  const stripe = getStripe();
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5050";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      ...group.items.map((i) => ({
        quantity: i.quantity,
        price_data: {
          currency: "usd",
          unit_amount: i.priceCents,
          product_data: { name: i.title, images: i.image ? [absoluteUrl(i.image)] : undefined },
        },
      })),
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: platformFeeCents,
          product_data: { name: "Platform & payment processing fee" },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: platformFeeCents,
      transfer_data: { destination: seller.stripeConnectAccountId },
      metadata: { orderId: order.id },
    },
    // The buyer's delivery address is collected here, by Stripe itself, and
    // copied onto the order in the webhook once payment completes — this is
    // what makes "order cards directly to their house" actually work.
    shipping_address_collection: { allowed_countries: [...SHIPPING_COUNTRIES] },
    phone_number_collection: { enabled: true },
    metadata: { orderId: order.id, buyerId: req.user!.id, sellerId: group.sellerId },
    success_url: buildReturnUrl(parsed.data.returnUrl, baseUrl, "success", order.id),
    cancel_url: buildReturnUrl(parsed.data.returnUrl, baseUrl, "cancelled", order.id),
  });

  await db.update(orders).set({ stripeCheckoutSessionId: session.id }).where(eq(orders.id, order.id));

  // Remove the checked-out items from the cart.
  const cartItemIds = (await db.select().from(cartItems).where(and(eq(cartItems.userId, req.user!.id), inArray(cartItems.listingId, listingIds)))).map(
    (c) => c.id,
  );
  if (cartItemIds.length > 0) await db.delete(cartItems).where(inArray(cartItems.id, cartItemIds));

  res.json({ orderId: order.id, url: session.url });
});

function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5050";
  return `${baseUrl}${path}`;
}

// `returnUrl` is the app's own deep link (web origin or the native
// `pullmarket://` scheme, built client-side via expo-linking) so Stripe
// hands control back to the right place on any platform. Falls back to a
// plain server URL if the client didn't send one (e.g. a direct API call).
function buildReturnUrl(returnUrl: string | undefined, baseUrl: string, status: "success" | "cancelled", orderId: string): string {
  const target = returnUrl ?? `${baseUrl}/checkout-return`;
  const separator = target.includes("?") ? "&" : "?";
  return `${target}${separator}status=${status}&order=${orderId}`;
}

export default router;
