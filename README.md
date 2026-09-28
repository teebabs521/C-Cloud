# C-Cloud

A self-hosted platform for migrating a website off shared cPanel hosting onto
your own cloud infrastructure: upload a cPanel full account backup, review
what's in it, pick a destination, and let it provision the target, move your
files and database, and hand you a DNS cutover checklist.

## How it works

```
packages/
  migration-engine/   Core library: no HTTP, no UI. Parses cPanel backups
                       into a provider-agnostic plan and deploys that plan
                       onto a target via a pluggable adapter.
  api/                 Fastify server: upload handling, job state (SQLite),
                       and a REST + SSE API in front of migration-engine.
  web/                 React wizard UI that drives the API.
```

**Pipeline:** upload `.tar.gz` → extract → parse into a `CpanelBackupPlan`
(domains, databases, mailboxes, forwarders, cron jobs, DNS zone, PHP
version per domain) → you review/edit the selection → you pick a target →
the target adapter provisions compute, transfers files, imports databases,
installs cron jobs, and preserves mailbox data → you get a DNS cutover
checklist and, if applicable, freshly generated DB/SSH credentials.

### Targets

- **Docker/VM** (`docker-vm`) — any box you can SSH into (a DigitalOcean/
  Linode/Hetzner droplet, a bare EC2 instance, etc.). Installs Docker if
  missing, generates a `docker-compose.yml` with one nginx+php-fpm pair per
  migrated domain (matching each domain's cPanel PHP version where known)
  plus a MySQL container, and deploys onto it over SSH/rsync/scp.
- **AWS** (`aws`) — two compute modes:
  - `lightsail`: creates an Ubuntu Lightsail instance, then runs the same
    Docker Compose deployment as the generic VM target.
  - `ec2-rds`: creates an EC2 instance (default VPC) plus a MySQL RDS
    instance in a security group scoped to that EC2 instance, and deploys
    the app containers to EC2 while pointing the database at RDS.

  Either way, C-Cloud generates a **fresh SSH key pair per migration job**
  via the AWS API — you never need to hand it a long-lived key.

Both adapters share the same SSH-based deployment steps
(`migration-engine/src/adapters/dockerVm/deploy.ts`), so adding a new
compute target mostly means writing a `provision()` that ends with "I have
a box with a public IP and this SSH key."

## Prerequisites

- Node.js 20+
- For the **Docker/VM** target: `ssh`, `rsync`, `scp` available on the
  machine running the API (already included in `packages/api/Dockerfile`).
- For the **AWS** target: an IAM user/role with permission to create
  Lightsail instances/key pairs, or EC2 instances/security groups/key pairs
  + RDS instances, depending on the mode you use.
- A cPanel **Full Account Backup** (`Backup Wizard → Full Account Backup`
  in cPanel), which produces a `backup-<date>_<user>.tar.gz`.

## Getting started (local dev)

```bash
npm install
npm run build --workspace packages/migration-engine   # api/web import its compiled output

npm run dev:api    # Fastify on :4000
npm run dev:web     # Vite on :5173 (proxies /api to :4000)
```

Or run just the API in a container:

```bash
docker compose up --build
```

### Environment variables (API)

| Variable      | Default                  | Purpose                              |
|---------------|---------------------------|---------------------------------------|
| `PORT`        | `4000`                    | API port                              |
| `DATA_DIR`    | `./data`                  | Uploads, extracted backups, SQLite DB |
| `CORS_ORIGIN` | `http://localhost:5173`   | Allowed origin for the web UI         |

## Testing

```bash
npm run test --workspace packages/migration-engine
```

Covers the cPanel backup parser (against a synthetic fixture backup under
`packages/migration-engine/test/fixtures/`) and the Docker Compose
generator. The SSH/rsync deployment steps and the AWS provisioning calls
aren't covered by automated tests in this repo (they need a real SSH
target / AWS account) — they were exercised manually against the API's
HTTP surface (upload → parse → select → configure target → run) and fail
cleanly with a descriptive error when, e.g., `ssh` isn't installed.

## Known limitations / next steps

- **Credentials at rest**: target credentials (SSH password/key, AWS
  secret key) are currently stored as plaintext JSON in the job's SQLite
  row. Fine for local/self-hosted use; before running this against
  anything shared, encrypt that column or move secrets to a proper vault.
- **Email**: mailbox *data* (Maildir) and forwarder *definitions* are
  migrated/preserved, but no mail server (Postfix/Dovecot) is stood up
  automatically — the wizard's final step gives you the copied data's
  location and points you at either a hosted provider (Google Workspace,
  Mailgun, SES) or self-hosting Postfix/Dovecot against that data.
- **DNS**: the wizard produces a checklist (A/MX/CNAME records to change)
  rather than pushing records to a registrar/DNS API automatically — DNS
  providers vary too much to standardize on one without more input on
  which you use.
- **EC2+RDS** provisioning targets the account's default VPC with a single
  public subnet — fine for a small/medium site, not a hardened production
  network layout (no private subnets, no Multi-AZ RDS).
- One migration job runs one target deployment; there's no rollback command
  yet if a step fails partway (the job's log tells you exactly which step
  got to, which files copied over stay in place).
