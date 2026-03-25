/** Gitea API integration for repository management and file retrieval. */

/** A file or directory entry returned by the Gitea contents API. */
export interface GiteaFileEntry {
  /** File or directory name. */
  name: string;
  /** Full path relative to repository root. */
  path: string;
  /** Whether the entry is a file or directory. */
  type: "file" | "dir";
  /** File size in bytes (0 for directories). */
  size: number;
  /** Git blob SHA. */
  sha: string;
}

/** File content returned by the Gitea contents API. */
export interface GiteaFileContent {
  /** Decoded UTF-8 file content. */
  content: string;
  /** Git blob SHA. */
  sha: string;
}

/** Result of creating a new Gitea repository. */
export interface GiteaRepoCreated {
  /** Git clone URL for the new repository. */
  cloneUrl: string;
}

/** Raw response shape from the Gitea create-repo API. */
interface GiteaCreateRepoResponse {
  clone_url: string;
}

/** Raw response shape from the Gitea contents API for a single file. */
interface GiteaFileResponse {
  content: string;
  sha: string;
}

/** Raw response shape from the Gitea contents API for a directory entry. */
interface GiteaContentEntry {
  name: string;
  path: string;
  type: string;
  size: number;
  sha: string;
}

/**
 * Extracts the `owner/repo` path from a Gitea clone URL.
 * @param cloneUrl - Full clone URL, e.g. `http://gitea:3001/admin/my-project.git`.
 * @returns The repository path without leading slash or `.git` suffix.
 */
function extractRepoPath(cloneUrl: string): string {
  const url = new URL(cloneUrl);
  return url.pathname.replace(/^\//, "").replace(/\.git$/, "");
}

/**
 * Client for the Gitea REST API.
 * Handles repository creation, directory listing, and file retrieval.
 */
export class GiteaService {
  constructor(
    private readonly baseUrl: string,
    private readonly adminToken: string,
  ) {}

  private get authHeader(): string {
    return `token ${this.adminToken}`;
  }

  /**
   * Creates a new public repository under the admin account.
   * @param name - Repository name (should be a valid slug).
   * @param description - Optional repository description.
   * @returns The clone URL of the newly created repository.
   * @throws Error if the Gitea API request fails.
   */
  async createRepo(
    name: string,
    description?: string,
  ): Promise<GiteaRepoCreated> {
    const response = await fetch(`${this.baseUrl}/api/v1/user/repos`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        description: description ?? "",
        private: false,
        auto_init: true,
        default_branch: "main",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw Object.assign(
        new Error(`Gitea createRepo failed (${response.status}): ${errorText}`),
        { statusCode: 500 },
      );
    }

    const data = (await response.json()) as GiteaCreateRepoResponse;
    return { cloneUrl: data.clone_url };
  }

  /**
   * Lists the contents of a directory in a repository.
   * @param giteaRepo - Full clone URL of the repository.
   * @param path - Directory path relative to repository root (empty string for root).
   * @param ref - Git ref (branch, tag, or commit SHA).
   * @returns Array of file and directory entries. Returns empty array if path does not exist.
   */
  async listFiles(
    giteaRepo: string,
    path: string,
    ref: string,
  ): Promise<GiteaFileEntry[]> {
    const repoPath = extractRepoPath(giteaRepo);
    const encodedPath = path ? encodeURIComponent(path) : "";
    const url = `${this.baseUrl}/api/v1/repos/${repoPath}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

    const response = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as GiteaContentEntry[];
    return data.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type === "dir" ? "dir" : "file",
      size: entry.size,
      sha: entry.sha,
    }));
  }

  /**
   * Retrieves the decoded content of a single file.
   * @param giteaRepo - Full clone URL of the repository.
   * @param filePath - File path relative to repository root.
   * @param ref - Git ref (branch, tag, or commit SHA).
   * @returns File content and SHA, or null if the file does not exist.
   */
  async getFile(
    giteaRepo: string,
    filePath: string,
    ref: string,
  ): Promise<GiteaFileContent | null> {
    const repoPath = extractRepoPath(giteaRepo);
    const url = `${this.baseUrl}/api/v1/repos/${repoPath}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`;

    const response = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as GiteaFileResponse;
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { content, sha: data.sha };
  }
}
