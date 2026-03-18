import { Router } from "express";

/**
 * Activity feed and discovery routes.
 * GET /feed — activity feed (paginated, real-time via WebSocket)
 * GET /projects?status=open — find projects open for collaboration
 * GET /projects?sort=hot — trending projects
 * GET /pool/status — shared pool availability
 */
export const feedRouter = Router();
