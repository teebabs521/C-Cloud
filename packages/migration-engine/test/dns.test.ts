import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ChangeResourceRecordSetsCommand, Route53Client } from "@aws-sdk/client-route-53";
import { cloudflareDnsAdapter } from "../src/dns/cloudflare.js";
import { route53DnsAdapter } from "../src/dns/route53.js";
import { DnsInstruction } from "../src/dns/types.js";

const instructions: DnsInstruction[] = [
  { domain: "example.com", recordType: "A", name: "@", value: "203.0.113.10", note: "" },
  { domain: "example.com", recordType: "A", name: "www", value: "203.0.113.10", note: "" },
];

describe("cloudflareDnsAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a record when none exists, and updates when one does", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === undefined || init.method === "GET") {
        // Apex lookup returns nothing; www lookup returns an existing record.
        const found = url.includes("name=www.example.com");
        return {
          ok: true,
          json: async () => ({ success: true, errors: [], result: found ? [{ id: "rec_www" }] : [] }),
        };
      }
      return { ok: true, json: async () => ({ success: true, errors: [], result: {} }) };
    });

    const log = vi.fn();
    await cloudflareDnsAdapter.applyRecords({ kind: "cloudflare", apiToken: "tok", zoneId: "zone1" }, instructions, log);

    const methods = fetchMock.mock.calls.map((call) => call[1]?.method ?? "GET");
    expect(methods).toContain("POST"); // create for @
    expect(methods).toContain("PUT"); // update for www
  });

  it("throws with the Cloudflare error message on API failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({ success: false, errors: [{ message: "invalid zone" }] }),
    });

    await expect(
      cloudflareDnsAdapter.applyRecords({ kind: "cloudflare", apiToken: "tok", zoneId: "bad" }, instructions, vi.fn())
    ).rejects.toThrow(/invalid zone/);
  });
});

describe("route53DnsAdapter", () => {
  it("submits one UPSERT change batch for all instructions", async () => {
    const r53Mock = mockClient(Route53Client);
    r53Mock.on(ChangeResourceRecordSetsCommand).resolves({ ChangeInfo: { Id: "id", Status: "PENDING", SubmittedAt: new Date() } });

    const log = vi.fn();
    await route53DnsAdapter.applyRecords(
      { kind: "route53", region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "secret", hostedZoneId: "Z123" },
      instructions,
      log
    );

    const calls = r53Mock.commandCalls(ChangeResourceRecordSetsCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.HostedZoneId).toBe("Z123");
    expect(calls[0].args[0].input.ChangeBatch?.Changes).toHaveLength(2);
    expect(calls[0].args[0].input.ChangeBatch?.Changes?.[0].ResourceRecordSet?.Name).toBe("example.com.");

    r53Mock.restore();
  });
});
