"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/alerts", label: "Alerts" },
];

interface NavbarProps {
  onChatToggle: () => void;
  chatOpen: boolean;
}

export function Navbar({ onChatToggle, chatOpen }: NavbarProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="flex h-12 items-center px-6 gap-8">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          Lurkas
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-1 text-sm rounded-md transition-colors",
                  isActive
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={onChatToggle}
          className={cn(
            "ml-auto flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition-colors",
            chatOpen
              ? "text-foreground bg-secondary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageSquare className="size-3.5" />
          Chat
        </button>
      </div>
    </header>
  );
}
