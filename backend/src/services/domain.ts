import Cloudflare from "cloudflare";

const cf = new Cloudflare({ apiToken: process.env.CLOUDFLARE_API_TOKEN });
const zoneId = process.env.CLOUDFLARE_ZONE_ID!;
const baseDomain = process.env.CLOUDFLARE_DOMAIN || "zeroops.com";

export async function createSubdomain(
  slug: string,
  targetUrl: string
): Promise<string> {
  const subdomain = `${slug}.${baseDomain}`;

  const target = targetUrl
    .replace("https://", "")
    .replace("http://", "")
    .replace(/\/+$/, "");

  const existing = await cf.dns.records.list({
    zone_id: zoneId,
    name: subdomain as any,
    type: "CNAME",
  });

  if (existing.result && existing.result.length > 0) {
    await cf.dns.records.update(existing.result[0].id!, {
      zone_id: zoneId,
      type: "CNAME",
      name: slug,
      content: target,
      proxied: true,
      ttl: 1,
    } as any);
  } else {
    await cf.dns.records.create({
      zone_id: zoneId,
      type: "CNAME",
      name: slug,
      content: target,
      proxied: true,
      ttl: 1,
    } as any);
  }

  return `https://${subdomain}`;
}

export async function deleteSubdomain(slug: string) {
  const subdomain = `${slug}.${baseDomain}`;

  const existing = await cf.dns.records.list({
    zone_id: zoneId,
    name: subdomain as any,
    type: "CNAME",
  });

  if (existing.result && existing.result.length > 0) {
    await cf.dns.records.delete(existing.result[0].id!, {
      zone_id: zoneId,
    } as any);
  }
}
