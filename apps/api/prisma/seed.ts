import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { auth } from '../src/auth/auth';

const prisma = new PrismaClient();

const VENDORS = ['paloalto', 'fortinet', 'cisco', 'checkpoint'];
const EVENT_TYPES = ['traffic', 'threat', 'system', 'config'];
const ACTIONS = ['allow', 'deny', 'drop', 'reset'];
const SEVERITIES = ['unknown', 'low', 'medium', 'high', 'critical'];
const APPLICATIONS = ['ssl', 'web-browsing', 'soap', 'dns', 'ssh', 'ftp', 'smtp', 'http', 'ntp', 'snmp'];
const PROTOCOLS = ['tcp', 'udp', 'icmp'];
const POLICIES = ['Allow Tap Traffic', 'Default Deny', 'Internal Allow', 'DMZ Policy', 'Guest Restrict', 'VPN Tunnel'];

const SOURCE_IPS = [
  '192.168.11.150', '192.168.11.151', '10.0.0.55', '10.0.0.102',
  '172.16.1.10', '172.16.1.20', '192.168.1.100', '10.10.10.5',
  '192.168.50.33', '203.0.113.45',
];

const DEST_IPS = [
  '192.168.11.140', '192.168.11.141', '10.0.0.1', '10.0.0.254',
  '172.16.1.1', '8.8.8.8', '1.1.1.1', '192.168.1.1',
  '10.10.10.1', '93.184.216.34',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randPort(): number {
  return Math.floor(Math.random() * 65535) + 1;
}

function generateLogs(workspaceId: string, count: number, baseTime: number) {
  const logs = [];
  for (let i = 0; i < count; i++) {
    const srcIp = pick(SOURCE_IPS);
    const dstIp = pick(DEST_IPS);
    const srcPort = randPort();
    const dstPort = pick([80, 443, 22, 53, 8080, 3389, 5357, 25, 993, randPort()]);
    const vendor = pick(VENDORS);
    const eventType = pick(EVENT_TYPES);
    const actionVal = pick(ACTIONS);
    const severity = pick(SEVERITIES);
    const app = pick(APPLICATIONS);
    const protocol = pick(PROTOCOLS);
    const policy = pick(POLICIES);
    const timestamp = baseTime - Math.floor(Math.random() * 86400 * 3);

    logs.push({
      workspaceId,
      timestamp,
      severity,
      vendor,
      eventType,
      action: actionVal,
      application: app,
      protocol,
      policy,
      sourceIp: srcIp,
      sourcePort: srcPort,
      destinationIp: dstIp,
      destinationPort: dstPort,
      rawLog: `${new Date(timestamp * 1000).toISOString()} ${app.padEnd(16)} ${srcIp}:${srcPort} -> ${dstIp}:${dstPort} ${policy} ${actionVal} ${protocol}`,
    });
  }
  return logs;
}

async function main() {
  console.log('Seeding database...');

  let adminId: string | undefined;
  try {
    const res = await auth.api.signUpEmail({
      body: { name: 'Admin', email: 'admin@lurkas.com', password: 'admin123' },
    });
    if (res?.user) {
      adminId = res.user.id;
      await prisma.user.update({ where: { id: adminId }, data: { role: 'admin' } });
      console.log('Admin user created: admin@lurkas.com / admin123');
    }
  } catch {
    const existing = await prisma.user.findFirst({ where: { email: 'admin@lurkas.com' } });
    adminId = existing?.id;
    console.log('Admin user already exists');
  }

  const companies = [
    { name: 'TechVault Inc.', contact: 'security@techvault.io' },
    { name: 'MedSecure Healthcare', contact: 'it@medsecure.com' },
    { name: 'FinGuard Capital', contact: 'soc@finguard.com' },
  ];

  const createdCompanies = [];
  for (const c of companies) {
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

  const workspaceSpecs = [
    { companyIdx: 0, name: 'Production AWS', description: 'Main production environment on AWS' },
    { companyIdx: 0, name: 'Office Network', description: 'Corporate office LAN and WiFi' },
    { companyIdx: 0, name: 'Dev/Staging', description: 'Development and staging environments' },
    { companyIdx: 1, name: 'Hospital Network', description: 'Main hospital campus network' },
    { companyIdx: 1, name: 'Patient Portal', description: 'Public-facing patient portal infrastructure' },
    { companyIdx: 2, name: 'Trading Floor', description: 'High-frequency trading network' },
    { companyIdx: 2, name: 'Corporate VPN', description: 'Remote access VPN infrastructure' },
  ];

  const createdWorkspaces = [];
  for (const ws of workspaceSpecs) {
    const companyId = createdCompanies[ws.companyIdx].id;
    const existing = await prisma.workspace.findFirst({
      where: { companyId, name: ws.name },
    });
    if (existing) {
      createdWorkspaces.push(existing);
      console.log(`Workspace "${ws.name}" already exists`);
    } else {
      const created = await prisma.workspace.create({
        data: { companyId, name: ws.name, description: ws.description },
      });
      createdWorkspaces.push(created);
      console.log(`Workspace "${ws.name}" created`);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const logCounts = [150, 120, 80, 200, 60, 180, 90]; // per workspace

  for (let i = 0; i < createdWorkspaces.length; i++) {
    const ws = createdWorkspaces[i];
    const existingCount = await prisma.log.count({ where: { workspaceId: ws.id } });
    if (existingCount > 0) {
      console.log(`Workspace "${ws.name}" already has ${existingCount} logs, skipping`);
      continue;
    }

    const logs = generateLogs(ws.id, logCounts[i], now);
    await prisma.log.createMany({ data: logs });
    console.log(`Seeded ${logCounts[i]} logs for "${ws.name}"`);
  }

  // seed analysts
  const analystSpecs = [
    { name: 'Alice Chen', email: 'alice@lurkas.com', password: 'analyst123' },
    { name: 'Bob Martinez', email: 'bob@lurkas.com', password: 'analyst123' },
  ];

  const analystIds: string[] = [];
  for (const a of analystSpecs) {
    const existing = await prisma.user.findFirst({ where: { email: a.email } });
    if (existing) {
      analystIds.push(existing.id);
      console.log(`Analyst "${a.name}" already exists`);
    } else {
      try {
        const res = await auth.api.signUpEmail({
          body: { name: a.name, email: a.email, password: a.password },
        });
        if (res?.user) {
          analystIds.push(res.user.id);
          console.log(`Analyst "${a.name}" created: ${a.email} / ${a.password}`);
        }
      } catch {
        console.log(`Failed to create analyst "${a.name}"`);
      }
    }
  }

  // seed alerts
  const alertCount = await prisma.alert.count();
  if (alertCount === 0) {
    const alertTemplates = [
      { title: 'Brute force SSH attempt detected', description: 'Multiple failed SSH login attempts from 203.0.113.45 targeting port 22 across several hosts. 47 attempts in 5 minutes.', severity: 'critical', sourceIp: '203.0.113.45', destinationIp: '10.0.0.55' },
      { title: 'Suspicious outbound DNS traffic', description: 'Anomalous DNS query volume from 192.168.11.150 to external resolver. Potential DNS tunneling or data exfiltration.', severity: 'high', sourceIp: '192.168.11.150', destinationIp: '8.8.8.8' },
      { title: 'Unauthorized port scan activity', description: 'Sequential port scanning detected from internal host 172.16.1.10 across /24 subnet. 1500+ ports scanned in under 2 minutes.', severity: 'high', sourceIp: '172.16.1.10', destinationIp: '172.16.1.1' },
      { title: 'Malware callback to known C2 server', description: 'Host 192.168.1.100 established connection to known command-and-control IP on port 443. Matches threat intel feed IOC.', severity: 'critical', sourceIp: '192.168.1.100', destinationIp: '93.184.216.34' },
      { title: 'Policy violation: FTP to external host', description: 'FTP data transfer to external IP detected from 10.10.10.5 violating data loss prevention policy.', severity: 'medium', sourceIp: '10.10.10.5', destinationIp: '93.184.216.34' },
      { title: 'Repeated denied connections from guest network', description: 'Host 192.168.50.33 on guest network generating excessive denied connection attempts to internal servers.', severity: 'medium', sourceIp: '192.168.50.33', destinationIp: '10.0.0.1' },
      { title: 'SSL certificate mismatch on internal service', description: 'Internal web service at 10.0.0.254 presenting certificate with mismatched CN. Possible MitM or misconfiguration.', severity: 'low', sourceIp: '192.168.11.151', destinationIp: '10.0.0.254' },
      { title: 'Unusual after-hours VPN access', description: 'VPN login from 203.0.113.45 at 03:24 AM outside normal business hours. User account flagged for review.', severity: 'medium', sourceIp: '203.0.113.45', destinationIp: '10.0.0.1' },
      { title: 'ICMP flood detected', description: 'High volume of ICMP packets from 192.168.11.150 to multiple internal destinations. Potential reconnaissance or DoS attempt.', severity: 'high', sourceIp: '192.168.11.150', destinationIp: '192.168.11.140' },
      { title: 'Deprecated TLS version in use', description: 'Connection using TLS 1.0 detected between 10.0.0.102 and 172.16.1.1. Protocol is deprecated and vulnerable.', severity: 'low', sourceIp: '10.0.0.102', destinationIp: '172.16.1.1' },
      { title: 'Lateral movement attempt via SMB', description: 'Compromised host 192.168.11.151 attempting SMB connections to multiple internal file servers on port 445.', severity: 'critical', sourceIp: '192.168.11.151', destinationIp: '10.0.0.55' },
      { title: 'Excessive failed API authentication', description: 'Patient portal API endpoint receiving 200+ failed auth attempts per minute from 203.0.113.45. Credential stuffing suspected.', severity: 'high', sourceIp: '203.0.113.45', destinationIp: '192.168.11.140' },
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
          logCount: Math.floor(Math.random() * 50) + 5,
        },
      });
    }
    console.log(`Seeded ${alertTemplates.length} alerts`);
  } else {
    console.log(`Alerts already exist (${alertCount}), skipping`);
  }

  console.log('Seeding complete.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
