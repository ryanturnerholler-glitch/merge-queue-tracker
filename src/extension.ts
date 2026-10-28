import * as vscode from "vscode";
import { l10n } from "vscode";
import { pickRepository } from "./addRepo";
import { getSession } from "./auth";
import { clampPollSeconds, nextDelay } from "./backoff";
import { DEMO_POLL_MS, DEMO_REPOS, DemoSource } from "./demo";
import { formatDuration, isOwn, summarize } from "./format";
import {
  buildOutcomeQuery,
  buildQueueQuery,
  GitHubError,
  graphql,
  graphqlEndpoint,
  parseOutcomes,
  parseQueueResponse,
  queuePageUrl,
  type OutcomeResponseData,
  type QueueResponseData,
} from "./github";
import { Poller } from "./poller";
import { diffQueues } from "./queueDiff";
import { RecentEvents } from "./recent";
import { MAX_REPOS, parseRepoInput, readTrackedRepos, repoKey, type TrackedRepos } from "./repos";
import { StatusBar } from "./statusBar";
import { QueueTreeProvider, type Node } from "./tree";
import type { Outcome, PollResult, QueueEntry, RepoQueue } from "./types";

const VIEW_ID = "mqTracker.queues";
const AUTH_PROVIDERS = new Set(["github", "github-enterprise"]);

interface Config {
  tracked: TrackedRepos;
  pollSeconds: number;
  notify: boolean;
  enterpriseUri: string | undefined;
}

function readConfig(): Config {
  const cfg = vscode.workspace.getConfiguration("mqTracker");
  const uri = cfg.get<string>("enterpriseUri")?.trim();
  return {
    tracked: readTrackedRepos(cfg.get("repos")),
    pollSeconds: clampPollSeconds(cfg.get("pollSeconds")),
    notify: cfg.get<boolean>("notify", true),
    enterpriseUri: uri || undefined,
  };
}

function setContext(key: string, value: boolean): Thenable<unknown> {
  return vscode.commands.executeCommand("setContext", key, value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class Tracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly provider = new QueueTreeProvider();
  private readonly view: vscode.TreeView<Node>;
  private readonly status = new StatusBar(`${VIEW_ID}.focus`);
  private readonly recent = new RecentEvents();
  private readonly poller: Poller;
  private previous: RepoQueue[] | undefined;
  private lastPoll: PollResult | undefined;
  private warning: string | undefined;
  private signedIn = false;
  private loading = true;
  private demo: DemoSource | undefined;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this.provider });
    this.poller = new Poller(() => this.poll(), log);
    this.disposables.push(
      this.view,
      this.provider,
      this.status,
      this.poller,
      vscode.commands.registerCommand("mqTracker.refresh", () => this.poller.runNow()),
      vscode.commands.registerCommand("mqTracker.openSettings", () =>
        vscode.commands.executeCommand("workbench.action.openSettings", "mqTracker"),
      ),
      vscode.commands.registerCommand("mqTracker.signIn", () => this.signIn()),
      vscode.commands.registerCommand("mqTracker.toggleDemo", () => this.toggleDemo()),
      vscode.commands.registerCommand("mqTracker.addRepo", () => this.addRepository()),
      vscode.commands.registerCommand("mqTracker.removeRepo", (node?: Node) => this.removeRepository(node)),
      vscode.commands.registerCommand("mqTracker.openQueue", (node?: Node) => this.openQueue(node)),
      vscode.commands.registerCommand("mqTracker.openPr", (node?: Node) => this.openUrl(entryOf(node)?.url)),
      vscode.commands.registerCommand("mqTracker.openChecks", (node?: Node) => {
        const url = entryOf(node)?.url;
        return this.openUrl(url ? `${url}/checks` : undefined);
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.log.info("Window focused; polling resumes.");
          this.poller.resume();
        } else {
          this.log.info("Window unfocused; polling paused.");
          this.poller.pause();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("mqTracker")) return;
        if (event.affectsConfiguration("mqTracker.repos") || event.affectsConfiguration("mqTracker.enterpriseUri")) {
          this.previous = undefined;
          this.lastPoll = undefined;
          this.loading = true;
        }
        this.log.info("Settings changed; polling now.");
        this.poller.runNow();
      }),
      vscode.authentication.onDidChangeSessions((event) => {
        if (!AUTH_PROVIDERS.has(event.provider.id)) return;
        this.log.info(`GitHub sessions changed (${event.provider.id}); polling now.`);
        this.poller.runNow();
      }),
    );
  }

  start(): void {
    this.poller.runNow();
    if (!vscode.window.state.focused) {
      this.log.info("Window is not focused; polling waits for focus after this first poll.");
      this.poller.pause();
    }
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) d.dispose();
  }

  /** One poll. Returns the delay until the next one, in milliseconds. */
  private async poll(): Promise<number> {
    const config = readConfig();
    if (this.demo) return this.pollDemo(config, this.demo);
    const hasRepos = config.tracked.repos.length > 0;
    await setContext("mqTracker.hasRepos", hasRepos);
    if (!hasRepos) {
      this.previous = undefined;
      this.lastPoll = undefined;
      this.warning = undefined;
      this.render(config);
      this.status.hide();
      this.view.badge = undefined;
      this.log.info("No repositories configured; nothing to poll.");
      return config.pollSeconds * 1000;
    }

    let session: vscode.AuthenticationSession | undefined;
    try {
      session = await getSession(config.enterpriseUri, false);
    } catch (error) {
      // Typically: `github-enterprise.uri` is unset, so VS Code has no enterprise auth provider.
      const delay = nextDelay({ pollSeconds: config.pollSeconds, failed: true, rateLimit: null, now: Date.now() });
      this.warning = l10n.t("GitHub sign-in is unavailable: {0} Retrying in {1}.", messageOf(error), formatDuration(delay.delayMs));
      this.signedIn = true;
      this.loading = false;
      this.render(config);
      this.log.error(`Could not get a GitHub session: ${messageOf(error)}`);
      return delay.delayMs;
    }
    this.signedIn = !!session;
    await setContext("mqTracker.signedIn", this.signedIn);
    if (!session) {
      this.render(config);
      this.status.hide();
      this.view.badge = undefined;
      this.log.info("Not signed in to GitHub; waiting for sign-in.");
      return config.pollSeconds * 1000;
    }

    const endpoint = graphqlEndpoint(config.enterpriseUri);
    const built = buildQueueQuery(config.tracked.repos);
    let result: PollResult;
    try {
      const response = await graphql<QueueResponseData>(endpoint, session.accessToken, built.query, built.variables);
      for (const error of response.errors ?? []) this.log.warn(`GraphQL: ${error.message}`);
      result = parseQueueResponse(config.tracked.repos, response);
    } catch (error) {
      const delay = nextDelay({ pollSeconds: config.pollSeconds, failed: true, rateLimit: null, now: Date.now() });
      const message = messageOf(error);
      this.warning = l10n.t("GitHub error: {0} Retrying in {1}.", message, formatDuration(delay.delayMs));
      this.loading = false;
      this.render(config);
      this.log.error(`Poll failed: ${message} Next poll in ${formatDuration(delay.delayMs)}.`);
      if (error instanceof GitHubError && error.kind === "auth") {
        this.log.warn("The GitHub token was rejected. Sign out and in again from the Accounts menu.");
      }
      return delay.delayMs;
    }

    this.loading = false;
    const diff = diffQueues(this.previous, result.repos);
    this.previous = result.repos;
    this.lastPoll = result;
    if (diff.left.length) {
      const outcomes = await this.fetchOutcomes(diff.left, endpoint, session.accessToken);
      this.applyOutcomes(diff.left, outcomes, result.viewer, config.notify);
    }

    const entries = result.repos.flatMap((r) => r.entries);
    const summary = summarize(entries, result.viewer);
    const delay = nextDelay({ pollSeconds: config.pollSeconds, failed: false, rateLimit: result.rateLimit, now: Date.now() });
    this.warning =
      delay.reason === "rate-limit"
        ? l10n.t("GitHub rate limit is low ({0} left). Next poll in {1}.", result.rateLimit?.remaining ?? 0, formatDuration(delay.delayMs))
        : undefined;
    this.render(config);
    this.status.update(entries, result.viewer);
    this.view.badge = summary.ownCount
      ? { value: summary.ownCount, tooltip: l10n.t("{0} of your pull requests are in a merge queue", summary.ownCount) }
      : undefined;
    this.log.info(
      `Polled ${result.repos.length} repositories as ${result.viewer || "?"}: ${entries.length} queued (${summary.ownCount} yours), ` +
        `${diff.entered.length} entered, ${diff.moved.length} moved, ${diff.left.length} left. ` +
        `Rate limit remaining: ${result.rateLimit?.remaining ?? "?"}. Next poll in ${formatDuration(delay.delayMs)}.`,
    );
    return delay.delayMs;
  }

  /** Scripted sample data instead of GitHub: no sign-in, no network. */
  private async pollDemo(config: Config, demo: DemoSource): Promise<number> {
    await setContext("mqTracker.hasRepos", true);
    await setContext("mqTracker.signedIn", true);
    this.signedIn = true;
    this.loading = false;
    const result = demo.next();
    const diff = diffQueues(this.previous, result.repos);
    this.previous = result.repos;
    this.lastPoll = result;
    if (diff.left.length) this.applyOutcomes(diff.left, demo.outcomes(diff.left), result.viewer, config.notify);
    const entries = result.repos.flatMap((r) => r.entries);
    const summary = summarize(entries, result.viewer);
    this.warning = l10n.t("Demo mode: sample data, not GitHub. Run “Toggle Demo Mode” to stop.");
    this.render(config, DEMO_REPOS);
    this.status.update(entries, result.viewer);
    this.view.badge = summary.ownCount
      ? { value: summary.ownCount, tooltip: l10n.t("{0} of your pull requests are in a merge queue", summary.ownCount) }
      : undefined;
    this.log.info(`Demo step: ${entries.length} queued, ${diff.entered.length} entered, ${diff.moved.length} moved, ${diff.left.length} left.`);
    return DEMO_POLL_MS;
  }

  private toggleDemo(): void {
    this.demo = this.demo ? undefined : new DemoSource();
    this.previous = undefined;
    this.lastPoll = undefined;
    this.warning = undefined;
    this.loading = true;
    this.recent.clear();
    this.log.info(this.demo ? "Demo mode on." : "Demo mode off.");
    this.poller.runNow();
  }

  private async fetchOutcomes(left: QueueEntry[], endpoint: string, token: string): Promise<Outcome[]> {
    try {
      const built = buildOutcomeQuery(left);
      const response = await graphql<OutcomeResponseData>(endpoint, token, built.query, built.variables);
      return parseOutcomes(left.length, response);
    } catch (error) {
      this.log.warn(`Could not look up why ${left.length} pull requests left the queue: ${messageOf(error)}`);
      return left.map(() => ({ kind: "removed", at: null, reason: null }));
    }
  }

  private applyOutcomes(left: QueueEntry[], outcomes: Outcome[], viewer: string, notify: boolean): void {
    left.forEach((entry, i) => {
      const outcome = outcomes[i] ?? { kind: "removed", at: null, reason: null };
      this.recent.add({ entry, outcome, observedAt: Date.now() });
      const own = isOwn(entry, viewer);
      this.log.info(
        `${entry.repo}#${entry.number} ${outcome.kind}${outcome.kind === "removed" ? ` (${outcome.reason ?? "reason not reported"})` : ""}${own ? " [yours]" : ""}.`,
      );
      if (notify && own) void this.notify(entry, outcome);
    });
  }

  private async notify(entry: QueueEntry, outcome: Outcome): Promise<void> {
    const openPr = l10n.t("Open PR");
    if (outcome.kind === "merged") {
      const picked = await vscode.window.showInformationMessage(l10n.t("#{0} merged", entry.number), openPr);
      if (picked === openPr) await this.openUrl(entry.url);
      return;
    }
    const openChecks = l10n.t("Open checks");
    const reason = outcome.reason ?? l10n.t("reason not reported");
    const picked = await vscode.window.showWarningMessage(
      l10n.t("#{0} removed from queue: {1}", entry.number, reason),
      openChecks,
      openPr,
    );
    if (picked === openChecks) await this.openUrl(`${entry.url}/checks`);
    else if (picked === openPr) await this.openUrl(entry.url);
  }

  private render(config: Config, tracked = config.tracked.repos): void {
    this.provider.update({
      tracked,
      dropped: config.tracked.dropped,
      invalid: config.tracked.invalid,
      poll: this.lastPoll,
      loading: this.loading,
      warning: this.warning,
      recent: this.recent.list(),
      signedIn: this.signedIn,
    });
  }

  private async signIn(): Promise<void> {
    try {
      await getSession(readConfig().enterpriseUri, true);
      this.poller.runNow();
    } catch (error) {
      void vscode.window.showErrorMessage(l10n.t("GitHub sign-in failed: {0}", messageOf(error)));
    }
  }

  private async addRepository(): Promise<void> {
    const config = readConfig();
    if (config.tracked.repos.length >= MAX_REPOS) {
      void vscode.window.showWarningMessage(l10n.t("You can track at most {0} repositories. Remove one first.", MAX_REPOS));
      return;
    }
    let session: vscode.AuthenticationSession | undefined;
    try {
      session = await getSession(config.enterpriseUri, true);
    } catch (error) {
      void vscode.window.showErrorMessage(l10n.t("GitHub sign-in failed: {0}", messageOf(error)));
      return;
    }
    if (!session) return;
    const token = session.accessToken;
    const endpoint = graphqlEndpoint(config.enterpriseUri);
    const picked = await pickRepository((query, variables) => graphql(endpoint, token, query, variables), this.log);
    if (!picked) return;
    const parsed = parseRepoInput(picked.nameWithOwner);
    if (!parsed) return;
    const key = repoKey(parsed);
    if (config.tracked.repos.some((r) => repoKey(r).toLowerCase() === key.toLowerCase())) {
      void vscode.window.showInformationMessage(l10n.t("{0} is already tracked.", key));
      return;
    }
    await this.writeRepos([...this.rawRepos(), { repo: key }]);
    this.log.info(`Added ${key}.`);
  }

  private async removeRepository(node: Node | undefined): Promise<void> {
    if (node?.kind !== "repo") return;
    const key = repoKey(node.tracked).toLowerCase();
    const kept = this.rawRepos().filter((item) => {
      const text = typeof item === "string" ? item : (item as { repo?: unknown })?.repo;
      const parsed = typeof text === "string" ? parseRepoInput(text) : undefined;
      return !parsed || repoKey(parsed).toLowerCase() !== key;
    });
    await this.writeRepos(kept);
    this.log.info(`Removed ${repoKey(node.tracked)}.`);
  }

  private rawRepos(): unknown[] {
    const value = vscode.workspace.getConfiguration("mqTracker").get<unknown>("repos");
    return Array.isArray(value) ? value : [];
  }

  /** Writes to the settings scope that currently holds the list, defaulting to user settings. */
  private writeRepos(value: unknown[]): Thenable<void> {
    const cfg = vscode.workspace.getConfiguration("mqTracker");
    const info = cfg.inspect<unknown[]>("repos");
    let target = vscode.ConfigurationTarget.Global;
    if (info?.workspaceFolderValue !== undefined) target = vscode.ConfigurationTarget.WorkspaceFolder;
    else if (info?.workspaceValue !== undefined) target = vscode.ConfigurationTarget.Workspace;
    return cfg.update("repos", value, target);
  }

  private openQueue(node: Node | undefined): Thenable<boolean> | undefined {
    if (node?.kind !== "repo") return undefined;
    const branch = node.queue?.branch || node.tracked.branch || "main";
    const url = node.queue?.queueUrl ?? queuePageUrl(readConfig().enterpriseUri, node.tracked, branch);
    return this.openUrl(url);
  }

  private openUrl(url: string | undefined): Thenable<boolean> | undefined {
    if (!url) return undefined;
    return vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

function entryOf(node: Node | undefined): QueueEntry | undefined {
  switch (node?.kind) {
    case "entry":
    case "detail":
      return node.entry;
    case "recentItem":
      return node.event.entry;
    default:
      return undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Merge Queue Tracker", { log: true });
  const tracker = new Tracker(log);
  context.subscriptions.push(log, tracker);
  tracker.start();
}

export function deactivate(): void {}
