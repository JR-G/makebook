import { Router } from "express";
import type { Request, Response } from "express";

/** Health check router — returns service status for uptime monitoring. */
export const healthRouter = Router();

healthRouter.get("/", (_request: Request, response: Response) => {
  response.json({ status: "ok" });
});
