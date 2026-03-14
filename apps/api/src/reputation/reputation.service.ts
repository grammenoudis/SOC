import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ABUSEIPDB_URL = 'https://api.abuseipdb.com/api/v2/check';

const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isPrivate(ip: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(ip));
}

@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async lookup(ip: string) {
    if (!ip || isPrivate(ip)) return null;

    const apiKey = process.env.ABUSEIPDB_API_KEY;
    if (!apiKey) return null;

    const cached = await this.prisma.ipReputation.findUnique({ where: { ip } });
    if (cached && Date.now() - cached.checkedAt.getTime() < CACHE_TTL_MS) {
      return cached;
    }

    try {
      const url = `${ABUSEIPDB_URL}?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`;
      const res = await fetch(url, {
        headers: { Key: apiKey, Accept: 'application/json' },
      });

      if (!res.ok) {
        this.logger.warn(`AbuseIPDB ${res.status} for ${ip}`);
        return cached ?? null;
      }

      const { data: d } = await res.json();

      return await this.prisma.ipReputation.upsert({
        where: { ip },
        create: {
          ip,
          abuseScore: d.abuseConfidenceScore ?? 0,
          countryCode: d.countryCode || null,
          isp: d.isp || null,
          domain: d.domain || null,
          usageType: d.usageType || null,
          totalReports: d.totalReports ?? 0,
          lastReportedAt: d.lastReportedAt ? new Date(d.lastReportedAt) : null,
          isPublic: d.isPublic ?? true,
          isWhitelisted: d.isWhitelisted ?? false,
          checkedAt: new Date(),
        },
        update: {
          abuseScore: d.abuseConfidenceScore ?? 0,
          countryCode: d.countryCode || null,
          isp: d.isp || null,
          domain: d.domain || null,
          usageType: d.usageType || null,
          totalReports: d.totalReports ?? 0,
          lastReportedAt: d.lastReportedAt ? new Date(d.lastReportedAt) : null,
          isPublic: d.isPublic ?? true,
          isWhitelisted: d.isWhitelisted ?? false,
          checkedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(`Reputation lookup failed for ${ip}: ${err}`);
      return cached ?? null;
    }
  }

  // fire-and-forget: warms cache for a list of IPs (skips already-fresh entries)
  async warmMany(ips: string[]): Promise<void> {
    const apiKey = process.env.ABUSEIPDB_API_KEY;
    if (!apiKey) return;

    const unique = [...new Set(ips.filter((ip) => ip && !isPrivate(ip)))];
    if (unique.length === 0) return;

    const cached = await this.prisma.ipReputation.findMany({
      where: { ip: { in: unique } },
      select: { ip: true, checkedAt: true },
    });
    const freshSet = new Set(
      cached
        .filter((c) => Date.now() - c.checkedAt.getTime() < CACHE_TTL_MS)
        .map((c) => c.ip),
    );

    const stale = unique.filter((ip) => !freshSet.has(ip));
    for (const ip of stale) {
      await this.lookup(ip);
    }
  }

  // returns cached reputation records for a set of IPs (no API calls)
  async getCached(ips: string[]): Promise<Map<string, any>> {
    const unique = [...new Set(ips.filter((ip) => ip && !isPrivate(ip)))];
    if (unique.length === 0) return new Map();

    const records = await this.prisma.ipReputation.findMany({
      where: { ip: { in: unique } },
    });
    return new Map(records.map((r) => [r.ip, r]));
  }
}
