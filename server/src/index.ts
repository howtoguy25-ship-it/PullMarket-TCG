import "dotenv/config";
// Patches Express 4's router so a rejected promise inside an async route
// handler reaches setupErrorHandler() below instead of becoming an
// unhandled rejection — which crashes the whole process in modern Node,
// taking down every in-flight request, not just the one that failed.
import "express-async-errors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { registerRoutes } from "./routes";
import webhookRoutes from "./routes/webhook";
import { setupCallSignaling } from "./lib/callSignaling";
import { startAutoUnlistScheduler } from "./lib/autoUnlist";
import { startShippingDeadlineScheduler } from "./lib/shippingDeadlineSweeper";
import { startEbaySyncScheduler } from "./lib/ebay";
import { startStoryExpiryScheduler } from "./lib/storyExpiry";
import { privacyPolicyHtml, supportHtml, deleteAccountHtml } from "./lib/staticPages";

const app = express();
const log = console.log;

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedJson: unknown;
    const originalJson = res.json;
    res.json = function (body, ...args) {
      capturedJson = body;
      return originalJson.apply(res, [body, ...args]);
    };
    res.on("finish", () => {
      if (!reqPath.startsWith("/api")) return;
      const duration = Date.now() - start;
      let line = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJson) line += ` :: ${JSON.stringify(capturedJson)}`;
      if (line.length > 200) line = line.slice(0, 199) + "…";
      log(line);
    });
    next();
  });
}

function serveWebBuildInProduction(app: express.Application) {
  const webBuildDir = path.resolve(process.cwd(), "web-build");
  if (!fs.existsSync(webBuildDir)) return;
  app.use(express.static(webBuildDir));
  app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(webBuildDir, "index.html"));
  });
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err as { status?: number; statusCode?: number; message?: string };
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error(err);
    res.status(status).json({ message });
  });
}

(async () => {
  setupCors(app);

  // Stripe webhook needs the raw body for signature verification, so it's
  // mounted BEFORE express.json() strips/parses the body.
  app.use("/api/stripe/webhook", express.raw({ type: "application/json" }), webhookRoutes);

  // Default 100kb is fine for ordinary JSON bodies but too small for the
  // help assistant's image attachments (base64-encoded photos in the JSON
  // body, not multipart) — raised enough for two resized images with room
  // to spare.
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: false }));

  setupRequestLogging(app);

  // Plain, permanent pages — registered before the SPA catch-all so they
  // serve real HTML directly instead of the RN web bundle. App Store
  // Connect requires reachable URLs for these (Privacy Policy URL, Support
  // URL), independent of whether the app itself is up.
  app.get("/privacy", (_req, res) => res.type("html").send(privacyPolicyHtml()));
  app.get("/support", (_req, res) => res.type("html").send(supportHtml()));
  // Google Play's Data safety declaration requires a real, working URL that
  // clearly documents the account-deletion steps — a generic support page
  // doesn't satisfy that requirement.
  app.get("/delete-account", (_req, res) => res.type("html").send(deleteAccountHtml()));
  // AdMob (Google) verifies ad-serving authorization by crawling this exact
  // path on the app's declared developer website — required for AdMob
  // revenue to be attributed correctly, independent of the app bundle.
  app.get("/app-ads.txt", (_req, res) => res.type("text/plain").send("google.com, pub-6423632749110820, DIRECT, f08c47fec0942fa0\n"));

  const server = await registerRoutes(app);
  setupCallSignaling(server);
  startAutoUnlistScheduler();
  startShippingDeadlineScheduler();
  startEbaySyncScheduler();
  startStoryExpiryScheduler();

  if (process.env.NODE_ENV === "production") {
    serveWebBuildInProduction(app);
  }

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5050", 10);
  server.listen({ port, host: "0.0.0.0" }, () => {
    log(`PullMarket TCG API listening on port ${port}`);
  });
})();
