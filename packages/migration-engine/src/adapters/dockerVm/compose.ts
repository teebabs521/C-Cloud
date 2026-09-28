import { CpanelDomain, CpanelPhpConfig } from "../../parser/types.js";

export interface ComposeOptions {
  domains: CpanelDomain[];
  phpConfigs: CpanelPhpConfig[];
  /** Omit to skip the local MySQL container (e.g. when using AWS RDS instead). */
  mysqlRootPassword?: string;
  defaultPhpVersion?: string;
}

/** Maps a cPanel-reported PHP version like "ea-php81" or "8.1" to a php-fpm docker tag. */
export function normalizePhpTag(version: string | null | undefined, fallback = "8.2"): string {
  if (!version) return fallback;
  const match = version.match(/(\d)\.?(\d+)/);
  if (!match) return fallback;
  return `${match[1]}.${match[2]}`;
}

/**
 * Generates a docker-compose.yml that serves each migrated domain from its
 * own php-fpm + nginx pair (so per-domain PHP versions from cPanel are
 * preserved) plus a shared MySQL container seeded from the cPanel dumps.
 */
export function generateDockerCompose(opts: ComposeOptions): string {
  const services: string[] = [];

  for (const domain of opts.domains) {
    const service = domain.domain.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const phpConfig = opts.phpConfigs.find((c) => c.domain === domain.domain);
    const phpTag = normalizePhpTag(phpConfig?.phpVersion, opts.defaultPhpVersion ?? "8.2");
    services.push(
      [
        `  php_${service}:`,
        `    image: php:${phpTag}-fpm`,
        `    volumes:`,
        `      - ./sites/${domain.domain}/public_html:/var/www/html`,
        `    restart: unless-stopped`,
        ``,
        `  web_${service}:`,
        `    image: nginx:stable`,
        `    depends_on:`,
        `      - php_${service}`,
        `    volumes:`,
        `      - ./sites/${domain.domain}/public_html:/var/www/html`,
        `      - ./nginx/${domain.domain}.conf:/etc/nginx/conf.d/default.conf:ro`,
        `    ports:`,
        `      - "80:80"`,
        `    restart: unless-stopped`,
      ].join("\n")
    );
  }

  const mysqlService = opts.mysqlRootPassword
    ? [
        "",
        "  mysql:",
        "    image: mysql:8.0",
        "    environment:",
        `      MYSQL_ROOT_PASSWORD: "${opts.mysqlRootPassword}"`,
        "    volumes:",
        "      - mysql_data:/var/lib/mysql",
        "    restart: unless-stopped",
      ].join("\n")
    : "";

  const volumesBlock = opts.mysqlRootPassword ? ["volumes:", "  mysql_data:", ""].join("\n") : "";

  return ["version: \"3.9\"", "services:", services.join("\n\n"), mysqlService, "", volumesBlock].join("\n");
}

export function generateNginxConf(domain: string, phpServiceName: string): string {
  return [
    `server {`,
    `    listen 80;`,
    `    server_name ${domain};`,
    `    root /var/www/html;`,
    `    index index.php index.html;`,
    ``,
    `    location / {`,
    `        try_files $uri $uri/ /index.php?$args;`,
    `    }`,
    ``,
    `    location ~ \\.php$ {`,
    `        fastcgi_pass ${phpServiceName}:9000;`,
    `        fastcgi_index index.php;`,
    `        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;`,
    `        include fastcgi_params;`,
    `    }`,
    `}`,
    ``,
  ].join("\n");
}
