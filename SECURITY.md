# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
reporting instead: open the repository's **Security** tab and choose
**Report a vulnerability**. You will get an acknowledgement within a week.

## Scope

This extension reads merge queues through GitHub's GraphQL API using the
GitHub session VS Code already holds. Reports about token handling, data sent
anywhere other than the configured GitHub host, or anything written to disk
are especially welcome. There is no telemetry and no other network traffic.
