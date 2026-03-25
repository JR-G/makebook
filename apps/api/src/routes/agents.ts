import { Router } from "express";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { AgentService } from "../services/agent.ts";
import { authenticateUser } from "../middleware/auth.ts";
import type { AgentStatus } from "@makebook/types";

/** Zod schema for validating the agent registration request body. */
const registerAgentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  llmProvider: z.string().optional(),
  e2bApiKey: z.string().optional(),
  flyApiToken: z.string().optional(),
});

/** Zod schema for validating the status update request body. */
const updateStatusSchema = z.object({
  status: z.enum(["active", "inactive", "banned"]),
});

/**
 * Extracts the route param "id" as a string.
 * Route parameters from Express may be `string | string[]`; this always returns a single value.
 * @param request - The incoming Express request.
 * @returns The agent ID from the route parameters, or an empty string if absent.
 */
function extractId(request: Request): string {
  const param = request.params["id"];
  if (param === undefined) {
    return "";
  }
  return typeof param === "string" ? param : param[0] ?? "";
}

/**
 * Builds the POST /agents handler for registering a new agent.
 * @param agentService - The AgentService instance to delegate to.
 * @returns An Express RequestHandler.
 */
function makeRegisterHandler(agentService: AgentService): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const parsed = registerAgentSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message ?? "Invalid request body",
      });
      return;
    }

    if (request.user === undefined) {
      response.status(401).json({ success: false, error: "Unauthorised" });
      return;
    }

    const { name, description, llmProvider, e2bApiKey, flyApiToken } =
      parsed.data;
    const input = {
      name,
      ...(description !== undefined && { description }),
      ...(llmProvider !== undefined && { llmProvider }),
      ...(e2bApiKey !== undefined && { e2bApiKey }),
      ...(flyApiToken !== undefined && { flyApiToken }),
    };

    try {
      const result = await agentService.register(request.user.id, input);
      response.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Builds the GET /agents handler for listing agents with optional filters.
 * @param agentService - The AgentService instance to delegate to.
 * @returns An Express RequestHandler.
 */
function makeListHandler(agentService: AgentService): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const listOptions: { page?: number; pageSize?: number; status?: string } =
        {};
      const rawPage = request.query["page"];
      const rawPageSize = request.query["pageSize"];
      const rawStatus = request.query["status"];

      if (typeof rawPage === "string") {
        listOptions.page = parseInt(rawPage, 10);
      }
      if (typeof rawPageSize === "string") {
        listOptions.pageSize = parseInt(rawPageSize, 10);
      }
      if (typeof rawStatus === "string") {
        listOptions.status = rawStatus;
      }

      const result = await agentService.list(listOptions);
      response.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Builds the GET /agents/me handler returning agents owned by the current user.
 * @param agentService - The AgentService instance to delegate to.
 * @returns An Express RequestHandler.
 */
function makeMeHandler(agentService: AgentService): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (request.user === undefined) {
      response.status(401).json({ success: false, error: "Unauthorised" });
      return;
    }

    try {
      const agents = await agentService.getByUserId(request.user.id);
      response.json({ success: true, data: agents });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Builds the GET /agents/:id handler for public agent profile lookups.
 * @param agentService - The AgentService instance to delegate to.
 * @returns An Express RequestHandler.
 */
function makeGetByIdHandler(agentService: AgentService): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const agent = await agentService.getPublicById(extractId(request));

      if (agent === null) {
        response.status(404).json({ success: false, error: "Agent not found" });
        return;
      }

      response.json({ success: true, data: agent });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Builds the POST /agents/:id/rotate-key handler.
 * @param agentService - The AgentService instance to delegate to.
 * @returns An Express RequestHandler.
 */
function makeRotateKeyHandler(agentService: AgentService): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (request.user === undefined) {
      response.status(401).json({ success: false, error: "Unauthorised" });
      return;
    }

    try {
      const result = await agentService.rotateApiKey(
        extractId(request),
        request.user.id,
      );
      response.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Builds the PATCH /agents/:id/status handler.
 * @param agentService - The AgentService instance to delegate to.
 * @returns An Express RequestHandler.
 */
function makeUpdateStatusHandler(agentService: AgentService): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const parsed = updateStatusSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message ?? "Invalid status",
      });
      return;
    }

    try {
      const agent = await agentService.updateStatus(
        extractId(request),
        parsed.data.status as AgentStatus,
      );
      response.json({ success: true, data: agent });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Creates the agents router with all agent management routes mounted.
 *
 * Routes:
 * - POST   /                  Register a new agent (auth required)
 * - GET    /                  List all agents, paginated (public)
 * - GET    /me                List agents owned by current user (auth required)
 * - GET    /:id               Get public agent profile (public)
 * - POST   /:id/rotate-key    Rotate agent API key (auth required)
 * - PATCH  /:id/status        Update agent status (auth required)
 *
 * @param pool - PostgreSQL connection pool.
 * @param jwtSecret - HMAC-SHA256 secret for user JWT verification.
 * @returns Configured Express Router.
 */
export function createAgentsRouter(pool: Pool, jwtSecret: string): Router {
  const router = Router();
  const agentService = new AgentService(pool);
  const userAuth = authenticateUser(jwtSecret);

  router.post("/", userAuth, makeRegisterHandler(agentService));
  router.get("/", makeListHandler(agentService));
  router.get("/me", userAuth, makeMeHandler(agentService));
  router.get("/:id", makeGetByIdHandler(agentService));
  router.post("/:id/rotate-key", userAuth, makeRotateKeyHandler(agentService));
  router.patch(
    "/:id/status",
    userAuth,
    makeUpdateStatusHandler(agentService),
  );

  return router;
}
