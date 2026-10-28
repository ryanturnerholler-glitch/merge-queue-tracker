import * as vscode from "vscode";
import { l10n } from "vscode";
import { formatClock, formatEta, isOwn, truncate } from "./format";
import { iconForOutcome, iconForState, type IconSpec } from "./icons";
import { repoKey } from "./repos";
import type { EntryState, PollResult, QueueEntry, RecentEvent, RepoQueue, TrackedRepo } from "./types";

export type Node =
  | { kind: "warning"; message: string }
  | { kind: "overflow"; dropped: number }
  | { kind: "invalid"; entries: string[] }
  | { kind: "repo"; tracked: TrackedRepo; queue: RepoQueue | undefined }
  | { kind: "info"; repo: string; message: string; isError: boolean }
  | { kind: "entry"; entry: QueueEntry; own: boolean }
  | { kind: "detail"; entry: QueueEntry }
  | { kind: "recent" }
  | { kind: "recentItem"; event: RecentEvent };

export interface TreeState {
  tracked: TrackedRepo[];
  dropped: number;
  invalid: string[];
  poll: PollResult | undefined;
  loading: boolean;
  warning: string | undefined;
  recent: RecentEvent[];
  signedIn: boolean;
}

const EMPTY_STATE: TreeState = {
  tracked: [],
  dropped: 0,
  invalid: [],
  poll: undefined,
  loading: true,
  warning: undefined,
  recent: [],
  signedIn: false,
};

function stateLabel(state: EntryState): string {
  switch (state) {
    case "AWAITING_CHECKS":
      return l10n.t("checks running");
    case "QUEUED":
      return l10n.t("queued");
    case "MERGEABLE":
      return l10n.t("ready to merge");
    case "UNMERGEABLE":
      return l10n.t("cannot merge");
    case "LOCKED":
      return l10n.t("locked");
  }
}

function themeIcon(spec: IconSpec): vscode.ThemeIcon {
  return new vscode.ThemeIcon(spec.codicon, spec.color ? new vscode.ThemeColor(spec.color) : undefined);
}

export class QueueTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private state: TreeState = EMPTY_STATE;

  update(state: TreeState): void {
    this.state = state;
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.changed.dispose();
  }

  getChildren(element?: Node): Node[] {
    const s = this.state;
    if (!element) {
      // An empty root shows the welcome view: add a repository, or sign in.
      if (!s.tracked.length || !s.signedIn) return [];
      const nodes: Node[] = [];
      if (s.warning) nodes.push({ kind: "warning", message: s.warning });
      if (s.dropped > 0) nodes.push({ kind: "overflow", dropped: s.dropped });
      if (s.invalid.length) nodes.push({ kind: "invalid", entries: s.invalid });
      for (const tracked of s.tracked) {
        const key = repoKey(tracked).toLowerCase();
        const queue = s.poll?.repos.find((q) => q.repo.toLowerCase() === key);
        nodes.push({ kind: "repo", tracked, queue });
      }
      if (s.recent.length) nodes.push({ kind: "recent" });
      return nodes;
    }

    switch (element.kind) {
      case "repo": {
        const key = repoKey(element.tracked);
        const queue = element.queue;
        if (!queue) {
          return s.loading ? [{ kind: "info", repo: key, message: l10n.t("Loading…"), isError: false }] : [];
        }
        if (queue.error) return [{ kind: "info", repo: key, message: queue.error, isError: true }];
        if (!queue.hasQueue) {
          return [{ kind: "info", repo: key, message: l10n.t("No merge queue on {0}", queue.branch), isError: false }];
        }
        if (!queue.entries.length) return [{ kind: "info", repo: key, message: l10n.t("Queue empty"), isError: false }];
        const viewer = s.poll?.viewer ?? "";
        return queue.entries.map((entry) => ({ kind: "entry", entry, own: isOwn(entry, viewer) }));
      }
      case "entry":
        return [{ kind: "detail", entry: element.entry }];
      case "recent":
        return s.recent.map((event) => ({ kind: "recentItem", event }));
      default:
        return [];
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "warning": {
        const item = new vscode.TreeItem(node.message);
        item.iconPath = node.message.startsWith(l10n.t("Demo mode"))
          ? new vscode.ThemeIcon("beaker", new vscode.ThemeColor("charts.purple"))
          : new vscode.ThemeIcon("warning", new vscode.ThemeColor("notificationsWarningIcon.foreground"));
        item.tooltip = node.message;
        item.contextValue = "warning";
        return item;
      }
      case "overflow": {
        const item = new vscode.TreeItem(l10n.t("{0} more repositories are not tracked (limit is 20)", node.dropped));
        item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("notificationsWarningIcon.foreground"));
        item.contextValue = "warning";
        return item;
      }
      case "invalid": {
        const item = new vscode.TreeItem(l10n.t("Ignored {0} unreadable entries in mqTracker.repos", node.entries.length));
        item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("notificationsWarningIcon.foreground"));
        item.tooltip = node.entries.join("\n");
        item.contextValue = "warning";
        return item;
      }
      case "repo":
        return this.repoItem(node.tracked, node.queue);
      case "info": {
        const item = new vscode.TreeItem(node.message);
        item.id = `info:${node.repo}`;
        item.iconPath = node.isError
          ? new vscode.ThemeIcon("warning", new vscode.ThemeColor("notificationsWarningIcon.foreground"))
          : new vscode.ThemeIcon("info");
        item.tooltip = node.message;
        item.contextValue = "info";
        return item;
      }
      case "entry":
        return this.entryItem(node.entry, node.own);
      case "detail": {
        const entry = node.entry;
        const enqueued = formatClock(entry.enqueuedAt);
        const item = new vscode.TreeItem(`${entry.author} · ${stateLabel(entry.state)}`);
        item.id = `detail:${entry.repo}#${entry.number}`;
        item.description = enqueued ? l10n.t("queued at {0}", enqueued) : "";
        item.tooltip = entry.enqueuer && entry.enqueuer !== entry.author ? l10n.t("Added to the queue by {0}", entry.enqueuer) : undefined;
        item.contextValue = "detail";
        item.command = { command: "mqTracker.openPr", title: l10n.t("Open Pull Request"), arguments: [node] };
        return item;
      }
      case "recent": {
        const item = new vscode.TreeItem(l10n.t("Recent (last 2h)"), vscode.TreeItemCollapsibleState.Expanded);
        item.id = "recent";
        item.iconPath = new vscode.ThemeIcon("history");
        item.contextValue = "recent";
        return item;
      }
      case "recentItem":
        return this.recentItem(node.event, node);
    }
  }

  private repoItem(tracked: TrackedRepo, queue: RepoQueue | undefined): vscode.TreeItem {
    const key = repoKey(tracked);
    const branch = queue?.branch || tracked.branch || l10n.t("default branch");
    const item = new vscode.TreeItem(`${tracked.name} · ${branch}`, vscode.TreeItemCollapsibleState.Expanded);
    item.id = `repo:${key}`;
    item.iconPath = new vscode.ThemeIcon("repo");
    item.description = queue?.hasQueue ? String(queue.entries.length) : "";
    item.tooltip = key;
    item.contextValue = "repo";
    return item;
  }

  private entryItem(entry: QueueEntry, own: boolean): vscode.TreeItem {
    const text = `${entry.position}  #${entry.number}: ${truncate(entry.title)}`;
    const hashAt = text.indexOf("#");
    const label: vscode.TreeItemLabel = {
      label: text,
      highlights: own ? [[hashAt, hashAt + `#${entry.number}`.length]] : [],
    };
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `entry:${entry.repo}#${entry.number}`;
    item.iconPath = themeIcon(iconForState(entry.state));
    item.description = formatEta(entry.etaSeconds) ?? "";
    item.contextValue = "entry";
    item.command = { command: "mqTracker.openPr", title: l10n.t("Open Pull Request"), arguments: [{ kind: "entry", entry, own }] };

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**#${entry.number}** ${entry.title}\n\n`);
    tooltip.appendMarkdown(`${entry.repo} · ${l10n.t("position {0}", entry.position)} · ${stateLabel(entry.state)}\n\n`);
    tooltip.appendMarkdown(l10n.t("Author: {0}", entry.author));
    if (entry.enqueuer && entry.enqueuer !== entry.author) tooltip.appendMarkdown(` · ${l10n.t("Enqueued by: {0}", entry.enqueuer)}`);
    const enqueued = formatClock(entry.enqueuedAt);
    if (enqueued) tooltip.appendMarkdown(` · ${l10n.t("Enqueued at {0}", enqueued)}`);
    const eta = formatEta(entry.etaSeconds);
    if (eta) tooltip.appendMarkdown(` · ${l10n.t("ETA {0}", eta)}`);
    if (own) tooltip.appendMarkdown(`\n\n${l10n.t("This is your pull request.")}`);
    item.tooltip = tooltip;
    return item;
  }

  private recentItem(event: RecentEvent, node: Node): vscode.TreeItem {
    const { entry, outcome } = event;
    const item = new vscode.TreeItem(`#${entry.number}`);
    item.id = `recent:${entry.repo}#${entry.number}`;
    item.iconPath = themeIcon(iconForOutcome(outcome));
    const when = formatClock(outcome.at) || formatClock(new Date(event.observedAt).toISOString());
    if (outcome.kind === "merged") {
      item.description = l10n.t("merged {0}", when);
      item.contextValue = "merged";
    } else {
      item.description = l10n.t("removed: {0}", outcome.reason ?? l10n.t("reason not reported"));
      item.contextValue = "removed";
    }
    item.tooltip = `${entry.repo} #${entry.number} ${entry.title}\n${item.description}`;
    item.command = { command: "mqTracker.openPr", title: l10n.t("Open Pull Request"), arguments: [node] };
    return item;
  }
}
