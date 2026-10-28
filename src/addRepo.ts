import * as vscode from "vscode";
import { l10n } from "vscode";
import {
  parseRepoChoices,
  SEARCH_REPOS_QUERY,
  VIEWER_REPOS_QUERY,
  type GraphQLResponse,
  type RepoChoice,
  type SearchReposData,
  type ViewerReposData,
} from "./github";
import { parseRepoInput } from "./repos";

export type RunQuery = <T>(query: string, variables: Record<string, unknown>) => Promise<GraphQLResponse<T>>;

interface RepoItem extends vscode.QuickPickItem {
  choice: RepoChoice;
}

const MAX_PAGES = 10;
const SEARCH_DEBOUNCE_MS = 300;

function toItem(choice: RepoChoice, typed = false): RepoItem {
  const details: string[] = [];
  if (typed) details.push(l10n.t("add as typed"));
  else if (choice.hasQueue) details.push(l10n.t("merge queue on {0}", choice.defaultBranch ?? l10n.t("default branch")));
  else details.push(l10n.t("no merge queue"));
  if (choice.isArchived) details.push(l10n.t("archived"));
  return {
    label: `${choice.hasQueue ? "$(git-merge) " : "$(repo) "}${choice.nameWithOwner}`,
    description: details.join(" · "),
    alwaysShow: typed,
    choice,
  };
}

/**
 * A searchable QuickPick of repositories the signed-in user can reach, marking
 * which have a merge queue on their default branch. Typing `owner/name` or a
 * GitHub URL offers that repository directly.
 */
export function pickRepository(run: RunQuery, log: vscode.LogOutputChannel): Promise<RepoChoice | undefined> {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick<RepoItem>();
    picker.title = l10n.t("Add a repository to track");
    picker.placeholder = l10n.t("Pick a repository, or type owner/name or a GitHub URL");
    picker.matchOnDescription = true;
    picker.ignoreFocusOut = true;
    picker.busy = true;

    const known = new Map<string, RepoItem>();
    let typed: RepoItem | undefined;
    let disposed = false;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let searchSeq = 0;

    const render = () => {
      picker.items = [...(typed ? [typed] : []), ...known.values()];
    };
    const remember = (choices: RepoChoice[]) => {
      for (const choice of choices) {
        const key = choice.nameWithOwner.toLowerCase();
        if (!known.has(key)) known.set(key, toItem(choice));
      }
    };

    const loadPages = async () => {
      let after: string | null = null;
      for (let page = 0; page < MAX_PAGES && !disposed; page++) {
        const response: GraphQLResponse<ViewerReposData> = await run<ViewerReposData>(VIEWER_REPOS_QUERY, { after });
        const repos = response.data?.viewer?.repositories;
        remember(parseRepoChoices(repos?.nodes));
        render();
        if (!repos?.pageInfo?.hasNextPage || !repos.pageInfo.endCursor) break;
        after = repos.pageInfo.endCursor;
      }
    };
    loadPages()
      .catch((error: unknown) => log.warn(`Listing repositories failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        if (!disposed) picker.busy = false;
      });

    const search = async (text: string) => {
      const seq = ++searchSeq;
      try {
        const response = await run<SearchReposData>(SEARCH_REPOS_QUERY, { q: `${text} in:name fork:true` });
        if (disposed || seq !== searchSeq) return;
        remember(parseRepoChoices(response.data?.search?.nodes));
        render();
      } catch (error) {
        log.warn(`Searching repositories failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    picker.onDidChangeValue((value) => {
      const parsed = parseRepoInput(value);
      const key = parsed ? `${parsed.owner}/${parsed.name}`.toLowerCase() : "";
      typed =
        parsed && !known.has(key)
          ? toItem({ nameWithOwner: `${parsed.owner}/${parsed.name}`, defaultBranch: null, hasQueue: false, isArchived: false }, true)
          : undefined;
      render();
      if (searchTimer) clearTimeout(searchTimer);
      const text = value.trim();
      if (text.length >= 2 && !/[:/]/.test(text)) {
        searchTimer = setTimeout(() => void search(text), SEARCH_DEBOUNCE_MS);
      }
    });
    picker.onDidAccept(() => {
      const picked = picker.selectedItems[0];
      picker.hide();
      resolve(picked?.choice);
    });
    picker.onDidHide(() => {
      disposed = true;
      if (searchTimer) clearTimeout(searchTimer);
      picker.dispose();
      resolve(undefined);
    });
    picker.show();
  });
}
