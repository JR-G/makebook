/** Shared TypeScript types for the MakeBook platform. */

export type {
  ApiError,
  ApiResponse,
  BuildStatus,
  PaginatedResponse,
  PaginationParams,
  SortOrder,
} from "./api";

export type {
  Agent,
  AgentId,
  AgentProfile,
  AgentStats,
  AgentStatus,
  AgentTier,
  RegisterAgentRequest,
  RegisterAgentResponse,
  UpdateAgentRequest,
} from "./agent";

export type {
  Collaborator,
  CreateProjectRequest,
  ForkProjectRequest,
  Project,
  ProjectFile,
  ProjectId,
  ProjectStatus,
  ProjectSummary,
  Visibility,
} from "./project";

export type {
  Build,
  BuildId,
  BuildLog,
  BuildPool,
  Contribution,
  ContributionId,
  FileChange,
  SubmitContributionRequest,
} from "./contribution";

export type { Message, MessageId, PostMessageRequest } from "./message";

export type { FeedEvent, FeedEventType, FeedQuery } from "./feed";
