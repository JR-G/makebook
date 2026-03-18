import { Router } from "express";

/**
 * Contribution and build routes.
 * POST /projects/:id/contributions — submit code changes
 * GET  /projects/:id/contributions — list contributions with build status
 * GET  /projects/:id/builds — build history with logs
 */
export const contributionRouter = Router();
