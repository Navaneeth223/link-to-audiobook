# Security policy

## Reporting a vulnerability

Please do not post exploitable details in a public issue. Use GitHub's private vulnerability reporting for this repository when it is enabled. If that feature is unavailable, contact the repository maintainer privately through their published GitHub profile and include a reproduction, affected version, and impact. Do not include real story text, share URLs, OAuth codes, access tokens, or personal voice recordings in a report.

This project is maintained on a best-effort basis. There is no guaranteed response time or security support SLA. Please allow maintainers a reasonable opportunity to investigate and prepare a fix before public disclosure.

## Deployment notes

Use HTTPS in production, configure a strong `SESSION_SECRET`, keep Microsoft credentials on the API server, use a persistent protected session store for multi-process deployments, and restrict `APP_ORIGIN` to the deployed reader origin. Do not enable debug logging that captures request bodies or document URLs.
