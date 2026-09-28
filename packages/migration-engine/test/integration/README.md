# Integration tests

`test/*.test.ts` (the default `npm test`) mocks everything external. These
tests don't — they run the real `ssh`/`rsync`/`scp` transport code in
`adapters/dockerVm/{ssh,deploy}.ts` against a real SSH server, and the real
`mysql` client flow in `importDatabasesToExternalMysql` against a real
MySQL/MariaDB server. They're excluded from `npm test` (see
`vitest.config.ts`'s `exclude`) and run separately via `npm run
test:integration`, because they need real local services set up first —
not appropriate to require of every `npm install && npm test`.

They do **not** cover the Docker-Compose-on-the-target half of the
`docker-vm`/`aws` adapters (`provisionDockerStack`, `importDatabasesOverSsh`,
which need a working `docker` + `docker compose` *on the target host*, i.e.
nested Docker if the target is itself a container). That needs a real VM or
a CI runner with real Docker — see the README's "Known limitations" section.

## Setup

Run `setup.sh` (as root, on a disposable box/container — it installs
packages and creates a system user) to stand up:

- A real `sshd` on `127.0.0.1:2200`, with a dedicated `ccloud_test` user and
  a generated keypair.
- A real MariaDB server on `127.0.0.1:3306`, with a `ccloud_master` user
  (standing in for an RDS master user).

```bash
sudo ./test/integration/setup.sh
npm run test:integration --workspace packages/migration-engine
```

The test file reads connection details from environment variables (with
defaults matching what `setup.sh` creates), so you can point it at any
throwaway SSH/MySQL target instead:

| Variable                    | Default                |
|------------------------------|-------------------------|
| `CCLOUD_IT_SSH_HOST`          | `127.0.0.1`            |
| `CCLOUD_IT_SSH_PORT`          | `2200`                 |
| `CCLOUD_IT_SSH_USER`          | `ccloud_test`          |
| `CCLOUD_IT_SSH_KEY_PATH`      | `/tmp/ccloud_test_key` |
| `CCLOUD_IT_MYSQL_HOST`        | `127.0.0.1`            |
| `CCLOUD_IT_MYSQL_PORT`        | `3306`                 |
| `CCLOUD_IT_MYSQL_USER`        | `ccloud_master`        |
| `CCLOUD_IT_MYSQL_PASSWORD`    | `master-pw-for-test`   |

If `CCLOUD_IT_SSH_HOST` isn't reachable on `CCLOUD_IT_SSH_PORT`, the suite
skips itself (logging why) instead of failing — so it's safe to leave
wired into a script that might run somewhere without the target set up.
