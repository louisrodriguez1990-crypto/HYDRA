"use client";

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

type Topology = "fast" | "think" | "discover";
type Rigor = "balanced" | "rigorous";
type Role = "user" | "assistant";
type MessageStatus = "draft" | "refining" | "final" | "fallback";

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  createdAt: string;
  topology?: Topology;
  rigor?: Rigor;
  latency?: number;
  error?: boolean;
  status?: MessageStatus;
  responseToId?: string;
}

interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  draft: string;
  rigor: Rigor;
  messages: ChatMessage[];
}

interface MessageBlock {
  type: "text" | "code";
  content: string;
  language?: string;
}

const STORAGE_KEY = "hydra.chat.threads.v1";
const TOPOLOGY_COLOR: Record<Topology, string> = {
  fast: "#8b93a7",
  think: "#60a5fa",
  discover: "#f59e0b",
};
const RIGOR_COPY: Record<Rigor, string> = {
  balanced: "Balanced keeps Hydra fast and flexible.",
  rigorous: "Rigorous adds a verification pass and tighter synthesis.",
};
const STATUS_COLOR: Record<Exclude<MessageStatus, "final">, string> = {
  draft: "#38bdf8",
  refining: "#f59e0b",
  fallback: "#f87171",
};
const STATUS_COPY: Record<Exclude<MessageStatus, "final">, string> = {
  draft: "First-pass answer ready.",
  refining: "Hydra is refining this answer in the background.",
  fallback: "Showing the best available answer before the request budget expired.",
};
const STARTER_PROMPTS = [
  "Compare three architectures and recommend the strongest option.",
  "Design a novel workflow, then pressure-test it for weak spots.",
  "Break down this bug report and suggest the most likely root causes.",
  "Brainstorm unconventional product ideas, then narrow to the best one.",
];

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `hydra-${Date.now()}-${Math.random()}`;
}

function deriveTitle(input: string) {
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (!collapsed) return "New chat";
  return collapsed.length > 48 ? `${collapsed.slice(0, 48).trimEnd()}...` : collapsed;
}

function isMessageStatus(value: unknown): value is MessageStatus {
  return (
    value === "draft" || value === "refining" || value === "final" || value === "fallback"
  );
}

function createThread(seed?: Partial<Pick<ChatThread, "draft" | "rigor">>): ChatThread {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    draft: seed?.draft ?? "",
    rigor: seed?.rigor ?? "balanced",
    messages: [],
  };
}

function loadThreads() {
  if (typeof window === "undefined") return [createThread()];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length === 0) return [createThread()];

    return parsed.map((thread) => ({
      id: typeof thread.id === "string" ? thread.id : createId(),
      title: typeof thread.title === "string" && thread.title.trim() ? thread.title : "New chat",
      createdAt:
        typeof thread.createdAt === "string" ? thread.createdAt : new Date().toISOString(),
      updatedAt:
        typeof thread.updatedAt === "string" ? thread.updatedAt : new Date().toISOString(),
      draft: typeof thread.draft === "string" ? thread.draft : "",
      rigor: thread.rigor === "rigorous" ? "rigorous" : "balanced",
      messages: Array.isArray(thread.messages)
        ? thread.messages.map((message: Record<string, unknown>) => ({
            id: typeof message.id === "string" ? message.id : createId(),
            role: message.role === "assistant" ? "assistant" : "user",
            text: typeof message.text === "string" ? message.text : "",
            createdAt:
              typeof message.createdAt === "string"
                ? message.createdAt
                : new Date().toISOString(),
            topology:
              message.topology === "fast" ||
              message.topology === "think" ||
              message.topology === "discover"
                ? message.topology
                : undefined,
            rigor:
              message.rigor === "balanced" || message.rigor === "rigorous"
                ? message.rigor
                : undefined,
            latency: typeof message.latency === "number" ? message.latency : undefined,
            error: message.error === true,
            status: isMessageStatus(message.status)
              ? message.status
              : message.role === "assistant"
                ? "final"
                : undefined,
            responseToId:
              typeof message.responseToId === "string" ? message.responseToId : undefined,
          }))
        : [],
    })) as ChatThread[];
  } catch {
    return [createThread()];
  }
}

function formatThreadTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value)
  );
}

function splitBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const pattern = /```([\w-]+)?\n([\s\S]*?)```/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      const copy = text.slice(cursor, index).trim();
      if (copy) blocks.push({ type: "text", content: copy });
    }
    blocks.push({ type: "code", language: match[1]?.trim() || undefined, content: match[2] ?? "" });
    cursor = index + match[0].length;
  }

  const tail = text.slice(cursor).trim();
  if (tail) blocks.push({ type: "text", content: tail });
  return blocks.length > 0 ? blocks : [{ type: "text", content: text }];
}

function persistThreadsToStorage(threads: ChatThread[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

function serializeMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));
}

function getLastUserMessageId(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return messages[index].id;
    }
  }

  return null;
}

function syncThreadUrl(threadId: string | null, mode: "push" | "replace") {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set("chat", threadId);
  else url.searchParams.delete("chat");
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

function resizeComposer(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
}

function MessageContent({ text }: { text: string }) {
  return (
    <div className="hydra-message-content">
      {splitBlocks(text).map((block, index) =>
        block.type === "code" ? (
          <div className="hydra-code" key={`${block.language ?? "text"}-${index}`}>
            <div className="hydra-code-head">{block.language ?? "text"}</div>
            <pre>
              <code>{block.content}</code>
            </pre>
          </div>
        ) : (
          <p className="hydra-text" key={`text-${index}`}>
            {block.content}
          </p>
        )
      )}
    </div>
  );
}

export default function HydraChatApp() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sendingThreadId, setSendingThreadId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null;
  const orderedThreads = [...threads].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );

  useEffect(() => {
    const initialThreads = loadThreads();
    const requestedThreadId = new URLSearchParams(window.location.search).get("chat");
    const nextActiveThreadId =
      requestedThreadId && initialThreads.some((thread) => thread.id === requestedThreadId)
        ? requestedThreadId
        : initialThreads[0]?.id ?? null;

    setThreads(initialThreads);
    setActiveThreadId(nextActiveThreadId);
    setHydrated(true);
    syncThreadUrl(nextActiveThreadId, "replace");
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    persistThreadsToStorage(threads);
  }, [hydrated, threads]);

  useEffect(() => {
    resizeComposer(composerRef.current);
  }, [activeThread?.draft, activeThreadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeThread?.messages.length, activeThreadId, sendingThreadId]);

  const setDraft = (draft: string) => {
    if (!activeThread) return;
    setThreads((current) =>
      current.map((thread) => (thread.id === activeThread.id ? { ...thread, draft } : thread))
    );
  };

  const setRigor = (rigor: Rigor) => {
    if (!activeThread) return;
    const now = new Date().toISOString();
    setThreads((current) =>
      current.map((thread) =>
        thread.id === activeThread.id ? { ...thread, rigor, updatedAt: now } : thread
      )
    );
  };

  const createNewThread = (draft = "") => {
    const nextThread = createThread({ draft });
    startTransition(() => {
      setThreads((current) => [nextThread, ...current]);
      setActiveThreadId(nextThread.id);
    });
    syncThreadUrl(nextThread.id, "push");
  };

  const selectThread = (threadId: string) => {
    if (threadId === activeThreadId) return;
    startTransition(() => setActiveThreadId(threadId));
    syncThreadUrl(threadId, "push");
  };

  const deleteThread = (threadId: string) => {
    if (sendingThreadId === threadId) return;

    let nextActiveThreadId: string | null = activeThreadId;
    setThreads((current) => {
      const remaining = current.filter((thread) => thread.id !== threadId);
      if (remaining.length === 0) {
        const replacement = createThread();
        nextActiveThreadId = replacement.id;
        return [replacement];
      }
      if (threadId === activeThreadId) nextActiveThreadId = remaining[0]?.id ?? null;
      return remaining;
    });
    setActiveThreadId(nextActiveThreadId);
    syncThreadUrl(nextActiveThreadId, "replace");
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1200);
    } catch {}
  };

  const startFollowup = async (args: {
    threadId: string;
    assistantMessageId: string;
    responseToId: string;
    topology: Topology;
    rigor: Rigor;
    draft: string;
    messages: ChatMessage[];
  }) => {
    const { threadId, assistantMessageId, responseToId, topology, rigor, draft, messages } = args;
    const refiningAt = new Date().toISOString();

    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              updatedAt: refiningAt,
              messages: thread.messages.map((message) =>
                message.id === assistantMessageId ? { ...message, status: "refining" } : message
              ),
            }
          : thread
      )
    );

    try {
      const res = await fetch("/api/chat/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: serializeMessages(messages),
          draft,
          topology,
          rigor,
        }),
      });
      const data = await res.json();
      const finishedAt = new Date().toISOString();

      setThreads((current) =>
        current.map((thread) => {
          if (thread.id !== threadId) return thread;
          if (getLastUserMessageId(thread.messages) !== responseToId) return thread;
          if (!thread.messages.some((message) => message.id === assistantMessageId)) return thread;

          const nextText =
            typeof data.content === "string" && data.content.trim() ? data.content : draft;
          const nextStatus: MessageStatus =
            res.ok && data.metadata?.status !== "fallback" ? "final" : "fallback";

          return {
            ...thread,
            updatedAt: finishedAt,
            messages: thread.messages.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    text: nextText,
                    topology,
                    rigor,
                    latency:
                      typeof data.metadata?.latencyMs === "number"
                        ? data.metadata.latencyMs
                        : message.latency,
                    status: nextStatus,
                    error: !res.ok,
                  }
                : message
            ),
          };
        })
      );
    } catch {
      const failedAt = new Date().toISOString();
      setThreads((current) =>
        current.map((thread) => {
          if (thread.id !== threadId) return thread;
          if (getLastUserMessageId(thread.messages) !== responseToId) return thread;
          if (!thread.messages.some((message) => message.id === assistantMessageId)) return thread;

          return {
            ...thread,
            updatedAt: failedAt,
            messages: thread.messages.map((message) =>
              message.id === assistantMessageId
                ? { ...message, status: "fallback", error: true }
                : message
            ),
          };
        })
      );
    }
  };

  const send = async () => {
    if (!activeThread || sendingThreadId) return;
    const text = activeThread.draft.trim();
    if (!text) return;

    const now = new Date().toISOString();
    const userMessage: ChatMessage = { id: createId(), role: "user", text, createdAt: now };
    const outgoingMessages = [...activeThread.messages, userMessage];
    const threadId = activeThread.id;
    const rigor = activeThread.rigor;

    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              title:
                thread.messages.length === 0 || thread.title === "New chat"
                  ? deriveTitle(text)
                  : thread.title,
              draft: "",
              updatedAt: now,
              messages: outgoingMessages,
            }
          : thread
      )
    );
    setSendingThreadId(threadId);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: serializeMessages(outgoingMessages),
          rigor,
        }),
      });
      const data = await res.json();
      const finishedAt = new Date().toISOString();
      const topology = data.metadata?.topology as Topology | undefined;
      const nextRigor = (data.metadata?.rigor as Rigor | undefined) ?? rigor;
      const apiStatus = data.metadata?.status;
      const assistantStatus: MessageStatus = res.ok
        ? apiStatus === "draft"
          ? "draft"
          : apiStatus === "fallback"
            ? "fallback"
            : "final"
        : "fallback";
      const assistantMessageId = createId();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        text:
          typeof data.content === "string" && data.content.trim()
            ? data.content
            : data.error ?? "Something went wrong. Please try again.",
        createdAt: finishedAt,
        topology,
        rigor: nextRigor,
        latency: data.metadata?.latencyMs as number | undefined,
        status: assistantStatus,
        responseToId: userMessage.id,
        error: !res.ok,
      };

      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                updatedAt: finishedAt,
                messages: [...thread.messages, assistantMessage],
              }
            : thread
        )
      );

      if (
        res.ok &&
        assistantStatus === "draft" &&
        data.metadata?.needsFollowup === true &&
        topology &&
        topology !== "fast"
      ) {
        void startFollowup({
          threadId,
          assistantMessageId,
          responseToId: userMessage.id,
          topology,
          rigor: nextRigor,
          draft: assistantMessage.text,
          messages: outgoingMessages,
        });
      }
    } catch {
      const failedAt = new Date().toISOString();
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                updatedAt: failedAt,
                messages: [
                  ...thread.messages,
                  {
                    id: createId(),
                    role: "assistant",
                    text: "Connection error. Please check your network and try again.",
                    createdAt: failedAt,
                    rigor,
                    status: "fallback",
                    error: true,
                  },
                ],
              }
            : thread
        )
      );
    } finally {
      setSendingThreadId((current) => (current === threadId ? null : current));
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="hydra-app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; } body { margin: 0; background: radial-gradient(circle at top left, rgba(96,165,250,.08), transparent 28%), radial-gradient(circle at bottom right, rgba(245,158,11,.08), transparent 24%), #09090b; color: #f8fafc; font-family: 'IBM Plex Mono', monospace; } button, textarea { font: inherit; } ::selection { background: rgba(96,165,250,.24); color: #fff; }
        .hydra-app { min-height: 100vh; padding: 16px; } .hydra-shell { min-height: calc(100vh - 32px); display: grid; grid-template-columns: 300px minmax(0,1fr); gap: 16px; } .hydra-sidebar, .hydra-main { border: 1px solid #23262d; background: linear-gradient(180deg, rgba(17,18,20,.95), rgba(10,12,15,.96)); box-shadow: 0 18px 48px rgba(0,0,0,.35); } .hydra-sidebar { border-radius: 22px; padding: 18px; display: flex; flex-direction: column; gap: 16px; min-height: 0; } .hydra-main { border-radius: 24px; display: grid; grid-template-rows: auto minmax(0,1fr) auto; min-height: 0; overflow: hidden; }
        .hydra-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; } .hydra-brand { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; } .hydra-muted { color: #8b93a7; font-size: 11px; line-height: 1.7; } .hydra-btn, .hydra-icon, .hydra-thread, .hydra-chip-btn, .hydra-toggle button, .hydra-action { transition: background .16s ease, border-color .16s ease, transform .16s ease; }
        .hydra-btn, .hydra-icon, .hydra-action { border: 1px solid #31353f; background: #17181c; color: #f8fafc; border-radius: 12px; cursor: pointer; } .hydra-btn { padding: 10px 12px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; } .hydra-icon { width: 34px; height: 34px; color: #8b93a7; } .hydra-btn:hover, .hydra-icon:hover, .hydra-action:hover, .hydra-thread:hover, .hydra-chip-btn:hover, .hydra-toggle button:hover { transform: translateY(-1px); border-color: rgba(96,165,250,.45); }
        .hydra-thread-list { display: flex; flex-direction: column; gap: 10px; overflow: auto; min-height: 0; } .hydra-thread-item { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; } .hydra-thread { border: 1px solid #2b313b; background: #0d0f12; border-radius: 16px; padding: 14px; text-align: left; cursor: pointer; } .hydra-thread.is-active { border-color: rgba(96,165,250,.45); background: linear-gradient(180deg, rgba(23,29,38,.94), rgba(13,16,21,.96)); } .hydra-thread-title { display: block; color: #f8fafc; font-size: 12px; line-height: 1.55; margin-bottom: 8px; } .hydra-thread-meta { display: flex; flex-wrap: wrap; gap: 8px; color: #8b93a7; font-size: 10px; }
        .hydra-head, .hydra-compose { padding: 18px 22px; } .hydra-head { border-bottom: 1px solid #23262d; } .hydra-title { margin: 0; font-size: 15px; font-weight: 600; } .hydra-pills { display: flex; flex-wrap: wrap; gap: 8px; } .hydra-pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; border: 1px solid #31353f; background: #111214; color: #c5c9d3; font-size: 10px; letter-spacing: .07em; text-transform: uppercase; }
        .hydra-scroll { min-height: 0; overflow: auto; padding: 22px; display: flex; flex-direction: column; gap: 14px; } .hydra-empty { min-height: 100%; display: grid; place-items: center; } .hydra-empty-card { width: min(760px,100%); border: 1px solid #2b313b; border-radius: 24px; padding: 28px; background: linear-gradient(180deg, rgba(19,22,27,.95), rgba(11,13,16,.96)); } .hydra-kicker { color: #60a5fa; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; margin-bottom: 12px; } .hydra-empty h2 { margin: 0; font-size: clamp(24px,4vw,34px); line-height: 1.18; letter-spacing: -.04em; } .hydra-empty-copy { margin: 16px 0 22px; color: #c5c9d3; font-size: 13px; line-height: 1.8; max-width: 58ch; }
        .hydra-chip-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; } .hydra-chip-btn { border: 1px solid #2b313b; background: #0d0f12; color: #c5c9d3; border-radius: 18px; padding: 14px 16px; text-align: left; cursor: pointer; min-height: 92px; } .hydra-chip-label { display: block; color: #8b93a7; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 10px; }
        .hydra-message { display: flex; } .hydra-message.user { justify-content: flex-end; } .hydra-card { max-width: min(840px,88%); border-radius: 22px; padding: 14px 16px; border: 1px solid transparent; background: transparent; } .hydra-message.user .hydra-card { background: linear-gradient(180deg, rgba(19,23,30,.96), rgba(15,18,24,.96)); border-color: rgba(96,165,250,.22); } .hydra-message.assistant .hydra-card { background: rgba(12,14,17,.55); border-color: rgba(49,53,63,.52); } .hydra-message.error .hydra-card { background: rgba(68,24,24,.26); border-color: rgba(248,113,113,.38); }
        .hydra-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: #8b93a7; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; } .hydra-meta-left, .hydra-meta-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } .hydra-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px; background: #111214; border: 1px solid #31353f; color: #c5c9d3; font-size: 9px; } .hydra-action { background: transparent; color: #8b93a7; padding: 6px 10px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
        .hydra-message-content { display: flex; flex-direction: column; gap: 12px; } .hydra-text { margin: 0; white-space: pre-wrap; word-break: break-word; color: #c5c9d3; font-size: 13px; line-height: 1.8; } .hydra-note { margin: 0; font-size: 11px; line-height: 1.7; } .hydra-message.user .hydra-text { color: #f8fafc; } .hydra-code { border-radius: 16px; overflow: hidden; border: 1px solid #31353f; background: #090a0d; } .hydra-code-head { padding: 8px 12px; color: #8b93a7; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; border-bottom: 1px solid #31353f; } .hydra-code pre { margin: 0; padding: 14px; overflow: auto; color: #e2e8f0; font-size: 12px; line-height: 1.65; }
        .hydra-compose { border-top: 1px solid #23262d; display: flex; flex-direction: column; gap: 14px; background: linear-gradient(180deg, rgba(14,16,20,.84), rgba(10,11,14,.94)); } .hydra-toggle { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid #31353f; border-radius: 999px; background: #0d0f12; } .hydra-toggle button { border: none; background: transparent; color: #c5c9d3; padding: 7px 12px; border-radius: 999px; cursor: pointer; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; } .hydra-toggle button.is-active { background: #f8fafc; color: #09090b; }
        .hydra-frame { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: end; border: 1px solid #31353f; border-radius: 22px; background: rgba(10,12,15,.92); padding: 14px; } .hydra-composer { width: 100%; min-height: 44px; max-height: 220px; resize: none; border: none; outline: none; background: transparent; color: #f8fafc; font-size: 13px; line-height: 1.75; } .hydra-composer::placeholder { color: #8b93a7; } .hydra-send { width: 46px; height: 46px; border-radius: 16px; border: 1px solid #31353f; background: #f8fafc; color: #09090b; cursor: pointer; } .hydra-send:disabled, .hydra-btn:disabled, .hydra-icon:disabled { cursor: not-allowed; opacity: .5; transform: none; } .hydra-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: #8b93a7; font-size: 10px; line-height: 1.7; }
        @media (max-width: 960px) { .hydra-app { padding: 12px; } .hydra-shell { min-height: calc(100vh - 24px); grid-template-columns: 1fr; } .hydra-thread-list { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px,1fr); overflow-x: auto; overflow-y: hidden; } .hydra-chip-grid { grid-template-columns: 1fr; } }
        @media (max-width: 640px) { .hydra-head, .hydra-compose { padding: 16px; } .hydra-scroll { padding: 16px; } .hydra-card { max-width: 100%; } .hydra-frame { grid-template-columns: 1fr; } .hydra-send { width: 100%; } }
      `}</style>

      <div className="hydra-shell">
        <aside className="hydra-sidebar">
          <div className="hydra-row">
            <div>
              <div className="hydra-brand">Hydra</div>
              <div className="hydra-muted">multi-model chat workspace</div>
            </div>
            <button className="hydra-btn" type="button" onClick={() => createNewThread()}>
              New chat
            </button>
          </div>

          <div className="hydra-muted">
            Conversations now persist locally in this browser, so Hydra behaves more like an actual
            chat app and less like a single test pane.
          </div>

          <div className="hydra-thread-list" aria-label="Conversations">
            {orderedThreads.map((thread) => (
              <div className="hydra-thread-item" key={thread.id}>
                <button
                  className={`hydra-thread${thread.id === activeThread?.id ? " is-active" : ""}`}
                  type="button"
                  onClick={() => selectThread(thread.id)}
                >
                  <span className="hydra-thread-title">{thread.title}</span>
                  <div className="hydra-thread-meta">
                    <span>{thread.messages.length} msgs</span>
                    <span>{thread.rigor}</span>
                    <span>{formatThreadTime(thread.updatedAt)}</span>
                    {thread.id === sendingThreadId && <span>sending</span>}
                  </div>
                </button>
                <button
                  className="hydra-icon"
                  type="button"
                  aria-label={`Delete ${thread.title}`}
                  disabled={thread.id === sendingThreadId}
                  onClick={() => deleteThread(thread.id)}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="hydra-main">
          <header className="hydra-head">
            <div className="hydra-row">
              <div>
                <h1 className="hydra-title">{activeThread?.title ?? "Hydra"}</h1>
                <div className="hydra-muted">
                  {activeThread
                    ? `${activeThread.messages.length} messages in this thread. ${RIGOR_COPY[activeThread.rigor]}`
                    : "Loading your workspace..."}
                </div>
              </div>
              {activeThread && (
                <div className="hydra-pills">
                  <span className="hydra-pill">thread {activeThread.id.slice(0, 8)}</span>
                  <span className="hydra-pill">updated {formatThreadTime(activeThread.updatedAt)}</span>
                </div>
              )}
            </div>
          </header>

          <main className="hydra-scroll">
            {!hydrated || !activeThread ? (
              <div className="hydra-empty">
                <div className="hydra-empty-card">
                  <div className="hydra-kicker">Loading</div>
                  <h2>Rehydrating your chat workspace.</h2>
                </div>
              </div>
            ) : activeThread.messages.length === 0 ? (
              <div className="hydra-empty">
                <div className="hydra-empty-card">
                  <div className="hydra-kicker">Conversation Ready</div>
                  <h2>This is the start of a real chat app, not a test interface.</h2>
                  <p className="hydra-empty-copy">
                    Threads persist locally, rigor belongs to each conversation, and the layout is
                    built for longer sessions. Pick a prompt below or start typing.
                  </p>
                  <div className="hydra-chip-grid">
                    {STARTER_PROMPTS.map((prompt, index) => (
                      <button className="hydra-chip-btn" key={prompt} type="button" onClick={() => setDraft(prompt)}>
                        <span className="hydra-chip-label">Prompt {index + 1}</span>
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {activeThread.messages.map((message) => (
                  <article className={`hydra-message ${message.role}${message.error ? " error" : ""}`} key={message.id}>
                    <div className="hydra-card">
                      <div className="hydra-meta">
                        <div className="hydra-meta-left">
                          <span>{message.role === "user" ? "You" : "Hydra"}</span>
                          <span>{formatMessageTime(message.createdAt)}</span>
                          {message.topology && (
                            <span className="hydra-badge" style={{ color: TOPOLOGY_COLOR[message.topology], borderColor: `${TOPOLOGY_COLOR[message.topology]}55` }}>
                              {message.topology}
                            </span>
                          )}
                          {message.rigor && <span className="hydra-badge">{message.rigor}</span>}
                          {message.latency != null && <span className="hydra-badge">{(message.latency / 1000).toFixed(1)}s</span>}
                          {message.role === "assistant" && message.status && message.status !== "final" && (
                            <span className="hydra-badge" style={{ color: STATUS_COLOR[message.status], borderColor: `${STATUS_COLOR[message.status]}55` }}>
                              {message.status}
                            </span>
                          )}
                          {message.error && <span className="hydra-badge" style={{ color: "#f87171", borderColor: "rgba(248,113,113,.4)" }}>error</span>}
                        </div>
                        {message.role === "assistant" && (
                          <div className="hydra-meta-right">
                            <button className="hydra-action" type="button" onClick={() => void copyMessage(message)}>
                              {copiedMessageId === message.id ? "Copied" : "Copy"}
                            </button>
                          </div>
                        )}
                      </div>
                      <MessageContent text={message.text} />
                      {message.role === "assistant" && message.status && message.status !== "final" && (
                        <p className="hydra-note" style={{ color: STATUS_COLOR[message.status] }}>
                          {STATUS_COPY[message.status]}
                        </p>
                      )}
                    </div>
                  </article>
                ))}

                {sendingThreadId === activeThread.id && (
                  <article className="hydra-message assistant" aria-live="polite">
                    <div className="hydra-card">
                      <div className="hydra-meta">
                        <div className="hydra-meta-left">
                          <span>Hydra</span>
                          <span>drafting</span>
                          <span className="hydra-badge">{activeThread.rigor}</span>
                        </div>
                      </div>
                      <p className="hydra-text">Building a first-pass reply before the follow-up refinement step.</p>
                    </div>
                  </article>
                )}
              </>
            )}
            <div ref={endRef} />
          </main>

          <footer className="hydra-compose">
            <div className="hydra-row">
              <div className="hydra-toggle" role="group" aria-label="Thread rigor">
                {(["balanced", "rigorous"] as const).map((option) => (
                  <button className={activeThread?.rigor === option ? "is-active" : ""} key={option} type="button" onClick={() => setRigor(option)}>
                    {option}
                  </button>
                ))}
              </div>
              <div className="hydra-pills">
                <span className="hydra-pill">{RIGOR_COPY[activeThread?.rigor ?? "balanced"]}</span>
              </div>
            </div>

            <div className="hydra-frame">
              <textarea
                ref={composerRef}
                className="hydra-composer"
                value={activeThread?.draft ?? ""}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Message Hydra..."
                rows={1}
                disabled={!activeThread || sendingThreadId !== null}
              />
              <button className="hydra-send" type="button" onClick={() => void send()} disabled={!activeThread?.draft.trim() || sendingThreadId !== null}>
                Send
              </button>
            </div>

            <div className="hydra-footer">
              <span>Enter sends. Shift+Enter adds a new line. Conversations are stored locally in this browser for now.</span>
              <span>{sendingThreadId ? "Hydra is drafting..." : "Ready"}</span>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
