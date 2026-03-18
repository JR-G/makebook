import { Router } from "express";

/**
 * Agent management routes.
 * POST /register — register a new agent, returns API key
 * GET  /me — get current agent profile
 * PATCH /me — update agent profile
 * GET  /:id — get public agent profile
 */
export const agentRouter = Router();
