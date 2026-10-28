import * as vscode from "vscode";
import { l10n } from "vscode";
import { pickRepository } from "./addRepo";
import { getSession } from "./auth";
import { clampPollSeconds, clampUnfocusedPollSeconds, nextDelay } from "./backoff";
import { DEMO_POLL_MS, DEMO_REPOS, DemoSource } from "./demo";
import { formatClock, formatDuration, isOwn, summarize } from "./format";
import {
  buildOutcomeQuery,
  buildQueueQuery,
  GitHubError,
  graphql,
  graphqlEndpoint,
  parseOutcomes,
  parseQueueResponse,
  queuePageUrl,
  ssoAuthorizeUrl,
  webHost,
  type OutcomeResponseData,
  type QueueResponseData,
} from "./github";
import { Poller } from "./poller";
import { diffQueues, type QueueDiff } from "./queueDiff";
import { RecentEvents } from "./recent";
import { MAX_REPOS, parseRepoInput, readTrackedRepos, repoKey, type TrackedRepos } from "./repos";
import { makeSnapshot, OWN_ONLY_KEY, RECENT_KEY, restoreSnapshot, SNAPSHOT_KEY } from "./state";
import { StatusBar } from "./statusBar";
import { QueueTreeProvider, type Node } from "./tree";
import type { Outcome, PollResult, QueueEntry, RepoQueue } from "./types";
import { WorkspaceRepos, type WorkspaceRepo } from "./workspaceRepo";

const VIEW_ID = "mqTracker.queues";
const AUTH_PROVIDERS = new Set(["github", "github-enterprise"]);

interface Config {
  tracked: TrackedRepos;
  pollSeconds: number;
  /** 0 pauses polling while the window is unfocused. */
  unfocusedPollSeconds: number;
  notify: boolean;
  notifyProgress: boolean;
  enterpriseUri: string | undefined;
}

function readConfig(): Config {
  const cfg = vscode.workspace.getConfiguration("mqTracker");
  // VS Code's own GitHub Enterprise sign-in already needs `github-enterprise.uri`; reuse it when ours is unset.
  const uri = cfg.get<string>("enterpriseUri")?.trim() || vscode.workspace.getConfiguration("github-enterprise").get<string>("uri")?.trim();
  const pollSeconds = clampPollSeconds(cfg.get("pollSeconds"));
  return {
    tracked: readTrackedRepos(cfg.get("repos")),
    pollSeconds,
    unfocusedPollSeconds: clampUnfocusedPollSeconds(cfg.get("unfocusedPollSeconds"), pollSeconds),
    notify: cfg.get<boolean>("notify", true),
    notifyProgress: cfg.get<boolean>("notifyProgress", true),
    enterpriseUri: uri || undefined,
  };
}

function setContext(key: string, value: boolean): Thenable<unknown> {
  return vscode.commands.executeCommand("setContext", key, value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first failing check's own page when known, otherwise the pull request's checks tab. */
function checksUrl(entry: QueueEntry, outcome?: Outcome): string {
  const failed = outcome?.kind === "removed" ? outcome.failedChecks?.find((c) => c.url) : undefined;
  return failed?.url ?? `${entry.url}/checks`;
}

class Tracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly provider = new QueueTreeProvider();
  private readonly view: vscode.TreeView<Node>;
  private readonly status = new StatusBar(`${VIEW_ID}.focus`);
  private readonly recent = new RecentEvents();
  private readonly poller: Poller;
  private readonly workspace: WorkspaceRepos;
  private previous: RepoQueue[] | undefined;
  private restoreTried = false;
  private lastPoll: PollResult | undefined;
  private warning: string | undefined;
  private signedIn = false;
  private loading = true;
  private ownOnly: boolean;
  private demo: DemoSource | undefined;
  private lastSaved = "";

  constructor(
    private readonly log: vscode.LogOutputChannel,
    private readonly memento: vscode.Memento,
  ) {
    this.view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this.provider });
    this.poller = new Poller(() => this.poll(), log);
    this.workspace = new WorkspaceRepos(log);
    this.ownOnly = memento.get<boolean>(OWN_ONLY_KEY, false);
    this.recent.load(memento.get(RECENT_KEY));
    void setContext("mqTracker.ownOnly", this.ownOnly);
    this.disposables.push(
      this.view,
      this.provider,
      this.status,
      this.poller,
      this.workspace,
      vscode.commands.registerCommand("mqTracker.refresh", () => this.poller.runNow()),
      vscode.commands.registerCommand("mqTracker.show", () => vscode.commands.executeCommand(`${VIEW_ID}.focus`)),
      vscode.commands.registerCommand("mqTracker.openSettings", () =>
        vscode.commands.executeCommand("workbench.action.openSettings", "mqTracker"),
      ),
      vscode.commands.registerCommand("mqTracker.signIn", () => this.signIn()),
      vscode.commands.registerCommand("mqTracker.toggleDemo", () => this.toggleDemo()),
      vscode.commands.registerCommand("mqTracker.showOwnOnly", () => this.setOwnOnly(true)),
      vscode.commands.registerCommand("mqTracker.showAll", () => this.setOwnOnly(false)),
      vscode.commands.registerCommand("mqTracker.addRepo", () => this.addRepository()),
      vscode.commands.registerCommand("mqTracker.addWorkspaceRepo", () => this.addWorkspaceRepository()),
      vscode.commands.registerCommand("mqTracker.removeRepo", (node?: Node) => this.removeRepository(node)),
      vscode.commands.registerCommand("mqTracker.openQueue", (node?: Node) => this.openQueue(node)),
      vscode.commands.registerCommand("mqTracker.openLink", (node?: Node) => this.openUrl(node?.kind === "link" ? node.url : undefined)),
      vscode.commands.registerCommand("mqTracker.openPr", (node?: Node) => this.openUrl(entryOf(node)?.url)),
      vscode.commands.registerCommand("mqTracker.openChecks", (node?: Node) => {
        const entry = entryOf(node);
        return this.openUrl(entry ? checksUrl(entry, node?.kind === "recentItem" ? node.event.outcome : undefined) : undefined);
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.log.info("Window focused; polling resumes.");
          this.poller.resume();
        } else {
          this.applyUnfocusedPolicy();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("mqTracker") && !event.affectsConfiguration("github-enterprise.uri")) return;
        if (
          event.affectsConfiguration("mqTracker.repos") ||
          event.affectsConfiguration("mqTracker.enterpriseUri") ||
          event.affectsConfiguration("github-enterprise.uri")
        ) {
          this.previous = undefined;
          this.restoreTried = true;
          this.lastPoll = undefined;
          this.loading = true;
        }
        this.log.info("Settings changed; polling now.");
        this.poller.runNow();
        if (!vscode.window.state.focused) this.applyUnfocusedPolicy();
        void this.updateWorkspaceContext();
      }),
      vscode.authentication.onDidChangeSessions((event) => {
        if (!AUTH_PROVIDERS.has(event.provider.id)) return;
        this.log.info(`GitHub sessions changed (${event.provider.id}); polling now.`);
        this.poller.runNow();
      }),
      this.workspace.onDidChange(() => void this.updateWorkspaceContext()),
    );
  }

  start(): void {
    this.poller.runNow();
    if (!vscode.window.state.focused) this.applyUnfocusedPolicy();
    void this.updateWorkspaceContext();
  }

  dispose(): void {
    for (const d of this.disposables.splice(0)) d.dispose();
  }

  /**
   * The window is not focused: poll slowly or pause, as configured. Demo mode
   * keeps playing. Safe to call right after `runNow`, since a running poll
   * schedules its own successor with the unfocused interval.
   */
  private applyUnfocusedPolicy(): void {
    if (this.demo) {
      this.poller.rescheduleIn(DEMO_POLL_MS);
      return;
    }
    const slow = readConfig().unfocusedPollSeconds;
    if (slow > 0) {
      this.log.info(`Window unfocused; polling every ${formatDuration(slow * 1000)} until it is focused again.`);
      this.poller.rescheduleIn(slow * 1000);
    } else {
      this.log.info("Window unfocused; polling paused.");
      this.poller.pause();
    }
  }

  /** The interval the next poll should use, given the window state. */
  private intervalSeconds(config: Config): number {
    if (vscode.window.state.focused || !config.unfocusedPollSeconds) return config.pollSeconds;
    return config.unfocusedPollSeconds;
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
      return this.intervalSeconds(config) * 1000;
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
      return this.intervalSeconds(config) * 1000;
    }

    const endpoint = graphqlEndpoint(config.enterpriseUri);
    if (!this.restoreTried) {
      this.restoreTried = true;
      this.previous = restoreSnapshot(this.memento.get(SNAPSHOT_KEY), endpoint);
      if (this.previous) this.log.info(`Restored the last poll's queues (${this.previous.length} repositories) from before the window reload.`);
    }
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
    if (config.notify && config.notifyProgress) this.notifyProgress(diff, result.viewer);

    const entries = result.repos.flatMap((r) => r.entries);
    const summary = summarize(entries, result.viewer);
    const delay = nextDelay({ pollSeconds: this.intervalSeconds(config), failed: false, rateLimit: result.rateLimit, now: Date.now() });
    this.warning =
      delay.reason === "rate-limit"
        ? l10n.t("GitHub rate limit is low ({0} left). Next poll in {1}.", result.rateLimit?.remaining ?? 0, formatDuration(delay.delayMs))
        : undefined;
    this.render(config);
    this.view.description = l10n.t("updated {0}", formatClock(new Date().toISOString()));
    this.status.update(entries, result.viewer);
    this.view.badge = summary.ownCount
      ? { value: summary.ownCount, tooltip: l10n.t("{0} of your pull requests are in a merge queue", summary.ownCount) }
      : undefined;
    await this.persist(endpoint, result.repos);
    this.log.info(
      `Polled ${result.repos.length} repositories as ${result.viewer || "?"}: ${entries.length} queued (${summary.ownCount} yours), ` +
        `${diff.entered.length} entered, ${diff.moved.length} moved, ${diff.changed.length} changed state, ${diff.left.length} left. ` +
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
    if (config.notify && config.notifyProgress) this.notifyProgress(diff, result.viewer);
    const entries = result.repos.flatMap((r) => r.entries);
    const summary = summarize(entries, result.viewer);
    this.warning = l10n.t("Demo mode: sample data, not GitHub. Run “Toggle Demo Mode” to stop.");
    this.render(config, DEMO_REPOS);
    this.view.description = l10n.t("demo");
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
    // Leaving demo mode picks the real snapshot back up; entering it never overwrites that snapshot.
    this.restoreTried = !!this.demo;
    this.lastPoll = undefined;
    this.warning = undefined;
    this.loading = true;
    this.view.description = "";
    this.recent.clear();
    if (!this.demo) this.recent.load(this.memento.get(RECENT_KEY));
    this.log.info(this.demo ? "Demo mode on." : "Demo mode off.");
    this.poller.runNow();
    if (!vscode.window.state.focused) this.applyUnfocusedPolicy();
  }

  /** Saves the poll and the recent list, skipping the write when nothing changed since the last save. */
  private persist(endpoint: string, repos: RepoQueue[]): Thenable<void> {
    const snapshot = makeSnapshot(endpoint, repos);
    const recent = this.recent.snapshot();
    const fingerprint = JSON.stringify([endpoint, repos, recent]);
    if (fingerprint === this.lastSaved) return Promise.resolve();
    this.lastSaved = fingerprint;
    return Promise.all([this.memento.update(SNAPSHOT_KEY, snapshot), this.memento.update(RECENT_KEY, recent)]).then(
      () => undefined,
      (error: unknown) => this.log.warn(`Could not save state: ${messageOf(error)}`),
    );
  }

  private async setOwnOnly(ownOnly: boolean): Promise<void> {
    this.ownOnly = ownOnly;
    await Promise.all([setContext("mqTracker.ownOnly", ownOnly), this.memento.update(OWN_ONLY_KEY, ownOnly)]);
    this.render(readConfig(), this.demo ? DEMO_REPOS : undefined);
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
      const failed = outcome.kind === "removed" && outcome.failedChecks?.length ? ` failed: ${outcome.failedChecks.map((c) => c.name).join(", ")}.` : "";
      this.log.info(
        `${entry.repo}#${entry.number} ${outcome.kind}${outcome.kind === "removed" ? ` (${outcome.reason ?? "reason not reported"})` : ""}${failed}${own ? " [yours]" : ""}.`,
      );
      if (notify && own) void this.notify(entry, outcome);
    });
  }

  /** Quieter heads-ups for the viewer's own pull requests that are still queued. */
  private notifyProgress(diff: QueueDiff, viewer: string): void {
    for (const { entry, from } of diff.moved) {
      if (entry.position === 1 && from > 1 && isOwn(entry, viewer)) {
        this.log.info(`${entry.repo}#${entry.number} is next to merge [yours].`);
        void this.toast("info", l10n.t("#{0} is next to merge in {1}", entry.number, entry.repo), entry);
      }
    }
    for (const { entry, from } of diff.changed) {
      if (entry.state === "UNMERGEABLE" && from !== "UNMERGEABLE" && isOwn(entry, viewer)) {
        this.log.info(`${entry.repo}#${entry.number} cannot merge at position ${entry.position} [yours].`);
        void this.toast(
          "warning",
          l10n.t("#{0} cannot merge at position {1}: a check is failing or there is a conflict", entry.number, entry.position),
          entry,
          true,
        );
      }
    }
  }

  private async notify(entry: QueueEntry, outcome: Outcome): Promise<void> {
    if (outcome.kind === "merged") {
      await this.toast("info", l10n.t("#{0} merged", entry.number), entry);
      return;
    }
    const reason = outcome.reason ?? l10n.t("reason not reported");
    const failed = outcome.failedChecks?.map((c) => c.name) ?? [];
    const message = failed.length
      ? l10n.t("#{0} removed from queue: {1} Failed: {2}", entry.number, reason.endsWith(".") ? reason : `${reason}.`, failed.join(", "))
      : l10n.t("#{0} removed from queue: {1}", entry.number, reason);
    await this.toast("warning", message, entry, true, outcome);
  }

  /** A toast with [Open checks] (optional) and [Open PR]. */
  private async toast(kind: "info" | "warning", message: string, entry: QueueEntry, withChecks = false, outcome?: Outcome): Promise<void> {
    const openPr = l10n.t("Open PR");
    const openChecks = l10n.t("Open checks");
    const actions = withChecks ? [openChecks, openPr] : [openPr];
    const show = kind === "info" ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
    const picked = await show(message, ...actions);
    if (picked === openChecks) await this.openUrl(checksUrl(entry, outcome));
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
      ownOnly: this.ownOnly,
      ssoUrl: ssoAuthorizeUrl(config.enterpriseUri),
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
    await this.track(config, parsed);
  }

  /** Workspace repositories on the configured host that are not tracked yet. */
  private untrackedWorkspaceRepos(config: Config): WorkspaceRepo[] {
    const tracked = new Set(config.tracked.repos.map((r) => repoKey(r).toLowerCase()));
    return this.workspace.list(webHost(config.enterpriseUri)).filter((r) => !tracked.has(repoKey(r).toLowerCase()));
  }

  private updateWorkspaceContext(): Thenable<unknown> {
    return setContext("mqTracker.hasWorkspaceRepo", this.untrackedWorkspaceRepos(readConfig()).length > 0);
  }

  private async addWorkspaceRepository(): Promise<void> {
    const config = readConfig();
    const host = webHost(config.enterpriseUri);
    const found = this.workspace.list(host);
    if (!found.length) {
      void vscode.window.showInformationMessage(l10n.t("No git remote in this workspace points at {0}.", host));
      return;
    }
    const candidates = this.untrackedWorkspaceRepos(config);
    if (!candidates.length) {
      void vscode.window.showInformationMessage(l10n.t("{0} is already tracked.", found.map((r) => repoKey(r)).join(", ")));
      return;
    }
    let chosen: WorkspaceRepo | undefined = candidates[0];
    if (candidates.length > 1) {
      const pick = await vscode.window.showQuickPick(
        candidates.map((repo) => ({ label: `$(repo) ${repoKey(repo)}`, description: repo.folder, repo })),
        { title: l10n.t("Track which repository?"), placeHolder: l10n.t("Repositories found in this workspace's git remotes") },
      );
      chosen = pick?.repo;
    }
    if (!chosen) return;
    if (config.tracked.repos.length >= MAX_REPOS) {
      void vscode.window.showWarningMessage(l10n.t("You can track at most {0} repositories. Remove one first.", MAX_REPOS));
      return;
    }
    await this.track(config, chosen);
  }

  private async track(config: Config, repo: { owner: string; name: string }): Promise<void> {
    const key = repoKey(repo);
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
  const tracker = new Tracker(log, context.globalState);
  context.subscriptions.push(log, tracker);
  tracker.start();
}

export function deactivate(): void {}
