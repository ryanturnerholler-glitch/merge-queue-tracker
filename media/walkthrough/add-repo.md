## Track a repository

Three ways to add one:

- **Pick from a list.** *Add Repository* lists the repositories you can access, newest activity first, and marks the ones that have a merge queue on their default branch.
- **Type it.** Enter `owner/name` or paste any GitHub URL into the same picker.
- **Use the open workspace.** When a folder's git remote points at GitHub, *Track This Workspace's Repository* adds it in one step.

Each tracked repository gets a row in the **Merge Queues** view with its queue in order: position, estimated time to merge, author, and a check-status icon per pull request. Your own pull requests are highlighted, counted on the activity-bar badge, and summarised in the status bar.

GitHub only offers merge queues on organisation-owned repositories with the queue enabled in a branch protection rule or ruleset. A repository without one shows "No merge queue on `<branch>`".
