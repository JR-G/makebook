import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { authenticateAgent } from "../middleware/auth.ts";
import { ProjectService } from "../services/project.ts";
import type { GiteaService } from "../services/gitea.ts";
import type { CreateProjectInput } from "@makebook/types";

/** Zod schema for validating the create-project request body. */
const createProjectSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

/**
 * Extracts a route parameter as a plain string.
 * Express 5's `ParamsDictionary` values may be `string | string[]`;
 * for wildcard segments the array elements are joined with "/".
 * @param value - Raw route parameter value.
 * @returns The normalised string, or empty string if absent.
 */
function pathParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join("/");
  return value ?? "";
}

/**
 * Parses a string query parameter, returning undefined for non-string values.
 * @param value - Raw query parameter value.
 * @returns The string value or undefined.
 */
function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Parses a numeric query parameter with a fallback default.
 * @param value - Raw query parameter value.
 * @param defaultValue - Value to return if parsing fails or value is absent.
 * @returns Parsed integer or the default.
 */
function intQuery(value: unknown, defaultValue: number): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Determines whether a string is a valid UUID v4.
 * @param value - String to test.
 * @returns True if the value matches the UUID pattern.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function handleCreate(pool: Pool, service: ProjectService): RequestHandler[] {
  return [
    authenticateAgent(pool),
    async (request: Request, response: Response, next: NextFunction): Promise<void> => {
      try {
        if (!request.agent) { response.status(401).json({ error: "Unauthorised" }); return; }
        const parsed = createProjectSchema.safeParse(request.body);
        if (!parsed.success) { response.status(400).json({ error: "Invalid request body" }); return; }
        const input: CreateProjectInput = parsed.data.description !== undefined
          ? { name: parsed.data.name, description: parsed.data.description }
          : { name: parsed.data.name };
        const project = await service.create(request.agent.id, input);
        response.status(201).json({ success: true, data: project });
      } catch (error) { next(error); }
    },
  ];
}

function handleList(service: ProjectService): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const page = intQuery(request.query["page"], 1);
      const pageSize = intQuery(request.query["pageSize"], 20);
      const status = stringQuery(request.query["status"]);
      const listOptions = status !== undefined ? { page, pageSize, status } : { page, pageSize };
      const result = await service.list(listOptions);
      response.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  };
}

function handleGetByIdOrSlug(service: ProjectService): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const idOrSlug = pathParam(request.params["idOrSlug"]);
      let project;
      if (isUuid(idOrSlug)) {
        project = await service.getWithCollaborators(idOrSlug);
      } else {
        const bySlug = await service.getBySlug(idOrSlug);
        if (bySlug) project = await service.getWithCollaborators(bySlug.id);
      }
      if (!project) { response.status(404).json({ error: "Project not found" }); return; }
      response.status(200).json({ success: true, data: project });
    } catch (error) { next(error); }
  };
}

function handleJoin(pool: Pool, service: ProjectService): RequestHandler[] {
  return [
    authenticateAgent(pool),
    async (request: Request, response: Response, next: NextFunction): Promise<void> => {
      try {
        if (!request.agent) { response.status(401).json({ error: "Unauthorised" }); return; }
        await service.join(pathParam(request.params["id"]), request.agent.id);
        response.status(200).json({ success: true });
      } catch (error) { next(error); }
    },
  ];
}

function handleLeave(pool: Pool, service: ProjectService): RequestHandler[] {
  return [
    authenticateAgent(pool),
    async (request: Request, response: Response, next: NextFunction): Promise<void> => {
      try {
        if (!request.agent) { response.status(401).json({ error: "Unauthorised" }); return; }
        await service.leave(pathParam(request.params["id"]), request.agent.id);
        response.status(200).json({ success: true });
      } catch (error) { next(error); }
    },
  ];
}

function handleGetCollaborators(service: ProjectService): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const collaborators = await service.getCollaborators(pathParam(request.params["id"]));
      response.status(200).json({ success: true, data: collaborators });
    } catch (error) { next(error); }
  };
}

function handleListFiles(service: ProjectService, gitea: GiteaService): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const project = await service.getById(pathParam(request.params["id"]));
      if (!project) { response.status(404).json({ error: "Project not found" }); return; }
      const path = stringQuery(request.query["path"]) ?? "";
      const ref = stringQuery(request.query["ref"]) ?? "main";
      const files = await gitea.listFiles(project.giteaRepo, path, ref);
      response.status(200).json({ success: true, data: files });
    } catch (error) { next(error); }
  };
}

function handleGetFile(service: ProjectService, gitea: GiteaService): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const project = await service.getById(pathParam(request.params["id"]));
      if (!project) { response.status(404).json({ error: "Project not found" }); return; }
      const filePath = pathParam(request.params["filePath"]);
      const ref = stringQuery(request.query["ref"]) ?? "main";
      const file = await gitea.getFile(project.giteaRepo, filePath, ref);
      if (!file) { response.status(404).json({ error: "File not found" }); return; }
      response.status(200).json({ success: true, data: { content: file.content, sha: file.sha } });
    } catch (error) { next(error); }
  };
}

/**
 * Creates the Express router for all project-related endpoints.
 * @param pool - PostgreSQL connection pool.
 * @param gitea - Gitea service for repository operations.
 * @returns Configured Express Router.
 */
export function createProjectRouter(pool: Pool, gitea: GiteaService): Router {
  const router = Router();
  const service = new ProjectService(pool, gitea);

  router.post("/", ...handleCreate(pool, service));
  router.get("/", handleList(service));
  router.get("/:idOrSlug", handleGetByIdOrSlug(service));
  router.post("/:id/join", ...handleJoin(pool, service));
  router.post("/:id/leave", ...handleLeave(pool, service));
  router.get("/:id/collaborators", handleGetCollaborators(service));
  router.get("/:id/files", handleListFiles(service, gitea));
  router.get("/:id/files/*filePath", handleGetFile(service, gitea));

  return router;
}
