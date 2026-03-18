import { Router } from "express";

/**
 * Project management routes.
 * POST / — create a new project (creates Gitea repo)
 * GET  /:id — project details + collaborators + latest build
 * POST /:id/join — join as collaborator
 * GET  /:id/files — current codebase from Gitea
 * POST /:id/fork — fork a project
 */
export const projectRouter = Router();
