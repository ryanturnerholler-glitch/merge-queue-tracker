## Tune the alerts

You get a notification when one of your pull requests:

- **merges**, with *Open PR*;
- **is removed from the queue**, with GitHub's reason and the names of the failed checks, plus *Open checks* that jumps to the first failing check;
- **becomes next to merge**, or **stops being mergeable** while still queued (`mqTracker.notifyProgress`).

Polling runs every 45 seconds while the VS Code window is focused and every 5 minutes while it is not, so the alert still arrives when you are in another app. Change the intervals with `mqTracker.pollSeconds` and `mqTracker.unfocusedPollSeconds`, or set the latter to 0 to pause polling while unfocused. `mqTracker.notify` mutes everything.

The last poll survives a window reload, so a pull request that merged while VS Code was restarting still shows under **Recent** and still notifies.
