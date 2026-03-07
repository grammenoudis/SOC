"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { ChatPanel } from "@/components/chat-panel";

const MIN_CHAT_WIDTH = 320;
const MAX_CHAT_WIDTH_RATIO = 0.7;
const DEFAULT_CHAT_WIDTH = 384;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const maxWidth = window.innerWidth * MAX_CHAT_WIDTH_RATIO;
      const newWidth = Math.min(
        maxWidth,
        Math.max(MIN_CHAT_WIDTH, window.innerWidth - e.clientX)
      );
      setChatWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <>
      <Navbar onChatToggle={() => setChatOpen((o) => !o)} chatOpen={chatOpen} />
      <div
        className="transition-[margin] duration-200"
        style={{ marginRight: chatOpen ? chatWidth : 0 }}
      >
        <main>{children}</main>
      </div>
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        width={chatWidth}
        onResizeStart={handleMouseDown}
      />
    </>
  );
}
