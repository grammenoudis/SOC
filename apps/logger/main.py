#!/usr/bin/env python3
"""
SOC Syslog Listener — Multi-Vendor Log Collector

Receives syslog from network devices (FortiGate, Cisco, Palo Alto, Check Point,
Juniper, etc.), buffers raw messages, and periodically sends them to an LLM for
vendor-agnostic structured parsing before forwarding to the SOC platform's
ingest API.

Trigger conditions (whichever fires first):
  - Buffer reaches --batch-size logs (default: 10)
  - --flush-interval seconds have elapsed (default: 30)

Burst protection: a bounded queue (--max-pending, default: 5) decouples
buffering from the single LLM worker thread. If the queue is full, the
batch is dropped — no threads block.

USAGE:
    # Listen only (no ingestion):
        python main.py --port 514

    # Listen and ingest (LLM parsing):
        python main.py --port 514 --workspace-id <CUID> --api-url http://localhost:3001 --openai-key sk-...

    # With raw output and file logging:
        python main.py --port 514 --workspace-id <ID> --openai-key sk-... --raw --output logs.txt
"""

import argparse
import datetime
import json
import queue
import re
import signal
import socketserver
import sys
import threading
import time
import urllib.request
import urllib.error
from collections import defaultdict

try:
    import paramiko
    HAS_PARAMIKO = True
except ImportError:
    HAS_PARAMIKO = False

COLORS = {
    "emergency": "\033[91;1m",
    "alert":     "\033[91m",
    "critical":  "\033[31;1m",
    "error":     "\033[31m",
    "warning":   "\033[33m",
    "notice":    "\033[36m",
    "info":      "\033[32m",
    "debug":     "\033[90m",
    "traffic":   "\033[34m",
    "event":     "\033[35m",
    "utm":       "\033[33;1m",
    "reset":     "\033[0m",
    "timestamp": "\033[90m",
    "header":    "\033[1;37m",
    "success":   "\033[32;1m",
}

stats = defaultdict(int)


def _guess_color(raw_message: str) -> str:
    """Pick a color based on severity keywords in the raw message."""
    lower = raw_message.lower()
    for kw in ("emergency", "critical", "crit"):
        if kw in lower:
            return COLORS["critical"]
    if "error" in lower or "err " in lower:
        return COLORS["error"]
    if "warning" in lower or "warn" in lower:
        return COLORS["warning"]
    if "traffic" in lower:
        return COLORS["traffic"]
    if "threat" in lower or "utm" in lower:
        return COLORS["utm"]
    if "event" in lower:
        return COLORS["event"]
    return COLORS["info"]


def format_log(raw_message: str, use_color: bool = True) -> str:
    """Display the raw syslog line with a timestamp and severity color."""
    reset = COLORS["reset"] if use_color else ""
    ts_color = COLORS["timestamp"] if use_color else ""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    color = _guess_color(raw_message) if use_color else ""

    stats["total"] += 1

    # truncate very long lines for console readability
    display = raw_message if len(raw_message) <= 300 else raw_message[:297] + "..."
    return f"{ts_color}[{now}]{reset} {color}{display}{reset}"


# LLM system prompt — vendor-agnostic syslog parser
_LLM_SYSTEM_PROMPT = """\
You are a multi-vendor syslog parser. Given raw syslog messages from ANY network device \
(FortiGate, Cisco ASA/IOS, Palo Alto, Check Point, Juniper, Sophos, pfSense, Linux, \
or any other vendor), extract structured fields and return a JSON object with a "logs" \
array — one entry per input message.

Auto-detect the vendor from the log format and field names. Common formats:
- FortiGate: key=value pairs (type=, subtype=, level=, srcip=, dstip=, action=, etc.)
- Cisco ASA: %ASA-severity-code: message (with IP/port patterns in the message body)
- Cisco IOS: %FACILITY-severity-MNEMONIC: message
- Palo Alto: comma-separated fields (TRAFFIC/THREAT/SYSTEM, src, dst, sport, dport, etc.)
- Check Point: key=value or CEF format (src=, dst=, act=, etc.)
- CEF: CEF:0|vendor|product|version|id|name|severity|key=value pairs
- LEEF: LEEF:version|vendor|product|version|event|key=value pairs
- Linux/syslog: standard syslog with facility.severity followed by process[pid]: message

For each message extract these fields:
- workspaceId: always use the workspace_id provided in the input
- timestamp: integer unix epoch. Look for eventtime, timestamp, rt, start, or similar \
fields. If the value has more than 10 digits, keep only the first 10. If a human-readable \
date is found, convert to epoch. Fall back to current unix time if missing.
- severity: normalize to one of: "critical", "high", "medium", "low", "unknown"
  * critical: emergency, alert, critical, severity 1-2, or equivalent
  * high: error, severity 3, or equivalent
  * medium: warning, severity 4, or equivalent
  * low: notice, informational, severity 5-6, or equivalent
  * unknown: debug, severity 7, or if not determinable
- vendor: detected vendor name in lowercase (e.g. "fortigate", "cisco_asa", "paloalto", \
"checkpoint", "juniper", "linux", "sophos", "pfsense", etc.)
- eventType: the log category (e.g. "traffic", "threat", "system", "event", "security", \
"firewall", "vpn", "auth"). Normalize to lowercase.
- action: the action taken (e.g. "allow", "deny", "drop", "accept", "reject", "close", \
"login", "logout") or null
- application: application or service name, or null
- protocol: normalize to lowercase name (e.g. "tcp", "udp", "icmp"). Translate numeric \
protocol numbers (6→tcp, 17→udp, 1→icmp, etc.). Null if missing.
- policy: policy/rule ID or name, or null
- sourceIp: source IP address, or null
- sourcePort: source port as integer, or null
- destinationIp: destination IP address, or null
- destinationPort: destination port as integer, or null
- srcCountry: source country if present, or null
- dstCountry: destination country if present, or null
- rawLog: the original raw log string, verbatim

Return ONLY valid JSON in this exact shape: {"logs": [...]}
"""


class LlmLogIngester:
    """
    Buffers incoming raw syslog messages and periodically parses them in
    batches via an LLM before forwarding structured results to the SOC API.

    Trigger conditions (whichever fires first):
      - buffer reaches batch_size logs
      - flush_interval seconds have elapsed

    Burst protection: batches are placed in a bounded queue consumed by a
    single worker thread. If the queue is full the batch falls back to
    regex parsing and is sent directly — no logs are dropped, no threads block.
    """

    def __init__(
        self,
        api_url: str,
        workspace_id: str,
        openai_key: str,
        batch_size: int = 10,
        flush_interval: float = 30.0,
        llm_model: str = "gpt-4.1-mini",
        max_pending: int = 5,
    ):
        self.api_url = api_url.rstrip("/")
        self.workspace_id = workspace_id
        self.openai_key = openai_key
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.llm_model = llm_model

        self._buffer: list[str] = []
        self._lock = threading.Lock()
        self._queue: queue.Queue = queue.Queue(maxsize=max_pending)
        self._running = True

        # stats
        self._sent = 0
        self._errors = 0
        self._llm_calls = 0
        self._fallbacks = 0

        self._worker = threading.Thread(target=self._llm_worker, daemon=True)
        self._worker.start()

        self._timer = threading.Thread(target=self._flush_loop, daemon=True)
        self._timer.start()

    def add(self, raw_message: str):
        with self._lock:
            self._buffer.append(raw_message)
            if len(self._buffer) >= self.batch_size:
                batch = self._buffer[:]
                self._buffer.clear()
            else:
                return
        self._enqueue_or_fallback(batch)

    def _flush_loop(self):
        while self._running:
            time.sleep(self.flush_interval)
            self.flush()

    def flush(self):
        with self._lock:
            if not self._buffer:
                return
            batch = self._buffer[:]
            self._buffer.clear()
        self._enqueue_or_fallback(batch)

    def _enqueue_or_fallback(self, batch: list[str]):
        try:
            self._queue.put_nowait(batch)
        except queue.Full:
            print(
                f"{COLORS['warning']}  LLM queue full — dropping "
                f"{len(batch)} log(s){COLORS['reset']}",
                file=sys.stderr, flush=True,
            )
            self._fallbacks += 1

    def _llm_worker(self):
        while self._running:
            try:
                batch = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                print(
                    f"{COLORS['info']}  LLM parsing batch of {len(batch)} log(s)...{COLORS['reset']}",
                    flush=True,
                )
                logs = self._llm_parse(batch)
                print(
                    f"{COLORS['success']}  LLM returned {len(logs)} parsed log(s){COLORS['reset']}",
                    flush=True,
                )
                self._send(logs)
                self._llm_calls += 1
            except Exception as e:
                print(
                    f"{COLORS['error']}  LLM parse failed ({e}) — dropping batch{COLORS['reset']}",
                    file=sys.stderr, flush=True,
                )
                self._fallbacks += 1
            finally:
                self._queue.task_done()

    def _llm_parse(self, raw_logs: list[str]) -> list[dict]:
        """Call OpenAI to parse raw syslog lines into structured log dicts."""
        payload = json.dumps({
            "model": self.llm_model,
            "messages": [
                {"role": "system", "content": _LLM_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps({
                    "workspace_id": self.workspace_id,
                    "raw_logs": raw_logs,
                })},
            ],
            "response_format": {"type": "json_object"},
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.openai_key}",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        content = result["choices"][0]["message"]["content"]
        print(
            f"{COLORS['timestamp']}  LLM response: {content[:500]}{COLORS['reset']}",
            flush=True,
        )
        parsed = json.loads(content)
        logs = parsed.get("logs", [])

        # always enforce correct workspaceId regardless of what the LLM returned
        for log in logs:
            log["workspaceId"] = self.workspace_id

        return logs

    def _send(self, batch: list[dict]):
        if not batch:
            return
        url = f"{self.api_url}/logs/ingest"
        data = json.dumps(batch).encode("utf-8")
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10):
                self._sent += len(batch)
                print(
                    f"{COLORS['success']}  Ingested {len(batch)} log(s) to API{COLORS['reset']}",
                    flush=True,
                )
        except urllib.error.HTTPError as e:
            self._errors += len(batch)
            body = e.read().decode("utf-8", errors="replace")[:200]
            print(f"{COLORS['error']}  INGEST ERROR ({e.code}): {body}{COLORS['reset']}",
                  file=sys.stderr, flush=True)
        except Exception as e:
            self._errors += len(batch)
            print(f"{COLORS['error']}  INGEST ERROR: {e}{COLORS['reset']}",
                  file=sys.stderr, flush=True)

    def stop(self):
        self._running = False
        self.flush()
        self._queue.join()

    def print_stats(self):
        print(f"  Logs sent to API : {COLORS['success']}{self._sent}{COLORS['reset']}")
        print(f"  LLM batches      : {COLORS['info']}{self._llm_calls}{COLORS['reset']}")
        if self._fallbacks:
            print(f"  Regex fallbacks  : {COLORS['warning']}{self._fallbacks}{COLORS['reset']}")
        if self._errors:
            print(f"  Ingest errors    : {COLORS['error']}{self._errors}{COLORS['reset']}")


class AutoResponsePoller:
    """
    Polls the SOC API for pending auto-response commands and executes them
    via SSH on the target device. Retries each command up to 3 times before
    marking it failed and letting the API notify analysts.
    """

    POLL_INTERVAL = 5  # seconds between polls
    MAX_RETRIES = 3
    RETRY_DELAY = 5    # seconds between retries

    def __init__(self, api_url: str, workspace_id: str, use_color: bool = True):
        self.api_url = api_url.rstrip("/")
        self.workspace_id = workspace_id
        self.use_color = use_color
        self._running = True
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)

    def start(self):
        if not HAS_PARAMIKO:
            print(
                f"{self._c('warning')}  WARNING: paramiko not installed — "
                f"auto-response SSH execution disabled{self._c('reset')}",
                file=sys.stderr, flush=True,
            )
            return
        self._thread.start()
        print(
            f"{self._c('success')}  Auto-response SSH poller started "
            f"(workspace: {self.workspace_id}){self._c('reset')}",
            flush=True,
        )

    def stop(self):
        self._running = False

    def _c(self, key: str) -> str:
        return COLORS.get(key, "") if self.use_color else ""

    def _poll_loop(self):
        while self._running:
            try:
                self._poll_once()
            except Exception as e:
                print(
                    f"{self._c('error')}  Auto-response poll error: {e}{self._c('reset')}",
                    file=sys.stderr, flush=True,
                )
            time.sleep(self.POLL_INTERVAL)

    def _poll_once(self):
        url = f"{self.api_url}/auto-response/pending?workspaceId={self.workspace_id}"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(
                f"{self._c('warning')}  Auto-response poll failed: {e}{self._c('reset')}",
                file=sys.stderr, flush=True,
            )
            return

        commands = data.get("commands", [])
        device = data.get("device")
        if not commands or not device:
            return

        print(
            f"{self._c('info')}  Auto-response: {len(commands)} pending command(s) "
            f"for device {device.get('host')}{self._c('reset')}",
            flush=True,
        )

        for cmd in commands:
            self._execute_command(cmd, device)

    def _execute_command(self, cmd: dict, device: dict):
        cmd_id = cmd["id"]
        command_str = cmd["command"]
        cmd_type = cmd.get("type", "custom")
        target = cmd.get("target", "")

        print(
            f"{self._c('info')}  Executing [{cmd_type}] on {target}: "
            f"{command_str[:60]}...{self._c('reset')}",
            flush=True,
        )

        # mark as running
        self._patch_command(cmd_id, "running", None, 0)

        output = None
        success = False
        retry_count = 0

        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                output = self._ssh_exec(
                    host=device["host"],
                    port=device.get("port", 22),
                    user=device["user"],
                    password=device.get("password"),
                    command=command_str,
                )
                success = True
                retry_count = attempt - 1
                print(
                    f"{self._c('success')}  [{cmd_type}] succeeded "
                    f"(attempt {attempt}){self._c('reset')}",
                    flush=True,
                )
                break
            except Exception as e:
                output = str(e)
                retry_count = attempt
                print(
                    f"{self._c('warning')}  [{cmd_type}] attempt {attempt} failed: "
                    f"{e}{self._c('reset')}",
                    file=sys.stderr, flush=True,
                )
                if attempt < self.MAX_RETRIES:
                    time.sleep(self.RETRY_DELAY)

        final_status = "success" if success else "failed"
        self._patch_command(cmd_id, final_status, output, retry_count)

    def _ssh_exec(self, host: str, port: int, user: str, password: str, command: str) -> str:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                hostname=host,
                port=port,
                username=user,
                password=password,
                timeout=15,
                look_for_keys=False,
                allow_agent=False,
            )
            stdin, stdout, stderr = client.exec_command(command, timeout=30)
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            return (out + err).strip()
        finally:
            client.close()

    def _patch_command(self, cmd_id: str, status: str, output: str | None, retry_count: int):
        url = f"{self.api_url}/auto-response/commands/{cmd_id}"
        body = json.dumps({"status": status, "output": output, "retryCount": retry_count}).encode("utf-8")
        try:
            req = urllib.request.Request(
                url, data=body,
                headers={"Content-Type": "application/json"},
                method="PATCH",
            )
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            print(
                f"{self._c('error')}  Failed to patch command {cmd_id}: {e}{self._c('reset')}",
                file=sys.stderr, flush=True,
            )


class SyslogHandler(socketserver.BaseRequestHandler):

    def handle(self):
        data = self.request[0].strip()
        try:
            message = data.decode("utf-8", errors="replace")
        except Exception:
            message = str(data)

        # strip syslog priority header
        message = re.sub(r"^<\d+>", "", message).strip()

        if self.server.log_filter:
            if self.server.log_filter.lower() not in message.lower():
                return

        formatted = format_log(message, use_color=self.server.use_color)
        print(formatted, flush=True)

        if self.server.show_raw:
            raw_color = COLORS["timestamp"] if self.server.use_color else ""
            reset = COLORS["reset"] if self.server.use_color else ""
            print(f"{raw_color}  RAW: {message}{reset}", flush=True)

        if self.server.ingester:
            self.server.ingester.add(message)

        if self.server.log_file:
            plain = format_log(message, use_color=False)
            try:
                self.server.log_file.write(plain + "\n")
                self.server.log_file.flush()
            except Exception as e:
                print(f"Error writing to log file: {e}", file=sys.stderr)


class SyslogServer(socketserver.UDPServer):
    allow_reuse_address = True

    def __init__(self, server_address, handler_class, log_filter=None,
                 log_file=None, use_color=True, show_raw=False, ingester=None):
        super().__init__(server_address, handler_class)
        self.log_filter = log_filter
        self.log_file = log_file
        self.use_color = use_color
        self.show_raw = show_raw
        self.ingester = ingester


def print_banner(host: str, port: int, log_filter: str, output_file: str,
                 workspace_id: str = None, api_url: str = None,
                 llm_model: str = None, batch_size: int = None,
                 flush_interval: float = None, max_pending: int = None):
    if workspace_id:
        ingest_line = f"{COLORS['success']}{api_url} -> {workspace_id}{COLORS['reset']}"
        llm_line = (
            f"{COLORS['info']}{llm_model}{COLORS['reset']}  "
            f"batch={batch_size}  interval={flush_interval}s  "
            f"max_pending={max_pending}"
        )
    else:
        ingest_line = f"{COLORS['timestamp']}disabled (no --workspace-id){COLORS['reset']}"
        llm_line = f"{COLORS['timestamp']}disabled{COLORS['reset']}"

    print(f"""
{COLORS['header']}╔══════════════════════════════════════════════════════════╗
║          SOC Syslog Listener — Multi-Vendor              ║
╚══════════════════════════════════════════════════════════╝{COLORS['reset']}

  Listening on : {COLORS['info']}{host}:{port}{COLORS['reset']}
  Filter       : {COLORS['info']}{log_filter or 'None (showing all)'}{COLORS['reset']}
  Output file  : {COLORS['info']}{output_file or 'None (console only)'}{COLORS['reset']}
  API ingest   : {ingest_line}
  LLM parser   : {llm_line}

  {COLORS['timestamp']}Press Ctrl+C to stop and show statistics{COLORS['reset']}

{COLORS['header']}{'─' * 58}{COLORS['reset']}
""")


def print_stats_report(ingester=None):
    if not stats and not ingester:
        return

    print(f"\n{COLORS['header']}{'─' * 58}")
    print(f"  Log Statistics")
    print(f"{'─' * 58}{COLORS['reset']}")

    print(f"\n  {COLORS['header']}Total logs received: {stats.get('total', 0)}{COLORS['reset']}")

    if ingester:
        ingester.print_stats()

    print()


def main():
    parser = argparse.ArgumentParser(
        description="SOC Syslog Listener — Multi-vendor log collection with LLM-powered parsing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py --port 514                                             # Listen only
  python main.py --port 514 --workspace-id abc123 --openai-key sk-...  # LLM ingestion
  python main.py --port 514 --workspace-id abc123 --openai-key sk-... --batch-size 20 --flush-interval 60
  python main.py --port 514 --workspace-id abc123 --openai-key sk-... --raw
        """,
    )
    parser.add_argument("--host", default="0.0.0.0",
                        help="IP to listen on (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=514,
                        help="UDP port to listen on (default: 514)")
    parser.add_argument("--filter", dest="log_filter", default=None,
                        help="Only show logs containing this keyword")
    parser.add_argument("--output", default=None,
                        help="Save logs to this file")
    parser.add_argument("--no-color", action="store_true",
                        help="Disable colored output")
    parser.add_argument("--raw", action="store_true",
                        help="Also print the raw syslog message below each formatted line")

    # API ingestion
    parser.add_argument("--workspace-id", default=None,
                        help="Workspace ID to ingest logs into (enables API forwarding)")
    parser.add_argument("--api-url", default="http://localhost:3001",
                        help="SOC API base URL (default: http://localhost:3001)")

    # LLM parsing
    parser.add_argument("--openai-key", default=None,
                        help="OpenAI API key for LLM-powered log parsing")
    parser.add_argument("--llm-model", default="gpt-4.1-mini",
                        help="OpenAI model to use for parsing (default: gpt-4.1-mini)")
    parser.add_argument("--batch-size", type=int, default=10,
                        help="Trigger LLM parse after this many logs (default: 10)")
    parser.add_argument("--flush-interval", type=float, default=30.0,
                        help="Trigger LLM parse after this many seconds (default: 30)")
    parser.add_argument("--max-pending", type=int, default=5,
                        help="Max queued LLM batches before falling back to regex (default: 5)")

    args = parser.parse_args()
    log_file = None
    ingester = None
    poller = None

    if args.output:
        log_file = open(args.output, "a", encoding="utf-8")

    if args.workspace_id:
        if not args.openai_key:
            print(
                f"{COLORS['error']}ERROR: --openai-key is required when --workspace-id is set{COLORS['reset']}",
                file=sys.stderr,
            )
            sys.exit(1)
        ingester = LlmLogIngester(
            api_url=args.api_url,
            workspace_id=args.workspace_id,
            openai_key=args.openai_key,
            batch_size=args.batch_size,
            flush_interval=args.flush_interval,
            llm_model=args.llm_model,
            max_pending=args.max_pending,
        )
        poller = AutoResponsePoller(
            api_url=args.api_url,
            workspace_id=args.workspace_id,
            use_color=not args.no_color,
        )
        poller.start()

    print_banner(
        args.host, args.port, args.log_filter, args.output,
        args.workspace_id, args.api_url,
        args.llm_model, args.batch_size, args.flush_interval, args.max_pending,
    )

    server = SyslogServer(
        (args.host, args.port),
        SyslogHandler,
        log_filter=args.log_filter,
        log_file=log_file,
        use_color=not args.no_color,
        show_raw=args.raw,
        ingester=ingester,
    )

    def shutdown(sig, frame):
        print(f"\n\n{COLORS['warning']}Shutting down...{COLORS['reset']}")
        if poller:
            poller.stop()
        if ingester:
            ingester.stop()
        print_stats_report(ingester)
        if log_file:
            log_file.close()
        server.server_close()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        shutdown(None, None)


if __name__ == "__main__":
    main()
