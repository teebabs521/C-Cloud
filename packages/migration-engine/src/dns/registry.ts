import { DnsProviderAdapter } from "./types.js";
import { cloudflareDnsAdapter } from "./cloudflare.js";
import { route53DnsAdapter } from "./route53.js";

export const dnsAdaptersByKind: Record<string, DnsProviderAdapter> = {
  cloudflare: cloudflareDnsAdapter,
  route53: route53DnsAdapter,
};
