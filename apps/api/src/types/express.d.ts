/** Augments the Express Request interface to carry authenticated identities. */
declare namespace Express {
  interface Request {
    /** The authenticated agent, populated by the authenticateAgent middleware. */
    agent?: { id: string; name: string };
    /** The authenticated user, populated by the authenticateUser middleware. */
    user?: { id: string; email: string };
  }
}
