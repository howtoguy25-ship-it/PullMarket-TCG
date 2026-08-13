import type { Express } from "express";
import { createServer, type Server } from "http";
import express from "express";
import authRoutes from "./auth";
import listingsRoutes from "./listings";
import favoritesRoutes from "./favorites";
import cartRoutes from "./cart";
import checkoutRoutes from "./checkout";
import ordersRoutes from "./orders";
import notificationsRoutes from "./notifications";
import reportsRoutes from "./reports";
import ownerRoutes from "./owner";
import compositeRoutes from "./composite";
import usersRoutes from "./users";
import friendsRoutes from "./friends";
import blocksRoutes from "./blocks";
import subscriptionRoutes from "./subscription";
import followsRoutes from "./follows";
import appleNotificationsRoutes from "./appleNotifications";
import chatRoutes from "./chat";
import pricesRoutes from "./prices";
import { UPLOAD_DIR_PATH } from "../lib/upload";
import { BACKGROUNDS_DIR } from "../lib/cardBackgrounds";
import { COURIER_LABELS, CONDITION_LABELS, REPORT_REASON_LABELS } from "@shared/validation";

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/api/uploads", express.static(UPLOAD_DIR_PATH, { maxAge: "30d" }));
  app.use("/api/backgrounds", express.static(BACKGROUNDS_DIR, { maxAge: "7d" }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/lookups", (_req, res) => res.json({ couriers: COURIER_LABELS, conditions: CONDITION_LABELS, reportReasons: REPORT_REASON_LABELS }));

  app.use("/api/auth", authRoutes);
  app.use("/api/listings", listingsRoutes);
  app.use("/api/favorites", favoritesRoutes);
  app.use("/api/cart", cartRoutes);
  app.use("/api/checkout", checkoutRoutes);
  app.use("/api/orders", ordersRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/owner", ownerRoutes);
  app.use("/api/composite", compositeRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/friends", friendsRoutes);
  app.use("/api/blocks", blocksRoutes);
  app.use("/api/subscription", subscriptionRoutes);
  app.use("/api/follows", followsRoutes);
  // No authenticateToken — Apple calls this directly (see appleNotifications.ts).
  app.use("/api/apple", appleNotificationsRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/prices", pricesRoutes);

  return createServer(app);
}
