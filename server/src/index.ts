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

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  setupRequestLogging(app);

  const server = await registerRoutes(app);
  setupCallSignaling(server);

  if (process.env.NODE_ENV === "production") {
    serveWebBuildInProduction(app);
  }

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5050", 10);
  server.listen({ port, host: "0.0.0.0" }, () => {
    log(`PullMarket TCG API listening on port ${port}`);
  });
})();
