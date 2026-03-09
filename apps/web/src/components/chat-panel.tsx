"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Send, Plus, Trash2, MessageSquare, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import type { MessageDto, ConversationDto } from "@soc/shared";

function usePageContext() {
  const pathname = usePathname();

  const wsMatch = pathname.match(/^\/companies\/([^/]+)\/workspaces\/([^/]+)/);
  if (wsMatch) return { companyId: wsMatch[1], workspaceId: wsMatch[2] };

  const companyMatch = pathname.match(/^\/companies\/([^/]+)/);
  if (companyMatch) return { companyId: companyMatch[1], workspaceId: undefined };

  return { companyId: undefined, workspaceId: undefined };
}

function useContextLine() {
  const pathname = usePathname();
  const { companyId, workspaceId } = usePageContext();
  const [label, setLabel] = useState("Monitoring all companies");

  useEffect(() => {
    if (workspaceId && companyId) {
      api.get(`/companies/${companyId}/workspaces/${workspaceId}`)
        .then(({ data: json }) => {
          const ws = json.data;
          setLabel(`Scoped to ${ws.name} · ${ws.company?.name || companyId}`);
        })
        .catch(() => setLabel(`Scoped to workspace ${workspaceId.slice(0, 8)}...`));
    } else if (companyId) {
      api.get(`/companies/${companyId}`)
        .then(({ data: json }) => setLabel(`Scoped to ${json.data.name}`))
        .catch(() => setLabel(`Scoped to company ${companyId.slice(0, 8)}...`));
    } else if (pathname === "/alerts") {
      setLabel("Monitoring alerts across all companies");
    } else {
      setLabel("Monitoring all companies");
    }
  }, [pathname, companyId, workspaceId]);

  return label;
}

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  width: number;
  onResizeStart: () => void;
}

export function ChatPanel({ open, onClose, width, onResizeStart }: ChatPanelProps) {
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const contextLine = useContextLine();
  const { companyId, workspaceId } = usePageContext();

  // load conversation list
  const loadConversations = useCallback(() => {
    api.get("/chat/conversations")
      .then(({ data: json }) => setConversations(json.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const openConversation = useCallback(async (id: string) => {
    try {
      const { data: json } = await api.get(`/chat/conversations/${id}`);
      setActiveConvoId(id);
      setMessages(json.data.messages);
      setShowSidebar(false);
    } catch {
      // conversation might have been deleted
    }
  }, []);

  const startNewChat = useCallback(() => {
    setActiveConvoId(null);
    setMessages([]);
    setShowSidebar(false);
  }, []);

  const deleteConversation = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.delete(`/chat/conversations/${id}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvoId === id) {
        setActiveConvoId(null);
        setMessages([]);
      }
    } catch {}
  }, [activeConvoId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: MessageDto = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);

    try {
      const { data: json } = await api.post("/chat/message", {
        message: text,
        conversationId: activeConvoId || undefined,
        companyId,
        workspaceId,
      });

      const { conversationId: newConvoId, message: reply } = json.data;

      // if this was a new conversation, set it as active and refresh the list
      if (!activeConvoId) {
        setActiveConvoId(newConvoId);
        loadConversations();
      } else {
        // update the conversation title in the sidebar (it may have been auto-generated)
        loadConversations();
      }

      setMessages((prev) => [...prev, reply]);
    } catch (err: any) {
      const errMsg = err?.response?.data?.message || "Failed to get response. Check your API key and try again.";
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: errMsg },
      ]);
    } finally {
      setIsThinking(false);
    }
  }, [input, isThinking, activeConvoId, companyId, workspaceId, loadConversations]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  return (
    <div
      className={cn(
        "fixed top-12 right-0 h-[calc(100vh-3rem)] border-l border-border bg-background z-40 flex flex-col transition-transform duration-200",
        open ? "translate-x-0" : "translate-x-full"
      )}
      style={{ width }}
    >
      <div
        onMouseDown={onResizeStart}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-50"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSidebar((s) => !s)}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary/50"
            title="Conversation history"
          >
            <MessageSquare className="size-3.5" />
          </button>
          <span className="text-sm font-medium">Lurka</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewChat}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary/50"
            title="New chat"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary/50"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Conversation sidebar */}
        <div
          className={cn(
            "absolute inset-0 bg-background z-10 flex flex-col transition-transform duration-150",
            showSidebar ? "translate-x-0" : "-translate-x-full pointer-events-none"
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <button
              onClick={() => setShowSidebar(false)}
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary/50"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="text-xs font-medium text-muted-foreground">Conversations</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4 text-center">No conversations yet</p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => openConversation(c.id)}
                  className={cn(
                    "flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-secondary/50 border-b border-border/30 group",
                    activeConvoId === c.id && "bg-secondary/40"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{c.title}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(c.updatedAt)}</p>
                  </div>
                  <button
                    onClick={(e) => deleteConversation(c.id, e)}
                    className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 p-1 shrink-0"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border p-2">
            <button
              onClick={startNewChat}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground py-1.5 rounded hover:bg-secondary/50"
            >
              <Plus className="size-3" />
              New chat
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !isThinking && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">Ask me about your logs</p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                )}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isThinking && (
            <div className="flex justify-start">
              <div className="bg-secondary rounded-md px-3 py-2 flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-muted-foreground animate-pulse" />
                <span className="size-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2 p-3 pb-2"
        >
          <Input
            placeholder="Ask about logs, alerts..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-8 text-sm"
          />
          <Button type="submit" size="icon" className="size-8 shrink-0" disabled={isThinking}>
            <Send className="size-3.5" />
          </Button>
        </form>
        <div className="px-3 pb-2">
          <p className="text-[11px] text-muted-foreground truncate">{contextLine}</p>
        </div>
      </div>
    </div>
  );
}
