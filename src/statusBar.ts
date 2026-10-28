import * as vscode from "vscode";
import { l10n } from "vscode";
import { formatEta, summarize } from "./format";
import type { QueueEntry } from "./types";

/** `$(git-merge) MQ 4 · yours: #1234 pos 1 ~4m` on the left; hidden when every queue is empty. */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(focusCommand: string) {
    this.item = vscode.window.createStatusBarItem("mqTracker.status", vscode.StatusBarAlignment.Left, 100);
    this.item.name = l10n.t("Merge Queues");
    this.item.command = focusCommand;
  }

  update(entries: QueueEntry[], viewer: string): void {
    const summary = summarize(entries, viewer);
    if (!summary.total) {
      this.item.hide();
      return;
    }
    let text = `$(git-merge) MQ ${summary.total}`;
    let tooltip = l10n.t("{0} pull requests in merge queues", summary.total);
    if (summary.own) {
      const eta = formatEta(summary.own.etaSeconds);
      text += ` · ${l10n.t("yours: #{0} pos {1}", summary.own.number, summary.own.position)}${eta ? ` ${eta}` : ""}`;
      tooltip += `\n${l10n.t("Yours: #{0} {1}", summary.own.number, summary.own.title)}`;
    }
    this.item.text = text;
    this.item.tooltip = tooltip;
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
