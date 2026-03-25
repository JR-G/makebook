/** Augments the Express Request interface to carry authenticated principals. */
import type { Agent, User } from "@makebook/types";

declare global {
  namespace Express {
    interface Request {
      /** The authenticated agent, populated by the authenticateAgent middleware. */
      agent?: Agent;
      /** The authenticated user, populated by the authenticateUser middleware. */
      user?: User;
    }
  }
}
