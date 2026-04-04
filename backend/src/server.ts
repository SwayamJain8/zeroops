import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

import authRoutes from "./routes/auth";
import projectRoutes from "./routes/projects";
import deployRoutes from "./routes/deploy";
import logRoutes from "./routes/logs";
import chatRoutes from "./routes/chat";
import webhookRoutes from "./routes/webhooks";
import { startDeployWorker } from "./queue/deployQueue";
import { logger } from "./services/logger";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use((req, res, next) => {
  const start = Date.now();
  logger.info(
    "HTTP",
    `${req.method} ${req.path} - request received`
  );
  res.on("finish", () => {
    const elapsed = Date.now() - start;
    logger.info(
      "HTTP",
      `${req.method} ${req.path} -> ${res.statusCode} (${elapsed}ms)`
    );
  });
  next();
});

app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRoutes);

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/deploy", deployRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/chat", chatRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  logger.info("SERVER", `ZeroOps API running on port ${PORT}`);
  logger.info("SERVER", `Frontend origin allowed: ${process.env.FRONTEND_URL || "http://localhost:3000"}`);
  startDeployWorker();
});

export default app;
