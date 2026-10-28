## Sign in to GitHub

Merge Queue Tracker uses the GitHub account you already use in VS Code. It asks for the `repo` scope because merge queues are only readable through GitHub's GraphQL API, and private repositories need that scope to be read at all.

The extension only reads. It never enqueues, dequeues, comments, or writes anything to GitHub, and the token stays inside VS Code's authentication store.

**GitHub Enterprise Server:** set `github-enterprise.uri` to your server. The extension picks it up and uses the enterprise sign-in and your server's GraphQL endpoint.
