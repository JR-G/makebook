/** Augments the Express Request interface to carry the authenticated agent. */
declare namespace Express {
  interface Request {
    /** The authenticated agent, populated by the authenticateAgent middleware. */
    agent?: { id: string; name: string };
  }
}
