import * as vscode from "vscode";
import { reposFromRemotes } from "./repos";
import type { TrackedRepo } from "./types";

/** The slice of the built-in Git extension's API (`vscode.git`, API version 1) this extension reads. */
interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}
interface GitRepository {
  rootUri: vscode.Uri;
  state: { remotes: GitRemote[]; onDidChange: vscode.Event<void> };
}
interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}
interface GitExtension {
  enabled: boolean;
  getAPI(version: 1): GitApi;
}

/** A GitHub repository found among the open workspace's git remotes. */
export interface WorkspaceRepo extends TrackedRepo {
  /** Folder name, for the picker when several repositories are open. */
  folder: string;
}

/**
 * Reads the workspace's git remotes through the built-in Git extension, with no
 * dependency on it: when it is missing or disabled this simply finds nothing.
 */
export class WorkspaceRepos implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly perRepo = new Map<string, vscode.Disposable>();
  private api: GitApi | undefined;

  constructor(private readonly log: Pick<vscode.LogOutputChannel, "info" | "warn">) {
    this.disposables.push(this.changed);
    void this.connect();
  }

  /** Repositories on `host` among all open git repositories' remotes. */
  list(host: string): WorkspaceRepo[] {
    const found: WorkspaceRepo[] = [];
    const seen = new Set<string>();
    for (const repo of this.api?.repositories ?? []) {
      const urls = repo.state.remotes.flatMap((r) => [r.fetchUrl, r.pushUrl]).filter((u): u is string => !!u);
      const folder = repo.rootUri.path.split("/").filter(Boolean).pop() ?? repo.rootUri.path;
      for (const parsed of reposFromRemotes(urls, host)) {
        const key = `${parsed.owner}/${parsed.name}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ ...parsed, folder });
      }
    }
    return found;
  }

  dispose(): void {
    for (const d of this.perRepo.values()) d.dispose();
    this.perRepo.clear();
    for (const d of this.disposables.splice(0)) d.dispose();
  }

  private async connect(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) {
      this.log.info("The built-in Git extension is not available; workspace repositories will not be detected.");
      return;
    }
    try {
      const exports = extension.isActive ? extension.exports : await extension.activate();
      if (!exports?.enabled) {
        this.log.info("The built-in Git extension is disabled; workspace repositories will not be detected.");
        return;
      }
      this.api = exports.getAPI(1);
    } catch (error) {
      this.log.warn(`Could not read the Git extension API: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.disposables.push(
      this.api.onDidOpenRepository((repo) => {
        this.watch(repo);
        this.changed.fire();
      }),
      this.api.onDidCloseRepository((repo) => {
        this.perRepo.get(repo.rootUri.toString())?.dispose();
        this.perRepo.delete(repo.rootUri.toString());
        this.changed.fire();
      }),
    );
    for (const repo of this.api.repositories) this.watch(repo);
    this.changed.fire();
  }

  private watch(repo: GitRepository): void {
    const key = repo.rootUri.toString();
    if (this.perRepo.has(key)) return;
    this.perRepo.set(
      key,
      repo.state.onDidChange(() => this.changed.fire()),
    );
  }
}
