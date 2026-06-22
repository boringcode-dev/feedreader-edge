# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in feedreader, please report it responsibly by emailing [hi@boringcode.dev](mailto:hi@boringcode.dev) instead of using the public issue tracker.

When reporting a security issue, please include:

- a description of the vulnerability
- steps to reproduce the issue (if applicable)
- the affected deployment or version
- any potential impact or proof of concept

We will acknowledge your report within 48 hours and work with you to understand and resolve the issue promptly.

## Security Considerations for Deployment

### Cloudflare account and API tokens

- use a least-privilege Cloudflare API token for deployments
- restrict token scope to the Worker and D1 resources this project needs
- rotate credentials if they are exposed or no longer needed

### Worker secrets and internal routes

- keep `REFRESH_SECRET` in Cloudflare secrets, never in source control
- do not log `REFRESH_SECRET` or echo it in responses
- keep `POST /internal/refresh/:source` gated by `X-Refresh-Secret`

### Public exposure

- the reader UI is read-only for normal users, but `POST /api/refresh` triggers upstream refresh work
- if abuse becomes a concern on a public deployment, add Cloudflare rate limiting, WAF rules, or access controls around refresh traffic
- do not add broader write endpoints without a deliberate authentication design

### Data and runtime

- review D1 usage and Worker logs for unexpected spikes
- monitor upstream source changes that could affect parser behavior
- keep Wrangler, TypeScript, and runtime dependencies current

## Supported Versions

Security updates should target the current deployed code on `main` and the latest production deployment.

## Disclosure Timeline

We aim to:

1. acknowledge receipt of the report within 48 hours
2. begin investigation and reproduce the issue
3. develop and test a fix
4. deploy a security fix if needed
5. notify the reporter of the resolution

We appreciate responsible disclosure and will credit you appropriately unless you prefer to remain anonymous.
