"use client";

import { use, useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  ArrowLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from "lucide-react";
import api from "@/lib/api";

interface Log {
  id: string;
  timestamp: number;
  severity: string;
  vendor: string;
  eventType: string;
  action: string | null;
  application: string | null;
  protocol: string | null;
  policy: string | null;
  sourceIp: string | null;
  sourcePort: number | null;
  destinationIp: string | null;
  destinationPort: number | null;
  rawLog: string;
}

interface LogMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "oklch(0.65 0.20 25)",
  high: "oklch(0.70 0.18 40)",
  medium: "oklch(0.75 0.15 70)",
  low: "oklch(0.72 0.10 195)",
  unknown: "oklch(0.55 0.03 250)",
};

const ACTION_COLORS: Record<string, string> = {
  allow: "oklch(0.72 0.15 155)",
  deny: "oklch(0.65 0.20 25)",
  drop: "oklch(0.70 0.18 40)",
  reset: "oklch(0.75 0.15 70)",
};

const severityChartConfig: ChartConfig = {
  critical: { label: "Critical", color: SEVERITY_COLORS.critical },
  high: { label: "High", color: SEVERITY_COLORS.high },
  medium: { label: "Medium", color: SEVERITY_COLORS.medium },
  low: { label: "Low", color: SEVERITY_COLORS.low },
  unknown: { label: "Unknown", color: SEVERITY_COLORS.unknown },
};

const volumeConfig: ChartConfig = {
  count: { label: "Logs", color: "oklch(0.72 0.10 195)" },
};

const actionConfig: ChartConfig = {
  allow: { label: "Allow", color: ACTION_COLORS.allow },
  deny: { label: "Deny", color: ACTION_COLORS.deny },
  drop: { label: "Drop", color: ACTION_COLORS.drop },
  reset: { label: "Reset", color: ACTION_COLORS.reset },
};

function formatTs(epoch: number) {
  return new Date(epoch * 1000).toLocaleString("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function severityBadge(s: string) {
  const map: Record<string, string> = {
    critical: "bg-red-500/15 text-red-400",
    high: "bg-orange-500/15 text-orange-400",
    medium: "bg-yellow-500/15 text-yellow-400",
    low: "bg-blue-500/15 text-blue-400",
    unknown: "bg-zinc-500/15 text-zinc-400",
  };
  return map[s] || map.unknown;
}

export default function LogsPage({
  params,
}: {
  params: Promise<{ id: string; wsId: string }>;
}) {
  const { id, wsId } = use(params);
  const [logs, setLogs] = useState<Log[]>([]);
  const [allLogs, setAllLogs] = useState<Log[]>([]);
  const [meta, setMeta] = useState<LogMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [eventType, setEventType] = useState("");
  const [action, setAction] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [workspace, setWorkspace] = useState<{ name: string; company: { id: string; name: string } } | null>(null);

  // Fetch workspace info
  useEffect(() => {
    api.get(`/companies/${id}/workspaces/${wsId}`)
      .then(({ data: json }) => setWorkspace(json.data))
      .catch(() => {});
  }, [id, wsId]);

  // Fetch all logs for charts (first 1000)
  useEffect(() => {
    api.get(`/logs/workspace/${wsId}`, { params: { limit: 200, page: 1 } })
      .then(({ data: json }) => setAllLogs(json.data))
      .catch(() => {});
  }, [wsId]);

  // Fetch filtered/paginated logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: "50",
      };
      if (search) params.search = search;
      if (severity) params.severity = severity;
      if (eventType) params.eventType = eventType;
      if (action) params.action = action;
      const { data: json } = await api.get(`/logs/workspace/${wsId}`, { params });
      setLogs(json.data);
      setMeta(json.meta);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [wsId, page, search, severity, eventType, action]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Chart data computations
  const severityDist = useMemo(() => {
    const counts: Record<string, number> = {};
    allLogs.forEach((l) => {
      counts[l.severity] = (counts[l.severity] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allLogs]);

  const actionDist = useMemo(() => {
    const counts: Record<string, number> = {};
    allLogs.forEach((l) => {
      const a = l.action || "unknown";
      counts[a] = (counts[a] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allLogs]);

  const volumeOverTime = useMemo(() => {
    if (allLogs.length === 0) return [];
    const sorted = [...allLogs].sort((a, b) => a.timestamp - b.timestamp);
    const min = sorted[0].timestamp;
    const max = sorted[sorted.length - 1].timestamp;
    const range = max - min;
    const bucketSize = Math.max(Math.floor(range / 12), 1);
    const buckets: Record<string, number> = {};

    sorted.forEach((l) => {
      const bucket = Math.floor((l.timestamp - min) / bucketSize);
      const bucketTs = min + bucket * bucketSize;
      const label = new Date(bucketTs * 1000).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      buckets[label] = (buckets[label] || 0) + 1;
    });

    return Object.entries(buckets).map(([time, count]) => ({ time, count }));
  }, [allLogs]);

  const topSourceIps = useMemo(() => {
    const counts: Record<string, number> = {};
    allLogs.forEach((l) => {
      if (l.sourceIp) counts[l.sourceIp] = (counts[l.sourceIp] || 0) + 1;
    });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));
  }, [allLogs]);

  const topDestIps = useMemo(() => {
    const counts: Record<string, number> = {};
    allLogs.forEach((l) => {
      if (l.destinationIp) counts[l.destinationIp] = (counts[l.destinationIp] || 0) + 1;
    });
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));
  }, [allLogs]);

  const eventTypes = useMemo(() => {
    return [...new Set(allLogs.map((l) => l.eventType))].sort();
  }, [allLogs]);

  const actions = useMemo(() => {
    return [...new Set(allLogs.map((l) => l.action).filter(Boolean))].sort();
  }, [allLogs]);

  const displayedLogs = useMemo(() => {
    return sortDir === "asc" ? [...logs].reverse() : logs;
  }, [logs, sortDir]);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href={`/companies/${id}/workspaces/${wsId}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <p className="text-xs text-muted-foreground">
            {workspace?.company.name} / {workspace?.name}
          </p>
          <h1 className="text-lg font-semibold">Log Explorer</h1>
        </div>
        <div className="ml-auto text-xs text-muted-foreground font-mono">
          {meta ? `${meta.total.toLocaleString()} logs` : ""}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Logs</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {meta?.total.toLocaleString() ?? "..."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Unique Sources</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {topSourceIps.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Event Types</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {eventTypes.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Vendors</p>
            <p className="text-2xl font-semibold font-mono mt-1">
              {[...new Set(allLogs.map((l) => l.vendor))].length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Log volume over time */}
        <Card className="lg:col-span-2">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Log Volume</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ChartContainer config={volumeConfig} className="h-[160px] w-full">
              <AreaChart data={volumeOverTime}>
                <XAxis dataKey="time" tickLine={false} axisLine={false} fontSize={11} tickMargin={4} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <defs>
                  <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area dataKey="count" type="monotone" stroke="var(--color-count)" fill="url(#volFill)" strokeWidth={1.5} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Severity distribution */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">By Severity</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ChartContainer config={severityChartConfig} className="h-[160px] w-full">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={severityDist}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={65}
                  paddingAngle={2}
                >
                  {severityDist.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={SEVERITY_COLORS[entry.name] || SEVERITY_COLORS.unknown}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Action distribution */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">By Action</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ChartContainer config={actionConfig} className="h-[160px] w-full">
              <BarChart data={actionDist} layout="vertical">
                <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} fontSize={11} width={50} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {actionDist.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={ACTION_COLORS[entry.name] || "oklch(0.55 0.03 250)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Top source IPs */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Top Source IPs</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
              {topSourceIps.map(({ ip, count }) => (
                <div key={ip} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{ip}</span>
                  <span className="font-mono font-medium">{count}</span>
                </div>
              ))}
              {topSourceIps.length === 0 && (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top destination IPs */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Top Destination IPs</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
              {topDestIps.map(({ ip, count }) => (
                <div key={ip} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{ip}</span>
                  <span className="font-mono font-medium">{count}</span>
                </div>
              ))}
              {topDestIps.length === 0 && (
                <p className="text-xs text-muted-foreground">No data</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search raw logs..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <select
          value={severity}
          onChange={(e) => { setSeverity(e.target.value); setPage(1); }}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="unknown">Unknown</option>
        </select>
        <select
          value={eventType}
          onChange={(e) => { setEventType(e.target.value); setPage(1); }}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="">All event types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a!}>{a}</option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1"
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
        >
          <ArrowUpDown className="size-3" />
          {sortDir === "desc" ? "Newest first" : "Oldest first"}
        </Button>
      </div>

      {/* Log table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-3 font-medium w-[140px]">Timestamp</th>
                <th className="text-left p-3 font-medium w-[80px]">Severity</th>
                <th className="text-left p-3 font-medium w-[80px]">Vendor</th>
                <th className="text-left p-3 font-medium w-[80px]">Event</th>
                <th className="text-left p-3 font-medium w-[60px]">Action</th>
                <th className="text-left p-3 font-medium w-[100px]">Application</th>
                <th className="text-left p-3 font-medium">Source</th>
                <th className="text-left p-3 font-medium">Destination</th>
                <th className="text-left p-3 font-medium w-[140px]">Policy</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              ) : displayedLogs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    No logs found
                  </td>
                </tr>
              ) : (
                displayedLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                  >
                    <td className="p-3 font-mono whitespace-nowrap">
                      {formatTs(log.timestamp)}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${severityBadge(log.severity)}`}
                      >
                        {log.severity}
                      </span>
                    </td>
                    <td className="p-3 font-mono">{log.vendor}</td>
                    <td className="p-3">{log.eventType}</td>
                    <td className="p-3">
                      {log.action && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            log.action === "allow"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : log.action === "deny" || log.action === "drop"
                              ? "bg-red-500/15 text-red-400"
                              : "bg-zinc-500/15 text-zinc-400"
                          }`}
                        >
                          {log.action}
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono">{log.application || "-"}</td>
                    <td className="p-3 font-mono whitespace-nowrap">
                      {log.sourceIp ? `${log.sourceIp}${log.sourcePort ? `:${log.sourcePort}` : ""}` : "-"}
                    </td>
                    <td className="p-3 font-mono whitespace-nowrap">
                      {log.destinationIp ? `${log.destinationIp}${log.destinationPort ? `:${log.destinationPort}` : ""}` : "-"}
                    </td>
                    <td className="p-3 truncate max-w-[140px]" title={log.policy || ""}>
                      {log.policy || "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {meta.page} of {meta.pages}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={meta.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={meta.page >= meta.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
