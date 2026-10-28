# Merge Queue Tracker

See your GitHub merge queues in the VS Code sidebar, and get a notification the
moment one of your pull requests merges or gets kicked out of the queue.
Works with github.com and GitHub Enterprise Server, light and dark themes, and
VS Code, Cursor, or VSCodium.

<!-- Screenshot and GIF come from the public demo repository once it exists. -->

## Install

Until the Marketplace listing is live, install from a `.vsix`:

```bash
npm install
npx vsce package
code --install-extension merge-queue-tracker-0.1.0.vsix
```

## Quick start

1. Open the **Merge Queues** view from the activity bar.
2. Click **Add repository** and pick one from the list, or type `owner/name`
   or paste a GitHub URL. Repositories with a merge queue on their default
   branch are marked.
3. Sign in to GitHub when VS Code asks. The extension reuses VS Code's own
   GitHub sign-in, so there is no token to paste.

Each tracked repository shows its queue in order, with the position, the
estimated time to merge, and a check-status icon per pull request. Your own
pull requests are highlighted, counted on the activity-bar badge, and summarised
in the status bar. Pull requests that merged or were removed in the last two
hours appear under **Recent**.

## Try it without a GitHub account

Run **Merge Queues: Toggle Demo Mode** from the Command Palette. The view,
status bar, badge, and notifications then play through a scripted sample
queue (a pull request enters, moves up, merges, another gets removed) with no
sign-in and no network. Run the command again to stop.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `mqTracker.repos` | `[]` | Repositories to track, as `{ "repo": "owner/name", "branch": "main" }`. Leave `branch` out to use the default branch. At most 20. |
| `mqTracker.pollSeconds` | `45` | Seconds between polls while the window is focused. Minimum 15. |
| `mqTracker.notify` | `true` | Toast when one of your pull requests merges or is removed. |
| `mqTracker.enterpriseUri` | `""` | GitHub Enterprise Server URL. See the FAQ. |

Example `settings.json`:

```json
"mqTracker.repos": [
  { "repo": "my-org/web-app" },
  { "repo": "my-org/api", "branch": "release" }
]
```

## FAQ

**Why does it ask for the `repo` scope?**
Merge queues are only readable through GitHub's GraphQL API, and private
repositories need the `repo` scope to be read at all. The extension only
reads: it never enqueues, dequeues, comments, or writes anything to GitHub.

**Does it work with GitHub Enterprise Server?**
Yes. Set `mqTracker.enterpriseUri` to your server, for example
`https://github.example.com`, and set VS Code's own `github-enterprise.uri`
to the same value so VS Code can sign you in. The extension then uses the
GitHub Enterprise sign-in and your server's GraphQL endpoint.

**What does it send, and where?**
Nothing but GraphQL queries to your GitHub host (github.com or the enterprise
URI you set). There is no telemetry, no analytics, and no other network
traffic. Tokens stay inside VS Code's authentication store and are never
written to disk by this extension.

**Why does polling stop sometimes?**
Polling pauses while the VS Code window is unfocused and resumes with an
immediate refresh when you come back. After an API error it waits five
minutes, and when your GraphQL rate limit drops under 200 points it waits for
the reset. The **Merge Queue Tracker** output channel logs every poll.

**Why don't I see a queue for my repository?**
GitHub only offers merge queues on repositories owned by an organisation, and
the queue has to be enabled in a branch protection rule or ruleset. The row
reads "No merge queue on `<branch>`" when the branch has none.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
