# Merge Queue Tracker

See your GitHub merge queues in the VS Code sidebar, and get a notification the
moment one of your pull requests merges or gets kicked out of the queue.
Works with github.com and GitHub Enterprise Server, light and dark themes, and
VS Code, Cursor, or VSCodium.

<!-- Screenshot and GIF come from the public demo repository once it exists. -->

## Install

Search for **Merge Queue Tracker** in the Extensions view, or install it from
the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ryanholler.merge-queue-tracker).

Cursor, VSCodium, and other editors that don't use the Marketplace: download
the `.vsix` from the [latest release](https://github.com/ryanturnerholler-glitch/merge-queue-tracker/releases/latest)
and install it with **Extensions: Install from VSIX...** from the Command
Palette.

## Quick start

1. Open the **Merge Queues** view from the activity bar.
2. Click **Add repository** and pick one from the list, or type `owner/name`
   or paste a GitHub URL. Repositories with a merge queue on their default
   branch are marked. When the open folder's git remote points at GitHub,
   **Track this workspace's repository** adds it in one step.
3. Sign in to GitHub when VS Code asks. The extension reuses VS Code's own
   GitHub sign-in, so there is no token to paste.

The **Get Started with Merge Queue Tracker** walkthrough (Help → Welcome)
covers the same steps.

Each tracked repository shows its queue in order, with the position, the
estimated time to merge, and a check-status icon per pull request. Your own
pull requests are highlighted, counted on the activity-bar badge, and summarised
in the status bar. The filter button in the view title shows only your own
pull requests. Pull requests that merged or were removed in the last two hours
appear under **Recent**, with the names of the checks that failed.

## Alerts

For your own pull requests (authored or enqueued by you):

| Event | Notification |
| --- | --- |
| Merged | Info toast with **Open PR** |
| Removed from the queue | Warning toast with GitHub's reason and the failed checks, **Open checks** (jumps to the first failing check) and **Open PR** |
| Next to merge | Info toast when it reaches position 1 |
| Cannot merge | Warning toast when it turns unmergeable while still queued |

The last two are controlled by `mqTracker.notifyProgress`; `mqTracker.notify`
mutes everything. Alerts keep arriving while the window is unfocused because
polling slows down instead of stopping (see `mqTracker.unfocusedPollSeconds`),
and the last poll survives a window reload, so a pull request that merged
while VS Code restarted still shows under **Recent** and still notifies.

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
| `mqTracker.unfocusedPollSeconds` | `300` | Seconds between polls while the window is not focused. Never faster than `pollSeconds`; `0` pauses polling until the window is focused again. |
| `mqTracker.notify` | `true` | Toast when one of your pull requests merges or is removed. |
| `mqTracker.notifyProgress` | `true` | Also toast when one of your pull requests becomes next to merge or stops being mergeable. |
| `mqTracker.enterpriseUri` | `""` | GitHub Enterprise Server URL. Falls back to VS Code's `github-enterprise.uri`. See the FAQ. |

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
Yes. Set VS Code's own `github-enterprise.uri` to your server, for example
`https://github.example.com`, so VS Code can sign you in; the extension picks
the same value up and uses the GitHub Enterprise sign-in and your server's
GraphQL endpoint. `mqTracker.enterpriseUri` overrides it when the two differ.

**A repository says "Single sign-on required". What now?**
The organisation enforces SAML single sign-on, and VS Code's GitHub token has
not been authorised for it yet. Click the row: it opens the page where you
grant VS Code access to that organisation. Polling picks the repository up on
the next refresh.

**What does it send, and where?**
Nothing but GraphQL queries to your GitHub host (github.com or the enterprise
URI you set). There is no telemetry, no analytics, and no other network
traffic. Tokens stay inside VS Code's authentication store and are never
written to disk by this extension.

**Why does polling slow down sometimes?**
Polling runs every 45 seconds while the VS Code window is focused and every
5 minutes while it is not, then refreshes at once when you come back. Set
`mqTracker.unfocusedPollSeconds` to `0` to pause instead. After an API error
it waits five minutes, and when your GraphQL rate limit drops under 200 points
it waits for the reset. The view title shows when the last poll ran, and the
**Merge Queue Tracker** output channel logs every poll.

**What does it store on disk?**
The last poll's queue snapshot, the **Recent** list, and the filter state, in
VS Code's extension storage, so a window reload does not lose a merge that
happened meanwhile. Nothing else, and never a token.

**Why don't I see a queue for my repository?**
GitHub only offers merge queues on repositories owned by an organisation, and
the queue has to be enabled in a branch protection rule or ruleset. The row
reads "No merge queue on `<branch>`" when the branch has none.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
