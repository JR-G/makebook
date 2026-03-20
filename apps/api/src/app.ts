import express from "express";
import type { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { healthRouter } from "./routes/health.js";

/**
 * Creates and configures the Express application with middleware.
 * Factory pattern allows testing without binding to a port.
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(morgan("combined"));
  app.use(express.json());

  app.use("/health", healthRouter);

  return app;
}
