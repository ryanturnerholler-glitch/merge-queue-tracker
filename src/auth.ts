import * as vscode from "vscode";

/** The VS Code auth provider for github.com or, when an enterprise URI is set, GitHub Enterprise Server. */
export function authProviderId(enterpriseUri: string | undefined): string {
  return enterpriseUri ? "github-enterprise" : "github";
}

/**
 * The signed-in GitHub session. The `repo` scope is required to read merge
 * queues of private repositories. With `createIfNone` false this never prompts;
 * VS Code just marks the Accounts menu so the user can sign in when ready.
 */
export function getSession(enterpriseUri: string | undefined, createIfNone: boolean): Thenable<vscode.AuthenticationSession | undefined> {
  const provider = authProviderId(enterpriseUri);
  return createIfNone
    ? vscode.authentication.getSession(provider, ["repo"], { createIfNone: true })
    : vscode.authentication.getSession(provider, ["repo"]);
}
