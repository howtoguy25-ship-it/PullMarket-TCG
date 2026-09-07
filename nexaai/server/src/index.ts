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
import { paddleWebhookRouter } from "./routes/webhooks/paddle";
import { googleConnectorCallbackRouter } from "./lib/connectors/google";
import { isChatConfigured } from "./lib/anthropic";

const app = express();
app.use(express.json({ limit: "10mb" })); // camera-ask images ride in as base64

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
app.use("/api/webhooks/paddle", paddleWebhookRouter);
app.use("/api/connectors/google/callback", googleConnectorCallbackRouter);

// The website (credits top-up + settings) is a small static site — see nexaai/website.
app.use("/account", express.static(path.join(__dirname, "../../website")));

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

const PORT = Number(process.env.PORT ?? 5060);
app.listen(PORT, () => {
  console.log(`NexaAi server listening on :${PORT} (chat ${isChatConfigured() ? "configured" : "NOT configured — set ANTHROPIC_API_KEY"})`);
});
