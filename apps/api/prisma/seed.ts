import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { auth } from '../src/auth/auth';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Static pools
// ---------------------------------------------------------------------------

const VENDORS = ['paloalto', 'fortinet', 'cisco', 'checkpoint'];
const EVENT_TYPES = ['traffic', 'threat', 'system', 'config'];
const APPLICATIONS = ['ssl', 'web-browsing', 'ssh', 'dns', 'ftp', 'smtp', 'http', 'rdp', 'smb', 'ntp'];
const PROTOCOLS = ['tcp', 'udp', 'icmp'];
const POLICIES = ['Allow Tap Traffic', 'Default Deny', 'Internal Allow', 'DMZ Policy', 'Guest Restrict', 'VPN Tunnel'];

// Internal IPs — no country enrichment, no AbuseIPDB lookup
const INTERNAL_IPS = [
  '192.168.11.150', '192.168.11.151', '10.0.0.55', '10.0.0.102',
  '172.16.1.10', '172.16.1.20', '192.168.1.100', '10.10.10.5',
  '192.168.50.33',
];

// Weighted scenarios: each produces `weight` log entries.
// Public source IPs drive AbuseIPDB lookups + IpBadge scores.
// srcCountry / dstCountry (Natural Earth names) drive the Log Map heatmap.
const SCENARIOS: {
  srcCountry: string; srcIp: string;
  dstCountry: string; dstIp: string;
  severity: string; action: string; eventType: string;
  weight: number;
}[] = [
  // ── Heavy attackers ──────────────────────────────────────────────────────
  { srcCountry: 'China',         srcIp: '114.119.4.22',   dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'critical', action: 'deny',  eventType: 'threat',  weight: 18 },
  { srcCountry: 'Russia',        srcIp: '185.220.101.45', dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'critical', action: 'deny',  eventType: 'threat',  weight: 14 },
  { srcCountry: 'Iran',          srcIp: '5.61.27.100',    dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'high',     action: 'deny',  eventType: 'threat',  weight: 10 },
  { srcCountry: 'North Korea',   srcIp: '175.45.178.10',  dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'critical', action: 'drop',  eventType: 'threat',  weight: 8  },
  { srcCountry: 'Romania',       srcIp: '89.43.104.50',   dstCountry: 'Germany',                  dstIp: '80.187.1.20',  severity: 'high',     action: 'deny',  eventType: 'threat',  weight: 9  },
  { srcCountry: 'Ukraine',       srcIp: '91.210.107.33',  dstCountry: 'Germany',                  dstIp: '80.187.1.20',  severity: 'high',     action: 'deny',  eventType: 'threat',  weight: 7  },
  { srcCountry: 'Pakistan',      srcIp: '39.40.55.200',   dstCountry: 'United Kingdom',           dstIp: '51.140.1.20',  severity: 'high',     action: 'deny',  eventType: 'threat',  weight: 6  },
  // ── Moderate / suspicious ────────────────────────────────────────────────
  { srcCountry: 'Brazil',        srcIp: '177.67.55.10',   dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'medium',   action: 'deny',  eventType: 'traffic', weight: 7  },
  { srcCountry: 'Turkey',        srcIp: '195.142.5.100',  dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'medium',   action: 'deny',  eventType: 'traffic', weight: 5  },
  { srcCountry: 'Indonesia',     srcIp: '114.4.55.200',   dstCountry: 'Australia',                dstIp: '101.0.1.20',   severity: 'medium',   action: 'deny',  eventType: 'traffic', weight: 4  },
  { srcCountry: 'Netherlands',   srcIp: '185.107.80.10',  dstCountry: 'France',                   dstIp: '213.228.1.20', severity: 'medium',   action: 'deny',  eventType: 'traffic', weight: 5  },
  { srcCountry: 'India',         srcIp: '103.21.58.200',  dstCountry: 'United Kingdom',           dstIp: '51.140.1.20',  severity: 'medium',   action: 'allow', eventType: 'traffic', weight: 6  },
  { srcCountry: 'South Korea',   srcIp: '211.43.64.200',  dstCountry: 'Japan',                    dstIp: '203.0.1.10',   severity: 'low',      action: 'allow', eventType: 'traffic', weight: 5  },
  // ── Benign / allow ───────────────────────────────────────────────────────
  { srcCountry: 'United Kingdom', srcIp: '51.140.5.200',  dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'low',      action: 'allow', eventType: 'traffic', weight: 8  },
  { srcCountry: 'Germany',       srcIp: '80.187.5.200',   dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'low',      action: 'allow', eventType: 'traffic', weight: 7  },
  { srcCountry: 'France',        srcIp: '213.228.5.200',  dstCountry: 'United Kingdom',           dstIp: '51.140.1.20',  severity: 'low',      action: 'allow', eventType: 'traffic', weight: 5  },
  { srcCountry: 'Australia',     srcIp: '101.0.5.200',    dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'low',      action: 'allow', eventType: 'traffic', weight: 4  },
  { srcCountry: 'Canada',        srcIp: '142.250.5.200',  dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'low',      action: 'allow', eventType: 'traffic', weight: 4  },
  { srcCountry: 'Japan',         srcIp: '203.0.5.200',    dstCountry: 'United States of America', dstIp: '52.10.1.5',    severity: 'low',      action: 'allow', eventType: 'traffic', weight: 4  },
  { srcCountry: 'Sweden',        srcIp: '193.10.5.200',   dstCountry: 'Germany',                  dstIp: '80.187.1.20',  severity: 'low',      action: 'allow', eventType: 'traffic', weight: 3  },
];

// Pre-seeded AbuseIPDB reputation data for public IPs used above.
// These make IpBadge show scores without needing a live API call.
const IP_REPUTATIONS = [
  { ip: '185.220.101.45', abuseScore: 100, countryCode: 'RU', isp: 'Quintex Alliance Consulting', domain: 'torservers.net',  usageType: 'Tor Exit Node',                 totalReports: 8921, lastReportedAt: new Date('2026-03-13') },
  { ip: '114.119.4.22',   abuseScore: 85,  countryCode: 'CN', isp: 'CHINANET-BACKBONE',            domain: 'chinatelecom.cn', usageType: 'Data Center/Web Hosting/Transit', totalReports: 1247, lastReportedAt: new Date('2026-03-12') },
  { ip: '5.61.27.100',    abuseScore: 74,  countryCode: 'IR', isp: 'Pars Online PJS',              domain: 'parsonline.net',  usageType: 'Fixed Line ISP',                 totalReports: 392,  lastReportedAt: new Date('2026-03-10') },
  { ip: '175.45.178.10',  abuseScore: 92,  countryCode: 'KP', isp: 'Korea Posts and Telecommunications', domain: null,       usageType: 'Government',                    totalReports: 204,  lastReportedAt: new Date('2026-03-11') },
  { ip: '89.43.104.50',   abuseScore: 68,  countryCode: 'RO', isp: 'ROMTELECOM',                   domain: 'rcs-rds.ro',      usageType: 'Fixed Line ISP',                 totalReports: 519,  lastReportedAt: new Date('2026-03-13') },
  { ip: '91.210.107.33',  abuseScore: 81,  countryCode: 'UA', isp: 'ITL LLC',                      domain: 'itldc.com',       usageType: 'Data Center/Web Hosting/Transit', totalReports: 734,  lastReportedAt: new Date('2026-03-12') },
  { ip: '39.40.55.200',   abuseScore: 55,  countryCode: 'PK', isp: 'Pakistan Telecom',             domain: 'ptcl.net.pk',     usageType: 'Fixed Line ISP',                 totalReports: 187,  lastReportedAt: new Date('2026-03-09') },
  { ip: '177.67.55.10',   abuseScore: 43,  countryCode: 'BR', isp: 'Claro S.A.',                   domain: 'claro.com.br',    usageType: 'Fixed Line ISP',                 totalReports: 98,   lastReportedAt: new Date('2026-03-08') },
  { ip: '195.142.5.100',  abuseScore: 38,  countryCode: 'TR', isp: 'Turk Telekom',                 domain: 'turktelekom.com.tr', usageType: 'Fixed Line ISP',              totalReports: 67,   lastReportedAt: new Date('2026-03-07') },
  { ip: '185.107.80.10',  abuseScore: 29,  countryCode: 'NL', isp: 'Leaseweb Netherlands',         domain: 'leaseweb.com',    usageType: 'Data Center/Web Hosting/Transit', totalReports: 41,   lastReportedAt: new Date('2026-03-11') },
  { ip: '114.4.55.200',   abuseScore: 22,  countryCode: 'ID', isp: 'PT Telkom Indonesia',          domain: 'telkom.net.id',   usageType: 'Fixed Line ISP',                 totalReports: 28,   lastReportedAt: new Date('2026-03-06') },
  { ip: '103.21.58.200',  abuseScore: 14,  countryCode: 'IN', isp: 'Cloudflare',                   domain: 'cloudflare.com',  usageType: 'Content Delivery Network',        totalReports: 5,    lastReportedAt: new Date('2026-03-01') },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randPort(): number {
  return Math.floor(Math.random() * 65535) + 1;
}

// Expand weighted scenarios into a flat list, then shuffle
function buildScenarioPool() {
  const pool: (typeof SCENARIOS[number])[] = [];
  for (const s of SCENARIOS) {
    for (let i = 0; i < s.weight; i++) pool.push(s);
  }
  // Fisher-Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function generateLogs(workspaceId: string, count: number, baseTime: number) {
  const pool = buildScenarioPool();
  const logs = [];

  for (let i = 0; i < count; i++) {
    // Mix: ~60% scenario (public/country) logs, ~40% internal-only traffic
    const useScenario = Math.random() < 0.6;
    const scenario = pool[i % pool.length];

    const srcIp = useScenario ? scenario.srcIp : pick(INTERNAL_IPS);
    const dstIp = useScenario ? scenario.dstIp : pick(['10.0.0.1', '10.0.0.254', '172.16.1.1', '192.168.11.140', '192.168.1.1']);
    const srcCountry = useScenario ? scenario.srcCountry : null;
    const dstCountry = useScenario ? scenario.dstCountry : null;
    const severity   = useScenario ? scenario.severity   : pick(['unknown', 'low', 'medium']);
    const action     = useScenario ? scenario.action     : pick(['allow', 'allow', 'allow', 'deny']);
    const eventType  = useScenario ? scenario.eventType  : pick(EVENT_TYPES);

    const srcPort = randPort();
    const dstPort = pick([22, 80, 443, 445, 3389, 53, 21, 25, 8080, 993]);
    const vendor   = pick(VENDORS);
    const app      = pick(APPLICATIONS);
    const protocol = pick(PROTOCOLS);
    const policy   = pick(POLICIES);
    // spread over last 7 days for full chart coverage
    const timestamp = baseTime - Math.floor(Math.random() * 86400 * 7);

    logs.push({
      workspaceId,
      timestamp,
      severity,
      vendor,
      eventType,
      action,
      application: app,
      protocol,
      policy,
      sourceIp: srcIp,
      sourcePort: srcPort,
      destinationIp: dstIp,
      destinationPort: dstPort,
      srcCountry,
      dstCountry,
      rawLog: `${new Date(timestamp * 1000).toISOString()} ${vendor} ${app.padEnd(16)} ${srcIp}:${srcPort} -> ${dstIp}:${dstPort} [${policy}] ${action.toUpperCase()} ${protocol}`,
    });
  }
  return logs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding database...');

  // ── Users ─────────────────────────────────────────────────────────────────
  let adminId: string | undefined;
  try {
    const res = await auth.api.signUpEmail({
      body: { name: 'Admin', email: 'admin@lurkas.com', password: 'admin123' },
    });
    if (res?.user) {
      adminId = res.user.id;
      await prisma.user.update({ where: { id: adminId }, data: { role: 'admin' } });
      console.log('Admin created: admin@lurkas.com / admin123');
    }
  } catch {
    const existing = await prisma.user.findFirst({ where: { email: 'admin@lurkas.com' } });
    adminId = existing?.id;
    console.log('Admin already exists');
  }

  const analystSpecs = [
    { name: 'Alice Chen',    email: 'alice@lurkas.com', password: 'analyst123' },
    { name: 'Bob Martinez',  email: 'bob@lurkas.com',   password: 'analyst123' },
  ];
  const analystIds: string[] = [];
  for (const a of analystSpecs) {
    const existing = await prisma.user.findFirst({ where: { email: a.email } });
    if (existing) {
      analystIds.push(existing.id);
      console.log(`Analyst "${a.name}" already exists`);
    } else {
      try {
        const res = await auth.api.signUpEmail({ body: a });
        if (res?.user) {
          analystIds.push(res.user.id);
          console.log(`Analyst "${a.name}" created: ${a.email} / ${a.password}`);
        }
      } catch {
        console.log(`Failed to create analyst "${a.name}"`);
      }
    }
  }

  // ── Companies ─────────────────────────────────────────────────────────────
  const companySpecs = [
    { name: 'TechVault Inc.',       contact: 'security@techvault.io' },
    { name: 'MedSecure Healthcare', contact: 'it@medsecure.com'      },
    { name: 'FinGuard Capital',     contact: 'soc@finguard.com'      },
  ];
  const createdCompanies = [];
  for (const c of companySpecs) {
    const existing = await prisma.company.findFirst({ where: { name: c.name } });
    if (existing) {
      createdCompanies.push(existing);
      console.log(`Company "${c.name}" already exists`);
    } else {
      const created = await prisma.company.create({ data: c });
      createdCompanies.push(created);
      console.log(`Company "${c.name}" created`);
    }
  }

  // ── Workspaces ────────────────────────────────────────────────────────────
  // LOGGER_DEFAULT_WORKSPACE_ID is pinned so docker-compose logger can target it
  // on every fresh install without needing manual configuration.
  const LOGGER_DEFAULT_WORKSPACE_ID = 'ws-techvault-prod-aws-001';

  const workspaceSpecs = [
    { id: LOGGER_DEFAULT_WORKSPACE_ID, companyIdx: 0, name: 'Production AWS',  description: 'Main production environment on AWS',         autoResponseEnabled: true  },
    { id: undefined,                   companyIdx: 0, name: 'Office Network',   description: 'Corporate office LAN and WiFi',              autoResponseEnabled: false },
    { id: undefined,                   companyIdx: 0, name: 'Dev/Staging',      description: 'Development and staging environments',       autoResponseEnabled: false },
    { id: undefined,                   companyIdx: 1, name: 'Hospital Network', description: 'Main hospital campus network',               autoResponseEnabled: true  },
    { id: undefined,                   companyIdx: 1, name: 'Patient Portal',   description: 'Public-facing patient portal infrastructure',autoResponseEnabled: false },
    { id: undefined,                   companyIdx: 2, name: 'Trading Floor',    description: 'High-frequency trading network',             autoResponseEnabled: true  },
    { id: undefined,                   companyIdx: 2, name: 'Corporate VPN',    description: 'Remote access VPN infrastructure',           autoResponseEnabled: false },
  ];
  const createdWorkspaces = [];
  for (const ws of workspaceSpecs) {
    const companyId = createdCompanies[ws.companyIdx].id;
    const existing = await prisma.workspace.findFirst({ where: { companyId, name: ws.name } });
    if (existing) {
      createdWorkspaces.push(existing);
      console.log(`Workspace "${ws.name}" already exists`);
    } else {
      const created = await prisma.workspace.create({
        data: { ...(ws.id ? { id: ws.id } : {}), companyId, name: ws.name, description: ws.description, autoResponseEnabled: ws.autoResponseEnabled },
      });
      createdWorkspaces.push(created);
      console.log(`Workspace "${ws.name}" created`);
    }
  }

  // ── Logs ──────────────────────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const logCounts = [180, 130, 90, 220, 70, 200, 100];

  for (let i = 0; i < createdWorkspaces.length; i++) {
    const ws = createdWorkspaces[i];
    const existingCount = await prisma.log.count({ where: { workspaceId: ws.id } });
    if (existingCount > 0) {
      console.log(`"${ws.name}" already has ${existingCount} logs, skipping`);
      continue;
    }
    const logs = generateLogs(ws.id, logCounts[i], now);
    await prisma.log.createMany({ data: logs });
    console.log(`Seeded ${logCounts[i]} logs for "${ws.name}"`);
  }

  // ── IP Reputation cache ───────────────────────────────────────────────────
  // Pre-populate so IpBadge scores show without a live AbuseIPDB call.
  const repCount = await prisma.ipReputation.count();
  if (repCount === 0) {
    await prisma.ipReputation.createMany({ data: IP_REPUTATIONS });
    console.log(`Seeded ${IP_REPUTATIONS.length} IP reputation records`);
  } else {
    console.log(`IP reputation already seeded (${repCount} records), skipping`);
  }

  // ── Alerts ────────────────────────────────────────────────────────────────
  const alertCount = await prisma.alert.count();
  if (alertCount === 0) {
    const alertTemplates = [
      { title: 'Brute force SSH from Tor exit node',              description: '185.220.101.45 (Tor/Russia, AbuseIPDB score 100) performed 247 SSH login attempts against Production AWS hosts in under 8 minutes. Credential stuffing pattern confirmed.', severity: 'critical', sourceIp: '185.220.101.45', destinationIp: '52.10.1.5'    },
      { title: 'PRC-attributed scanning activity',                description: 'CHINANET IP 114.119.4.22 (score 85) conducting systematic port scans across the /24 perimeter. 4,500+ probe packets captured. Matches APT41 reconnaissance TTPs.', severity: 'critical', sourceIp: '114.119.4.22',   destinationIp: '52.10.1.5'    },
      { title: 'Lateral movement attempt via SMB',                description: 'Internal host 192.168.11.151 attempting SMB connections to multiple file servers on port 445. Possible compromised endpoint moving laterally.', severity: 'critical', sourceIp: '192.168.11.151', destinationIp: '10.0.0.55'   },
      { title: 'Malware C2 callback detected',                    description: 'Host 192.168.1.100 established a persistent connection to 91.210.107.33 (Ukraine, score 81) on port 443. Beacon interval matches Cobalt Strike default profile.', severity: 'critical', sourceIp: '91.210.107.33',  destinationIp: '52.10.1.5'    },
      { title: 'North Korean IP targeting trading infrastructure', description: '175.45.178.10 (DPRK, score 92) probing Trading Floor endpoints on ports 443 and 8443. Activity attributed to Lazarus Group based on IOC match.', severity: 'high',     sourceIp: '175.45.178.10',  destinationIp: '52.10.1.5'    },
      { title: 'Suspicious outbound DNS — possible tunneling',    description: 'Anomalous DNS query volume from 192.168.11.150 to 8.8.8.8. Query names contain base64-encoded payloads. Potential data exfiltration via DNS tunneling.', severity: 'high',     sourceIp: '192.168.11.150', destinationIp: '8.8.8.8'      },
      { title: 'After-hours VPN access from high-risk IP',        description: 'Successful VPN authentication from 89.43.104.50 (Romania, score 68) at 03:17 AM. No travel notice on file for associated user account. Session lasted 2h 41m.', severity: 'high',     sourceIp: '89.43.104.50',   destinationIp: '10.0.0.1'     },
      { title: 'Iranian IP probing patient portal API',            description: '5.61.27.100 (Iran, score 74) sending malformed authentication requests to the Patient Portal API endpoint. 200+ attempts in 3 minutes — credential stuffing suspected.', severity: 'high',     sourceIp: '5.61.27.100',    destinationIp: '51.140.1.20'  },
      { title: 'FTP data transfer to external host',               description: 'Host 10.10.10.5 transferred 340 MB via FTP to 177.67.55.10 (Brazil) outside approved transfer windows. Violates DLP policy P-117.', severity: 'medium',   sourceIp: '10.10.10.5',     destinationIp: '177.67.55.10' },
      { title: 'Excessive denied connections from guest VLAN',     description: 'Host 192.168.50.33 on guest network generating high volume of denied connection attempts to internal VLAN 10 servers. Possible rogue device.', severity: 'medium',   sourceIp: '192.168.50.33',  destinationIp: '10.0.0.1'     },
      { title: 'Deprecated TLS 1.0 connection detected',          description: 'TLS 1.0 handshake observed between 10.0.0.102 and 172.16.1.1. Protocol is deprecated (RFC 8996) and exposes session to BEAST/POODLE attacks.', severity: 'low',      sourceIp: '10.0.0.102',     destinationIp: '172.16.1.1'   },
      { title: 'SSL certificate CN mismatch on internal service',  description: 'Internal service at 10.0.0.254 presenting certificate with CN=*.example.com. Possible misconfiguration or MitM insertion point.', severity: 'low',      sourceIp: '192.168.11.151', destinationIp: '10.0.0.254'   },
    ];

    const allUsers = adminId ? [adminId, ...analystIds] : analystIds;
    const statuses = ['open', 'open', 'open', 'acknowledged', 'acknowledged', 'investigating', 'resolved'];

    for (let i = 0; i < alertTemplates.length; i++) {
      const t = alertTemplates[i];
      const ws = createdWorkspaces[i % createdWorkspaces.length];
      const status = statuses[i % statuses.length];
      const assigneeId = status !== 'open' && allUsers.length > 0
        ? allUsers[i % allUsers.length]
        : null;
      await prisma.alert.create({
        data: {
          workspaceId: ws.id,
          title: t.title,
          description: t.description,
          severity: t.severity,
          status,
          assigneeId,
          sourceIp: t.sourceIp,
          destinationIp: t.destinationIp,
          logCount: Math.floor(Math.random() * 80) + 10,
        },
      });
    }
    console.log(`Seeded ${alertTemplates.length} alerts`);
  } else {
    console.log(`Alerts already exist (${alertCount}), skipping`);
  }

  // ── Analysis Rules ────────────────────────────────────────────────────────
  const ruleCount = await prisma.analysisRule.count();
  if (ruleCount === 0 && adminId) {
    const rules = [
      {
        title: 'Brute Force Detection',
        content: 'Generate a HIGH alert when more than 20 denied connections originate from the same source IP within a 5-minute window, especially targeting ports 22 (SSH), 3389 (RDP), or 443.',
        category: 'threat',
      },
      {
        title: 'High-Risk Country Block',
        content: 'Generate a CRITICAL alert for any traffic originating from IP addresses geolocated to sanctioned or high-risk countries (North Korea, Iran) that is not explicitly allowed by a named policy.',
        category: 'threat',
      },
      {
        title: 'DNS Tunneling Suspicion',
        content: 'Generate a HIGH alert when a single internal host sends more than 500 DNS queries in one hour, particularly if query names are long (>40 chars) or contain base64-like substrings.',
        category: 'network',
      },
      {
        title: 'Lateral Movement via SMB',
        content: 'Generate a CRITICAL alert when an internal host makes SMB (port 445) connection attempts to more than 5 distinct internal destinations within 10 minutes.',
        category: 'threat',
      },
      {
        title: 'After-Hours External Access',
        content: 'Generate a MEDIUM alert for any successful inbound connection from an external IP occurring between 22:00 and 06:00 local time that is not from a known VPN gateway or monitoring system.',
        category: 'compliance',
      },
      {
        title: 'Large Outbound Transfer',
        content: 'Generate a HIGH alert when cumulative outbound traffic from a single internal host exceeds 100 MB to an external IP within a 1-hour window, especially via FTP, HTTP, or unencrypted protocols.',
        category: 'compliance',
      },
      {
        title: 'Known Bad IP Indicator',
        content: 'Generate a CRITICAL alert for any traffic to or from an IP with an AbuseIPDB score above 80 or that appears on a major threat intelligence feed blocklist.',
        category: 'threat',
      },
      {
        title: 'Port Scan Detection',
        content: 'Generate a HIGH alert when a single source IP contacts more than 50 distinct destination ports within a 2-minute window across any combination of internal hosts.',
        category: 'network',
      },
    ];
    for (const r of rules) {
      await prisma.analysisRule.create({ data: { ...r, createdById: adminId } });
    }
    console.log(`Seeded ${rules.length} analysis rules`);
  } else {
    console.log(`Analysis rules already exist (${ruleCount}), skipping`);
  }

  console.log('Seeding complete.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
