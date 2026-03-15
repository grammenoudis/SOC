# SOC Platform

Multi-tenant AI-powered Security Operations Center. Monitors network traffic in real time, generates alerts using LLM-driven analysis, provides IP reputation enrichment via AbuseIPDB, and supports automated incident response with SSH command execution on network devices.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- An OpenAI API key
- (Optional) An AbuseIPDB API key for IP reputation scoring
- A network device (firewall, router, etc.) configured to send syslog over UDP

### 1. Clone and configure

```bash
git clone https://github.com/grammenoudis/SOC.git
cd SOC
cp .env.example .env
```

Edit `.env` and fill in your API keys:

```env
OPENAI_API_KEY=sk-...
ABUSEIPDB_API_KEY=...          # optional, enables IP reputation badges
LOGGER_WORKSPACE_ID=ws-testing-facility-001
```

The `LOGGER_WORKSPACE_ID` determines which workspace incoming syslog messages are ingested into. The default value matches the seed data.

### 2. Run

```bash
docker compose up --build
```

This starts 4 services:

| Service | Port | Description |
|---------|------|-------------|
| **db** | 5432 | PostgreSQL database |
| **api** | 3001 | NestJS backend API |
| **web** | 3000 | Next.js frontend |
| **logger** | 514/udp | Syslog listener with LLM-powered parsing |

The API container automatically runs database migrations and seeds sample data on first boot.

### 3. Login

Open http://localhost:3000 and sign in:

| Email | Password | Role |
|-------|----------|------|
| admin@lurkas.com | admin123 | Admin |
| alice@lurkas.com | analyst123 | Analyst |
| bob@lurkas.com | analyst123 | Analyst |

### 4. Syslog ingestion

The logger service listens on **UDP port 514** on all interfaces (`0.0.0.0`). To find the IP address of the machine running Docker:

```bash
# Windows
ipconfig

# Linux / macOS
ip addr
```

Then configure your firewall, router, or any network device to send syslog (UDP) to:

```
<your-machine-ip>:514
```

For example, if your machine's IP is `192.168.1.50`, set the syslog destination on your device to `192.168.1.50` port `514` protocol `UDP`.

The logger accepts logs from any vendor (FortiGate, Cisco ASA/IOS, Palo Alto, Check Point, Juniper, Linux, CEF, LEEF, etc.). An LLM parses each batch of raw syslog messages into structured log entries and forwards them to the API for storage and analysis.

Logs appear in the workspace defined by `LOGGER_WORKSPACE_ID` in your `.env` file. To ingest into a different workspace, update the variable and restart the logger.

### 5. Automated response (optional)

Each workspace can optionally have a device configured (SSH host, port, credentials) and a device description (e.g. "FortiGate vSphere VM"). When auto-response is enabled for a workspace:

1. The analysis engine detects threats and creates alerts
2. An LLM generates CLI commands specific to the configured device
3. The logger's SSH poller executes the commands on the device
4. Execution status is shown in the alert detail dialog

Configure device credentials in the workspace settings via the web UI (Device Config card).

## Architecture

```
Network Device ──syslog──> Logger (UDP 514)
                              |
                         LLM parsing
                              |
                              v
                        API (NestJS) <──> PostgreSQL
                         |        |
                    Analysis    Auto-Response
                    (every Xs)  (SSH execution)
                         |
                         v
                    Web UI (Next.js)
```

## Tech Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, recharts, react-simple-maps
- **Backend**: NestJS, TypeScript, Prisma ORM, Socket.IO
- **Database**: PostgreSQL
- **AI**: OpenAI (alert analysis, log parsing, chatbot, auto-response generation)
- **Auth**: Better Auth (email/password)
- **Monorepo**: pnpm workspaces