# C-Cloud

A self-hosted platform for migrating a website off shared cPanel hosting onto
your own cloud infrastructure: upload a cPanel full account backup, review
what's in it, pick a destination, and let it provision the target, move your
files and database, and hand you a DNS cutover checklist (or push it for you).

## How it works

```
packages/
  migration-engine/   Core library: no HTTP, no UI. Parses cPanel backups
                       into a provider-agnostic plan and deploys that plan
                       onto a target via a pluggable adapter.
  api/                 Fastify server: upload handling, job state (SQLite,
                       encrypted at rest), and a REST + SSE API in front of
                       migration-engine.
  web/                 React wizard UI that drives the API.
```

**Pipeline:** upload `.tar.gz` → extract → parse into a `CpanelBackupPlan`
(domains, databases, mailboxes, forwarders, cron jobs, DNS zone, PHP
version per domain) → you review/edit the selection → you pick a target →
the target adapter provisions compute, transfers files, imports databases,
installs cron jobs, and preserves mailbox data → you get a DNS cutover
checklist plus freshly generated DB/SSH credentials, and can either apply
the DNS cutover through a connected provider or do it by hand.

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

### DNS cutover

The wizard always shows a plain-language checklist (A/MX/CNAME records to
change). Optionally, you can also connect a DNS provider and have C-Cloud
push the change for you once you've verified the new site:

- **Cloudflare** — an API token scoped to the zone, pushed via Cloudflare's
  REST API (creates or updates records by type+name).
- **Route53** — an IAM access key + the hosted zone ID, pushed as a single
  `UPSERT` change batch via the AWS SDK.

This is a separate, explicit step from the migration run itself
(`POST /api/migrations/:id/dns/apply`) — DNS doesn't change automatically
just because file/DB transfer finished.

## Prerequisites

- Node.js 20+
- For the **Docker/VM** target: `ssh`, `rsync`, `scp` available on the
  machine running the API (already included in `packages/api/Dockerfile`).
- For the **AWS** target: an IAM user/role with permission to create
  Lightsail instances/key pairs, or EC2 instances/security groups/key pairs
  + RDS instances, depending on the mode you use.
- For **DNS cutover**: a Cloudflare API token scoped to the zone, or an AWS
  IAM user with `route53:ChangeResourceRecordSets` on the hosted zone.
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

| Variable                | Default                  | Purpose                                                     |
|--------------------------|---------------------------|---------------------------------------------------------------|
| `PORT`                   | `4000`                    | API port                                                       |
| `DATA_DIR`                | `./data`                  | Uploads, extracted backups, SQLite DB                          |
| `CORS_ORIGIN`             | `http://localhost:5173`   | Allowed origin for the web UI                                  |
| `CCLOUD_ENCRYPTION_KEY`   | *(unset)*                  | Encrypts job data at rest (see below). **Strongly recommended.** |

## Credentials at rest

A migration job's stored data includes secrets: the SSH password/key or AWS
keys you gave it for the target, plus the fresh SSH private key and DB/RDS
passwords C-Cloud generates along the way. Set `CCLOUD_ENCRYPTION_KEY` to a
long random value and the API encrypts that job data with AES-256-GCM
before it touches SQLite (per-row random salt+IV via `scrypt`; see
`migration-engine/src/orchestrator/crypto.ts`). Without it, the server logs
a startup warning and stores plain JSON — fine for a local/throwaway run,
not for anything shared or persisted. A job encrypted under one key can't
be read without that same key (the API fails loudly rather than silently
returning garbage).

Separately, the SSH/rsync transport code takes care never to put secret
values (DB passwords, RDS master password) into the job's *log* output
either — commands that embed them are logged with the secret masked out,
even though the real command sent over SSH is unmasked.

## Testing

```bash
npm run test --workspace packages/migration-engine
```

Covers the cPanel backup parser (against a synthetic fixture backup),
the Docker Compose generator, the DNS provider adapters (Cloudflare via a
mocked `fetch`, Route53 via `aws-sdk-client-mock`), AWS provisioning
(Lightsail/EC2/RDS, also via `aws-sdk-client-mock`), the SQLite
encryption-at-rest round trip, and the secret-masking behavior of the SSH
transport layer.

### Integration tests (real SSH/rsync/MySQL, no mocks)

```bash
sudo packages/migration-engine/test/integration/setup.sh   # stands up a local sshd + MariaDB
npm run test:integration --workspace packages/migration-engine
```

These run the actual `ssh`/`rsync`/`scp` transport and the actual `mysql`
client import flow against a real (local, throwaway) SSH server and MySQL
server — not mocks. Writing and running this the first time caught three
real bugs that no mock would have: `scp` silently misinterpreting `-p
<port>` (that flag means something different for `scp` than for `ssh`),
`mkdir -p "$(dirname ...)"` losing its command substitution because it was
wrapped in single instead of double quotes, and a raw `GRANT` statement in
a MySQL dump breaking import on a server where that user doesn't exist
(now stripped before import). See
`packages/migration-engine/test/integration/README.md`. This doesn't cover
the Docker-Compose-on-the-target half of the pipeline (needs a real VM or
a CI runner with working Docker — nested Docker inside this dev sandbox
hit Docker Hub's anonymous pull rate limit).

## Known limitations / next steps

- **Live cloud validation**: the AWS adapter (Lightsail/EC2/RDS
  provisioning) is covered by mocked-SDK unit tests and manual code review,
  not a run against a real AWS account — that needs real AWS credentials,
  which this environment doesn't have. Same for the Docker-Compose-on-target
  half of both adapters, which needs a real VM (see the integration test
  note above). If you can point this at a throwaway AWS account or VPS,
  that's the highest-value next validation step.
- **Email**: mailbox *data* (Maildir) and forwarder *definitions* are
  migrated/preserved, but no mail server (Postfix/Dovecot) is stood up
  automatically — the wizard's final step gives you the copied data's
  location and points you at either a hosted provider (Google Workspace,
  Mailgun, SES) or self-hosting Postfix/Dovecot against that data.
- **EC2+RDS** provisioning targets the account's default VPC with a single
  public subnet — fine for a small/medium site, not a hardened production
  network layout (no private subnets, no Multi-AZ RDS).
- One migration job runs one target deployment; there's no rollback command
  yet if a step fails partway (the job's log tells you exactly which step
  got to, which files copied over stay in place).
- DNS cutover currently supports Cloudflare and Route53; anything else is
  the manual checklist. Adding a provider means implementing
  `DnsProviderAdapter` (`migration-engine/src/dns/types.ts`) and registering
  it in `dns/registry.ts`.
