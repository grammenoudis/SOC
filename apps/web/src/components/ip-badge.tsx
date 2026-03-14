"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import api from "@/lib/api";
import type { IpReputationDto } from "@soc/shared";

// module-level cache — same IP won't be fetched twice per session
const cache = new Map<string, IpReputationDto | null>();
const pending = new Map<string, Promise<IpReputationDto | null>>();

async function fetchRep(ip: string): Promise<IpReputationDto | null> {
  if (cache.has(ip)) return cache.get(ip)!;
  if (pending.has(ip)) return pending.get(ip)!;

  const p = api
    .get(`/reputation/${encodeURIComponent(ip)}`)
    .then(({ data: json }) => (json.data as IpReputationDto) ?? null)
    .catch(() => null);

  pending.set(ip, p);
  const result = await p;
  cache.set(ip, result);
  pending.delete(ip);
  return result;
}

function scoreStyle(score: number) {
  if (score >= 76) return "bg-red-500/15 text-red-400 border-red-500/20";
  if (score >= 26) return "bg-yellow-500/15 text-yellow-400 border-yellow-500/20";
  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
}

interface IpBadgeProps {
  ip: string;
  port?: number | null;
  className?: string;
}

export function IpBadge({ ip, port, className }: IpBadgeProps) {
  const [rep, setRep] = useState<IpReputationDto | null | undefined>(undefined);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    fetchRep(ip).then(setRep);
  }, [ip]);

  const showTooltip = useCallback(() => {
    if (!pillRef.current) return;
    const rect = pillRef.current.getBoundingClientRect();
    setTooltipPos({
      x: rect.left,
      y: rect.top,
    });
  }, []);

  const hideTooltip = useCallback(() => setTooltipPos(null), []);

  const display = port ? `${ip}:${port}` : ip;

  if (!rep) {
    return <span className={`font-mono ${className ?? ""}`}>{display}</span>;
  }

  const tooltipLines = [
    rep.isp && `ISP: ${rep.isp}`,
    rep.countryCode && `Country: ${rep.countryCode}`,
    rep.usageType && `Type: ${rep.usageType}`,
    `Reports: ${rep.totalReports}`,
    rep.lastReportedAt &&
      `Last seen: ${new Date(rep.lastReportedAt).toLocaleDateString("en-GB")}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono ${className ?? ""}`}>
      {display}
      <span
        ref={pillRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        className={`inline-flex items-center text-[9px] px-1 py-px rounded border font-sans font-semibold leading-tight cursor-default ${scoreStyle(rep.abuseScore)}`}
      >
        {rep.abuseScore}
      </span>

      {tooltipLines && tooltipPos &&
        createPortal(
          <span
            className="pointer-events-none fixed z-[9999] bg-popover border border-border rounded-md shadow-lg px-2.5 py-2 text-xs text-foreground whitespace-pre min-w-[180px]"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y - 6,
              transform: "translateY(-100%)",
            }}
          >
            {tooltipLines}
          </span>,
          document.body,
        )}
    </span>
  );
}
