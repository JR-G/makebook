import type { GiteaFileEntry } from "@makebook/types";

const ORG_NAME = "makebook";

/** Response shape returned by Gitea on repository creation. */
interface GiteaRepoResponse {
  clone_url: string;
  html_url: string;
}

/** Response shape returned by Gitea for a file content request. */
interface GiteaFileContentResponse {
  content: string;
  sha: string;
}

/** Response shape returned by Gitea after a file create or update. */
interface GiteaFileMutationResponse {
  commit: {
    sha: string;
  };
}

/** Response shape returned by Gitea after a file deletion. */
interface GiteaFileDeletionResponse {
  commit: {
    sha: string;
  };
}

/** Raw commit entry returned by Gitea's git commits API. */
interface GiteaRawCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

/** Raw entry returned by Gitea's contents listing API. */
interface GiteaContentEntry {
  name: string;
  path: string;
  type: string;
  size: number;
}

/** Shared metadata required when applying a file operation to a commit. */
interface CommitContext {
  message: string;
  authorName: string;
  existingSha: string | undefined;
}

/** A file operation to commit to a repository. */
export interface GiteaFileOperation {
  /** Repository-relative file path. */
  path: string;
  /** File content. Not used for `delete` actions. */
  content: string;
  /** The operation to perform on this file. */
  action: "create" | "update" | "delete";
}

/** A simplified commit log entry. */
export interface GiteaCommitEntry {
  /** Full commit SHA. */
  sha: string;
  /** Commit message. */
  message: string;
  /** Commit author name. */
  author: string;
  /** ISO 8601 commit date string. */
  date: string;
}

/**
 * Service for managing repositories, files, and commits via the Gitea REST API.
 *
 * @remarks
 * All operations target the `makebook` organisation. Call {@link ensureOrg}
 * during app startup before invoking any repository methods.
 */
export class GiteaService {
  constructor(
    private readonly baseUrl: string,
    private readonly adminToken: string,
  ) {}

  private get authHeader(): Record<string, string> {
    return { Authorization: `token ${this.adminToken}` };
  }

  private get jsonHeaders(): Record<string, string> {
    return { ...this.authHeader, "Content-Type": "application/json" };
  }

  /**
   * Creates a new repository under the `makebook` organisation.
   * Automatically creates the organisation if it does not yet exist.
   *
   * @param name - Repository name.
   * @param description - Optional repository description.
   * @returns Clone URL and HTML URL of the newly created repository.
   * @throws {@link Error} if repository creation fails.
   */
  async createRepo(
    name: string,
    description?: string,
  ): Promise<{ cloneUrl: string; htmlUrl: string }> {
    await this.ensureOrg();

    const response = await fetch(`${this.baseUrl}/api/v1/orgs/${ORG_NAME}/repos`, {
      method: "POST",
      headers: this.jsonHeaders,
      body: JSON.stringify({
        name,
        description,
        auto_init: true,
        default_branch: "main",
        private: false,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create repository "${name}": ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GiteaRepoResponse;
    return { cloneUrl: data.clone_url, htmlUrl: data.html_url };
  }

  /**
   * Deletes a repository from the `makebook` organisation.
   * Silently ignores 404 responses (repository already deleted).
   *
   * @param name - Repository name.
   * @throws {@link Error} on unexpected server errors.
   */
  async deleteRepo(name: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/repos/${ORG_NAME}/${name}`,
      {
        method: "DELETE",
        headers: this.authHeader,
      },
    );

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to delete repository "${name}": ${response.status} ${response.statusText}`,
      );
    }
  }

  /**
   * Commits one or more file operations to a repository sequentially.
   *
   * @remarks
   * Gitea does not expose a native batch commit API, so files are committed
   * one at a time via the Contents API. This is acceptable for MVP scale;
   * batch commit via raw git can be a future optimisation.
   *
   * @param repoName - Target repository name.
   * @param files - Ordered list of file operations to apply.
   * @param message - Commit message applied to each individual file commit.
   * @param authorName - Name of the commit author.
   * @returns SHA of the last commit created, or an empty string if no files were committed.
   * @throws {@link Error} if any individual file operation fails.
   */
  async commitFiles(
    repoName: string,
    files: GiteaFileOperation[],
    message: string,
    authorName: string,
  ): Promise<string> {
    let lastCommitSha = "";

    for (const file of files) {
      const ctx: CommitContext = {
        message,
        authorName,
        existingSha: await this.resolveFileSha(repoName, file.path, file.action),
      };
      lastCommitSha = await this.applyFileOperation(repoName, file, ctx);
    }

    return lastCommitSha;
  }

  /**
   * Retrieves the content and current SHA of a file from a repository.
   *
   * @param repoName - Repository name.
   * @param filePath - Repository-relative file path.
   * @param ref - Git ref (branch, tag, or commit SHA). Defaults to `"main"`.
   * @returns Decoded file content and current SHA, or `null` if not found.
   * @throws {@link Error} on unexpected server errors.
   */
  async getFile(
    repoName: string,
    filePath: string,
    ref?: string,
  ): Promise<{ content: string; sha: string } | null> {
    const resolvedRef = ref ?? "main";
    const response = await fetch(
      `${this.baseUrl}/api/v1/repos/${ORG_NAME}/${repoName}/contents/${filePath}?ref=${resolvedRef}`,
      { headers: this.authHeader },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to get file "${filePath}": ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GiteaFileContentResponse;
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { content, sha: data.sha };
  }

  /**
   * Lists files and directories at a given path within a repository.
   *
   * @param repoName - Repository name.
   * @param path - Directory path within the repository. Defaults to the root.
   * @param ref - Git ref to read from. Defaults to `"main"`.
   * @returns Array of file and directory entries, or an empty array if not found.
   * @throws {@link Error} on unexpected server errors.
   */
  async listFiles(
    repoName: string,
    path?: string,
    ref?: string,
  ): Promise<GiteaFileEntry[]> {
    const resolvedPath = path ?? "";
    const resolvedRef = ref ?? "main";
    const response = await fetch(
      `${this.baseUrl}/api/v1/repos/${ORG_NAME}/${repoName}/contents/${resolvedPath}?ref=${resolvedRef}`,
      { headers: this.authHeader },
    );

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new Error(
        `Failed to list files at "${resolvedPath}": ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GiteaContentEntry[];
    return data.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type === "dir" ? ("dir" as const) : ("file" as const),
      size: entry.size,
    }));
  }

  /**
   * Retrieves the commit log for a repository.
   *
   * @param repoName - Repository name.
   * @param limit - Maximum number of commits to return. Defaults to `20`.
   * @returns Array of simplified commit entries.
   * @throws {@link Error} if the request fails.
   */
  async getCommitLog(
    repoName: string,
    limit?: number,
  ): Promise<GiteaCommitEntry[]> {
    const resolvedLimit = limit ?? 20;
    const response = await fetch(
      `${this.baseUrl}/api/v1/repos/${ORG_NAME}/${repoName}/git/commits?limit=${resolvedLimit}`,
      { headers: this.authHeader },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to get commit log for "${repoName}": ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GiteaRawCommit[];
    return data.map((rawCommit) => ({
      sha: rawCommit.sha,
      message: rawCommit.commit.message,
      author: rawCommit.commit.author.name,
      date: rawCommit.commit.author.date,
    }));
  }

  /**
   * Ensures the `makebook` organisation exists in Gitea.
   * Creates it if not found. Safe to call multiple times (idempotent).
   *
   * @throws {@link Error} if the organisation check or creation fails unexpectedly.
   */
  async ensureOrg(): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/orgs/${ORG_NAME}`,
      { headers: this.authHeader },
    );

    if (response.status === 404) {
      await this.createOrg();
      return;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to check organisation "${ORG_NAME}": ${response.status} ${response.statusText}`,
      );
    }
  }

  private async createOrg(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/orgs`, {
      method: "POST",
      headers: this.jsonHeaders,
      body: JSON.stringify({ username: ORG_NAME, visibility: "public" }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create organisation "${ORG_NAME}": ${response.status} ${response.statusText}`,
      );
    }
  }

  private async resolveFileSha(
    repoName: string,
    filePath: string,
    action: "create" | "update" | "delete",
  ): Promise<string | undefined> {
    if (action === "create") {
      return undefined;
    }

    const existing = await this.getFile(repoName, filePath);
    if (existing === null) {
      throw new Error(
        `Cannot ${action} file "${filePath}": file not found in repository "${repoName}"`,
      );
    }

    return existing.sha;
  }

  private async applyFileOperation(
    repoName: string,
    file: GiteaFileOperation,
    ctx: CommitContext,
  ): Promise<string> {
    const url = `${this.baseUrl}/api/v1/repos/${ORG_NAME}/${repoName}/contents/${file.path}`;
    if (file.action === "delete") {
      return this.executeDeleteFile(url, file.path, ctx);
    }
    return this.executePutFile(url, file, ctx);
  }

  private async executeDeleteFile(
    url: string,
    filePath: string,
    ctx: CommitContext,
  ): Promise<string> {
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.jsonHeaders,
      body: JSON.stringify({
        message: ctx.message,
        sha: ctx.existingSha,
        author: { name: ctx.authorName },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to delete file "${filePath}": ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GiteaFileDeletionResponse;
    return data.commit.sha;
  }

  private async executePutFile(
    url: string,
    file: GiteaFileOperation,
    ctx: CommitContext,
  ): Promise<string> {
    const encodedContent = Buffer.from(file.content).toString("base64");
    const body: Record<string, unknown> = {
      message: ctx.message,
      content: encodedContent,
      author: { name: ctx.authorName },
    };

    if (ctx.existingSha !== undefined) {
      body["sha"] = ctx.existingSha;
    }

    const response = await fetch(url, {
      method: "PUT",
      headers: this.jsonHeaders,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to ${file.action} file "${file.path}": ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GiteaFileMutationResponse;
    return data.commit.sha;
  }
}
