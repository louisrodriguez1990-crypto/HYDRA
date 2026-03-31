"use client";

import { useState, useRef, useEffect } from "react";

const MATTE = "#0a0a0a";
const SURFACE = "#141414";
const BORDER = "#1f1f1f";
const MUTED = "#525252";
const DIM = "#a3a3a3";
const WHITE = "#e5e5e5";

type Topology = "fast" | "reasoning" | "code" | "creative" | "full";

interface Message {
  role: "user" | "assistant";
  text: string;
  topology?: Topology;
}

const TOPOLOGY_LABELS: Record<Topology, string> = {
  fast: "fast",
  reasoning: "reasoning",
  code: "code",
  creative: "creative",
  full: "full",
};

export default function Hydra() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", text: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.text })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: data.error ?? "Something went wrong. Please try again." },
        ]);
        return;
      }

      const topology = data.metadata?.topology as Topology | undefined;
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.content, topology },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Connection error. Please check your network and try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: MATTE,
        color: WHITE,
        fontFamily: "'IBM Plex Mono', 'SF Mono', 'Fira Code', monospace",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: ${MATTE}; }
        ::selection { background: #333; color: #fff; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${BORDER}; border-radius: 2px; }
        textarea:focus { outline: none; }
        @keyframes pulse { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <header
        style={{
          padding: "20px 24px",
          borderBottom: `1px solid ${BORDER}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="3" fill={WHITE} />
            <circle cx="10" cy="10" r="8" stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" />
          </svg>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Hydra
          </span>
        </div>
        <span style={{ fontSize: 11, color: MUTED, letterSpacing: "0.05em" }}>v0.1</span>
      </header>

      {/* Messages */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: 12,
              opacity: 0.4,
            }}
          >
            <svg width="32" height="32" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="3" fill={WHITE} />
              <circle cx="10" cy="10" r="8" stroke={MUTED} strokeWidth="1" strokeDasharray="2 3" />
            </svg>
            <span style={{ fontSize: 12, color: MUTED, letterSpacing: "0.1em" }}>
              START A CONVERSATION
            </span>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              padding: "12px 16px",
              borderRadius: 6,
              background: msg.role === "user" ? SURFACE : "transparent",
              border:
                msg.role === "user" ? `1px solid ${BORDER}` : "1px solid transparent",
              maxWidth: "85%",
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              animation: "fadeIn 0.2s ease",
            }}
          >
            {msg.role === "assistant" && (
              <div
                style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
              >
                <span
                  style={{ fontSize: 10, color: MUTED, letterSpacing: "0.08em" }}
                >
                  HYDRA
                </span>
                {msg.topology && (
                  <span
                    style={{
                      fontSize: 9,
                      color: MUTED,
                      letterSpacing: "0.06em",
                      background: SURFACE,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 3,
                      padding: "1px 5px",
                      textTransform: "uppercase",
                    }}
                  >
                    {TOPOLOGY_LABELS[msg.topology]}
                  </span>
                )}
              </div>
            )}
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.6,
                fontWeight: 300,
                color: msg.role === "user" ? WHITE : DIM,
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.text}
            </p>
          </div>
        ))}

        {loading && (
          <div style={{ padding: "12px 16px", alignSelf: "flex-start" }}>
            <span
              style={{
                fontSize: 10,
                color: MUTED,
                letterSpacing: "0.08em",
                display: "block",
                marginBottom: 6,
              }}
            >
              HYDRA
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map((n) => (
                <div
                  key={n}
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: MUTED,
                    animation: "pulse 1.2s ease-in-out infinite",
                    animationDelay: `${n * 0.2}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* Input */}
      <footer
        style={{
          padding: "16px 24px 24px",
          borderTop: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message Hydra..."
            rows={1}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: WHITE,
              fontSize: 13,
              fontFamily: "inherit",
              fontWeight: 300,
              resize: "none",
              lineHeight: 1.5,
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            style={{
              background: input.trim() && !loading ? WHITE : BORDER,
              border: "none",
              borderRadius: 6,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: input.trim() && !loading ? "pointer" : "default",
              transition: "background 0.15s",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 13L13 1M13 1H5M13 1V9"
                stroke={MATTE}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <p
          style={{
            textAlign: "center",
            fontSize: 10,
            color: MUTED,
            marginTop: 10,
            letterSpacing: "0.04em",
          }}
        >
          Hydra can make mistakes. Verify important information.
        </p>
      </footer>
    </div>
  );
}
