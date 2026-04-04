import Cloudflare from "cloudflare";
import { isEdgeProxyEnabled } from "./ec2Deployer";

const baseDomain = process.env.CLOUDFLARE_DOMAIN || "zeroops.com";

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function getClient(): Cloudflare | null {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return null;
  return new Cloudflare({ apiToken: token });
}

function getZoneId(): string | null {
  return process.env.CLOUDFLARE_ZONE_ID || null;
}

/** Parse EC2-style URL: http://1.2.3.4:3001 */
export function parseDeploymentTargetUrl(targetUrl: string): {
  host: string;
  port: number;
  isIpv4: boolean;
} {
  let raw = targetUrl.trim();
  if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`;
  }
  const u = new URL(raw);
  const host = u.hostname;
  const port = u.port
    ? parseInt(u.port, 10)
    : u.protocol === "https:"
      ? 443
      : 80;
  return { host, port, isIpv4: IPV4_RE.test(host) };
}

/**
 * Public URL we store after DNS is written.
 * - Direct EC2: http://slug.domain:3001 (DNS → IP; browser uses high port).
 * - Edge proxy (nginx :80 + Cloudflare orange): https://slug.domain (Host header picks backend port).
 */
export function formatLiveUrlForSlug(
  slug: string,
  port: number,
  proxied: boolean,
  edgeProxy: boolean = false
): string {
  const host = `${slug}.${baseDomain}`;
  if (edgeProxy) {
    return `https://${host}`;
  }
  if (proxied) {
    return `https://${host}`;
  }
  if (port === 80) return `http://${host}`;
  if (port === 443) return `https://${host}`;
  return `http://${host}:${port}`;
}

async function listRecordsForName(
  cf: Cloudflare,
  zoneId: string,
  fqdn: string
): Promise<Array<{ id: string; type: string }>> {
  const out: Array<{ id: string; type: string }> = [];
  for await (const record of cf.dns.records.list({
    zone_id: zoneId,
    name: { exact: fqdn },
  })) {
    if (record.id && record.type) {
      out.push({ id: record.id, type: record.type });
    }
  }
  return out;
}

async function deleteAllRecordsForName(
  cf: Cloudflare,
  zoneId: string,
  fqdn: string
) {
  const records = await listRecordsForName(cf, zoneId, fqdn);
  for (const r of records) {
    await cf.dns.records.delete(r.id, { zone_id: zoneId });
  }
}

/**
 * Points slug.baseDomain at the deployment target.
 * - IPv4 + port (EC2): creates A record → IP; live URL http(s)://slug.domain:port (port omitted if 80).
 * - Hostname: CNAME → target host; port still appended if not 80/443.
 */
export async function createSubdomain(
  slug: string,
  targetUrl: string
): Promise<string> {
  const cf = getClient();
  const zoneId = getZoneId();
  if (!cf || !zoneId) {
    return targetUrl;
  }

  const parsed = parseDeploymentTargetUrl(targetUrl);
  const fqdn = `${slug}.${baseDomain}`;

  const edge = isEdgeProxyEnabled();
  const wantProxy =
    edge ||
    (process.env.CLOUDFLARE_DNS_PROXIED === "true" &&
      (parsed.port === 80 || parsed.port === 443));
  const proxied = wantProxy;

  await deleteAllRecordsForName(cf, zoneId, fqdn);

  if (parsed.isIpv4) {
    await cf.dns.records.create({
      zone_id: zoneId,
      type: "A",
      name: slug,
      content: parsed.host,
      ttl: 1,
      proxied,
    } as any);
  } else {
    await cf.dns.records.create({
      zone_id: zoneId,
      type: "CNAME",
      name: slug,
      content: parsed.host,
      ttl: 1,
      proxied,
    } as any);
  }

  return formatLiveUrlForSlug(slug, parsed.port, proxied, edge);
}

export async function deleteSubdomain(slug: string) {
  const cf = getClient();
  const zoneId = getZoneId();
  if (!cf || !zoneId) return;

  const fqdn = `${slug}.${baseDomain}`;
  await deleteAllRecordsForName(cf, zoneId, fqdn);
}
