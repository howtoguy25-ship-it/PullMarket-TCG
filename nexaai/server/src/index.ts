import "dotenv/config";
import express from "express";
import "express-async-errors";
import path from "path";
import { authRouter } from "./routes/auth";
import { chatRouter } from "./routes/chat";
import { creditsRouter } from "./routes/credits";
import { plansRouter } from "./routes/plans";
import { agentsRouter } from "./routes/agents";
import { businessesRouter } from "./routes/businesses";
import { memoryRouter } from "./routes/memory";
import { connectorsRouter } from "./routes/connectors";
import { mcpRouter } from "./routes/mcp";
import { voiceRouter } from "./routes/voice";
import { attachmentsRouter, UPLOADS_DIR } from "./routes/attachments";
import { paddleWebhookRouter } from "./routes/webhooks/paddle";
import { metaWebhookRouter } from "./routes/webhooks/meta";
import { googleConnectorCallbackRouter } from "./lib/connectors/google";
import { metaConnectorCallbackRouter } from "./lib/connectors/meta";
import { siteSparkConnectorCallbackRouter } from "./lib/connectors/sitespark";
import { githubConnectorCallbackRouter } from "./lib/connectors/github";
import { vercelConnectorCallbackRouter } from "./lib/connectors/vercel";
import { netlifyConnectorCallbackRouter } from "./lib/connectors/netlify";
import { stripeConnectorCallbackRouter } from "./lib/connectors/stripe";
import { projectsRouter } from "./routes/projects";
import { apiKeysRouter } from "./routes/apiKeys";
import { publicApiRouter } from "./routes/publicApi";
import { ownerRouter } from "./routes/owner";
import { isChatConfigured } from "./lib/anthropic";

const app = express();
// `verify` stashes the raw body so routes/webhooks/meta.ts can check Meta's
// X-Hub-Signature-256 header — HMAC verification needs the exact bytes
// Meta signed, not the re-serialized parsed object.
app.use(
  express.json({
    limit: "10mb", // camera-ask images ride in as base64
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// Permissive CORS so the standalone /website static site (and the mobile
// app's web build, on a different port in dev) can call this API directly.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, chatConfigured: isChatConfigured() });
});

app.use("/api/auth", authRouter);
app.use("/api/chat", chatRouter);
app.use("/api/credits", creditsRouter);
app.use("/api/plans", plansRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/businesses", businessesRouter);
app.use("/api/memory", memoryRouter);
app.use("/api/connectors", connectorsRouter);
app.use("/api/mcp", mcpRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/attachments", attachmentsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/api-keys", apiKeysRouter);
app.use("/api/v1", publicApiRouter);
app.use("/api/owner", ownerRouter);
app.use("/api/webhooks/paddle", paddleWebhookRouter);
app.use("/api/webhooks/meta", metaWebhookRouter);
app.use("/api/connectors/google/callback", googleConnectorCallbackRouter);
app.use("/api/connectors/meta/callback", metaConnectorCallbackRouter);
app.use("/api/connectors/sitespark/callback", siteSparkConnectorCallbackRouter);
app.use("/api/connectors/github/callback", githubConnectorCallbackRouter);
app.use("/api/connectors/vercel/callback", vercelConnectorCallbackRouter);
app.use("/api/connectors/netlify/callback", netlifyConnectorCallbackRouter);
app.use("/api/connectors/stripe/callback", stripeConnectorCallbackRouter);

// The website (credits top-up + settings) is a small static site — see nexaai/website.
app.use("/account", express.static(path.join(__dirname, "../../website")));

// Uploaded photos/videos/files (see routes/attachments.ts) — served straight
// off local disk. NOTE: on most hosts (Render, Railway, etc.) this directory
// is wiped on every deploy/restart unless it's a persistent volume — same
// caveat as the root PullMarket TCG app's own /uploads, see its README.
app.use("/uploads", express.static(UPLOADS_DIR));

if (process.env.NODE_ENV === "production") {
  const webBuildDir = path.join(__dirname, "../../web-build");
  app.use(express.static(webBuildDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(webBuildDir, "index.html"));
  });
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? "Internal error" });
});

const PORT = Number(process.env.PORT ?? 5080);
app.listen(PORT, () => {
  console.log(`NexaAi server listening on :${PORT} (chat ${isChatConfigured() ? "configured" : "NOT configured — set ANTHROPIC_API_KEY"})`);
});
