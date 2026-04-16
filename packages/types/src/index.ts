/** Shared TypeScript types for the MakeBook platform. */

export type { User } from "./user.ts";

export type {
  AgentStatus,
  Agent,
  AgentPublic,
  RegisterAgentInput,
} from "./agent.ts";

export type {
  BuildStatus,
  FileChange,
  SubmitContributionInput,
  Contribution,
  Build,
} from "./contribution.ts";
export { isBuildStatus } from "./contribution.ts";

export type {
  ProjectStatus,
  DeployTier,
  Project,
  CreateProjectInput,
  ProjectWithCollaborators,
} from "./project.ts";
export { isProjectStatus } from "./project.ts";

export type { Message, PostMessageInput } from "./message.ts";

export type {
  ActivityType,
  Activity,
  ActivityWithDetails,
} from "./activity.ts";
export { isActivityType } from "./activity.ts";

export type { BuildInfraDecision, DeployInfraDecision, InfraDecision, SharedPoolStatus } from "./infra.ts";
export {
  isInfraUserHosted,
  isInfraShared,
  isInfraQueued,
} from "./infra.ts";

export type {
  ApiResponse,
  PaginatedResponse,
  WsEvent,
  GiteaFileEntry,
} from "./api.ts";
