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
type TraceNodeStatus = "complete" | "partial";

interface MessageTraceNode {
  id: string;
  question: string;
  dependsOn: string[];
  answer: string;
  status: TraceNodeStatus;
}

interface MessageTrace {
  kind: "compound";
  nodes: MessageTraceNode[];
}

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
  trace?: MessageTrace;
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
  fast: "#a3a3a3",
  think: "#8ab4ff",
  discover: "#f6bd60",
};
const RIGOR_COPY: Record<Rigor, string> = {
  balanced: "Balanced keeps Hydra fast and flexible.",
  rigorous: "Rigorous adds a verification pass and tighter synthesis.",
};
const STATUS_COLOR: Record<Exclude<MessageStatus, "final">, string> = {
  draft: "#7dd3fc",
  refining: "#f6bd60",
  fallback: "#fb7185",
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

function getThreadPreview(thread: ChatThread) {
  const lastMessage = thread.messages[thread.messages.length - 1];
  if (!lastMessage) return "No messages yet";

  const collapsed = lastMessage.text.replace(/\s+/g, " ").trim();
  const prefix = lastMessage.role === "user" ? "You: " : "Hydra: ";
  const preview = collapsed || "No preview available";
  const combined = `${prefix}${preview}`;

  return combined.length > 78 ? `${combined.slice(0, 78).trimEnd()}...` : combined;
}

function isMessageStatus(value: unknown): value is MessageStatus {
  return (
    value === "draft" || value === "refining" || value === "final" || value === "fallback"
  );
}

function isTraceNodeStatus(value: unknown): value is TraceNodeStatus {
  return value === "complete" || value === "partial";
}

function parseMessageTrace(value: unknown): MessageTrace | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const record = value as Record<string, unknown>;
  if (record.kind !== "compound" || !Array.isArray(record.nodes)) return undefined;

  const nodes = record.nodes
    .map((node) => {
      if (typeof node !== "object" || node === null) return null;

      const item = node as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        typeof item.question !== "string" ||
        !Array.isArray(item.dependsOn) ||
        item.dependsOn.some((dependency) => typeof dependency !== "string") ||
        typeof item.answer !== "string" ||
        !isTraceNodeStatus(item.status)
      ) {
        return null;
      }

      return {
        id: item.id,
        question: item.question,
        dependsOn: item.dependsOn as string[],
        answer: item.answer,
        status: item.status,
      } satisfies MessageTraceNode;
    })
    .filter((node): node is MessageTraceNode => node !== null);

  if (nodes.length !== record.nodes.length) return undefined;

  return {
    kind: "compound",
    nodes,
  };
}

function summarizeTraceAnswer(answer: string) {
  const collapsed = answer.replace(/\s+/g, " ").trim();
  if (!collapsed) return "No subproblem answer was captured.";
  return collapsed.length > 220 ? `${collapsed.slice(0, 220).trimEnd()}...` : collapsed;
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
            trace: parseMessageTrace(message.trace),
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
  const [expandedTraceMessageId, setExpandedTraceMessageId] = useState<string | null>(null);
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

  useEffect(() => {
    setExpandedTraceMessageId(null);
  }, [activeThreadId]);

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

  const toggleTrace = (messageId: string) => {
    setExpandedTraceMessageId((current) => (current === messageId ? null : messageId));
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
      const nextTrace = parseMessageTrace(data.metadata?.trace);

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
                    trace: nextTrace ?? message.trace,
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
      const nextTrace = parseMessageTrace(data.metadata?.trace);
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
        trace: nextTrace,
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
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: #181818;
          color: #ececec;
          font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        }
        button, textarea { font: inherit; }
        ::selection { background: rgba(16, 163, 127, 0.3); color: #f5f5f5; }
        .hydra-app {
          min-height: 100vh;
          padding: 12px;
          background: #181818;
        }
        .hydra-shell {
          min-height: calc(100vh - 24px);
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr);
          border: 1px solid #2d2d2d;
          border-radius: 18px;
          background: #212121;
          overflow: hidden;
        }
        .hydra-sidebar {
          display: flex;
          flex-direction: column;
          min-height: 0;
          padding: 18px;
          gap: 16px;
          background: #171717;
          border-right: 1px solid #2a2a2a;
        }
        .hydra-main {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          min-height: 0;
          background: #212121;
        }
        .hydra-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .hydra-brand {
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
          color: #f5f5f5;
        }
        .hydra-muted {
          color: #a1a1aa;
          font-size: 13px;
          line-height: 1.6;
        }
        .hydra-section-title {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #7c7c85;
        }
        .hydra-btn,
        .hydra-thread,
        .hydra-thread-delete,
        .hydra-chip-btn,
        .hydra-toggle button,
        .hydra-action,
        .hydra-send {
          transition: background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
        }
        .hydra-btn,
        .hydra-thread-delete,
        .hydra-action,
        .hydra-send {
          border: 1px solid #383838;
          background: #2a2a2a;
          color: #f3f4f6;
          border-radius: 12px;
          cursor: pointer;
        }
        .hydra-btn {
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 600;
        }
        .hydra-btn:hover,
        .hydra-thread-delete:hover,
        .hydra-action:hover,
        .hydra-send:hover,
        .hydra-thread:hover,
        .hydra-chip-btn:hover,
        .hydra-toggle button:hover {
          border-color: #4a4a4a;
          background: #323232;
          box-shadow: none;
        }
        .hydra-btn-primary {
          background: #10a37f;
          border-color: #10a37f;
          color: #ffffff;
        }
        .hydra-btn-primary:hover {
          background: #0e8f70;
          border-color: #0e8f70;
        }
        .hydra-thread-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow: auto;
          min-height: 0;
        }
        .hydra-thread-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: start;
        }
        .hydra-thread {
          border: 1px solid #2f2f2f;
          background: #1f1f1f;
          border-radius: 14px;
          padding: 14px;
          text-align: left;
          cursor: pointer;
        }
        .hydra-thread.is-active {
          border-color: #454545;
          background: #2a2a2a;
        }
        .hydra-thread-title {
          display: block;
          color: #f5f5f5;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.45;
          margin-bottom: 6px;
        }
        .hydra-thread-snippet {
          display: block;
          color: #9ca3af;
          font-size: 12px;
          line-height: 1.55;
          margin-bottom: 8px;
        }
        .hydra-thread-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          color: #7c7c85;
          font-size: 11px;
        }
        .hydra-thread-delete {
          padding: 8px 10px;
          font-size: 12px;
          color: #a1a1aa;
          background: transparent;
          border-color: transparent;
        }
        .hydra-head,
        .hydra-compose {
          padding: 20px 24px;
          background: #212121;
        }
        .hydra-head {
          border-bottom: 1px solid #2a2a2a;
        }
        .hydra-title {
          margin: 0;
          font-size: 20px;
          line-height: 1.25;
          font-weight: 700;
          color: #f5f5f5;
        }
        .hydra-subtitle {
          margin: 6px 0 0;
          color: #a1a1aa;
          font-size: 13px;
          line-height: 1.6;
        }
        .hydra-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .hydra-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid #353535;
          background: #262626;
          color: #c4c4cc;
          font-size: 12px;
          line-height: 1.2;
        }
        .hydra-scroll {
          min-height: 0;
          overflow: auto;
          padding: 24px;
        }
        .hydra-conversation {
          width: min(820px, 100%);
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .hydra-empty {
          min-height: 100%;
          display: grid;
          place-items: center;
        }
        .hydra-empty-card {
          width: min(720px, 100%);
          border: none;
          border-radius: 0;
          padding: 12px 0;
          background: transparent;
          box-shadow: none;
        }
        .hydra-kicker {
          color: #10a37f;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.4;
          margin-bottom: 10px;
        }
        .hydra-empty h2 {
          margin: 0;
          font-size: clamp(28px, 4vw, 36px);
          line-height: 1.2;
          letter-spacing: -0.03em;
          color: #f5f5f5;
        }
        .hydra-empty-copy {
          margin: 14px 0 22px;
          color: #a1a1aa;
          font-size: 15px;
          line-height: 1.7;
          max-width: 58ch;
        }
        .hydra-chip-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .hydra-chip-btn {
          border: 1px solid #2f2f2f;
          background: #262626;
          color: #f3f4f6;
          border-radius: 16px;
          padding: 14px 16px;
          text-align: left;
          cursor: pointer;
          min-height: 88px;
        }
        .hydra-chip-label {
          display: block;
          color: #9ca3af;
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .hydra-message {
          display: flex;
        }
        .hydra-message.user {
          justify-content: flex-end;
        }
        .hydra-card {
          width: min(100%, 760px);
          border-radius: 18px;
          padding: 18px 0;
          border: none;
          background: transparent;
          box-shadow: none;
        }
        .hydra-message.user .hydra-card {
          width: min(78%, 680px);
          padding: 14px 16px;
          background: #303030;
          border: 1px solid #3a3a3a;
        }
        .hydra-message.error .hydra-card {
          padding: 14px 16px;
          background: #3a1f24;
          border: 1px solid #6b2c35;
        }
        .hydra-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
          color: #8f8f97;
          font-size: 12px;
          line-height: 1.5;
        }
        .hydra-meta-left,
        .hydra-meta-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .hydra-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          background: #262626;
          border: 1px solid #363636;
          color: #c4c4cc;
          font-size: 11px;
          line-height: 1.2;
        }
        .hydra-action {
          background: #262626;
          color: #d4d4d8;
          padding: 7px 10px;
          font-size: 12px;
        }
        .hydra-message-content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .hydra-text {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          color: #ececec;
          font-size: 15px;
          line-height: 1.75;
        }
        .hydra-note {
          margin: 12px 0 0;
          font-size: 13px;
          line-height: 1.6;
        }
        .hydra-trace {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid #2a2a2a;
        }
        .hydra-trace-toggle {
          border: none;
          background: transparent;
          padding: 0;
          color: #10a37f;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .hydra-trace-toggle:hover {
          color: #34d399;
        }
        .hydra-trace-panel {
          margin-top: 12px;
          display: grid;
          gap: 10px;
        }
        .hydra-trace-node {
          padding: 12px;
          border-radius: 14px;
          border: 1px solid #343434;
          background: #262626;
        }
        .hydra-trace-head {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .hydra-trace-id {
          font-size: 12px;
          font-weight: 700;
          color: #f5f5f5;
        }
        .hydra-trace-question {
          margin: 0 0 8px;
          color: #f3f4f6;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.5;
        }
        .hydra-trace-answer {
          margin: 0;
          color: #b6b6bf;
          font-size: 13px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .hydra-code {
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid #303030;
          background: #171717;
        }
        .hydra-code-head {
          padding: 8px 12px;
          color: #9ca3af;
          font-size: 11px;
          font-weight: 600;
          border-bottom: 1px solid #2c2c2c;
          background: #202020;
        }
        .hydra-code pre {
          margin: 0;
          padding: 14px;
          overflow: auto;
          color: #ececec;
          font-size: 13px;
          line-height: 1.65;
        }
        .hydra-compose {
          border-top: 1px solid #2a2a2a;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .hydra-toggle {
          display: inline-flex;
          gap: 4px;
          padding: 4px;
          border: 1px solid #303030;
          border-radius: 999px;
          background: #171717;
        }
        .hydra-toggle button {
          border: none;
          background: transparent;
          color: #9ca3af;
          padding: 8px 12px;
          border-radius: 999px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
        }
        .hydra-toggle button.is-active {
          background: #2b2b2b;
          color: #f5f5f5;
          box-shadow: none;
        }
        .hydra-frame {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: end;
          border: 1px solid #383838;
          border-radius: 24px;
          background: #2b2b2b;
          padding: 12px 14px;
        }
        .hydra-composer {
          width: 100%;
          min-height: 52px;
          max-height: 220px;
          resize: none;
          border: none;
          outline: none;
          background: transparent;
          color: #f5f5f5;
          font-size: 15px;
          line-height: 1.7;
        }
        .hydra-composer::placeholder {
          color: #8b8b95;
        }
        .hydra-send {
          min-width: 84px;
          height: 44px;
          border-radius: 999px;
          border: 1px solid #10a37f;
          background: #10a37f;
          color: #ffffff;
          font-weight: 600;
        }
        .hydra-send:hover {
          background: #0e8f70;
          border-color: #0e8f70;
        }
        .hydra-send:disabled,
        .hydra-btn:disabled,
        .hydra-thread-delete:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          box-shadow: none;
        }
        .hydra-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          color: #7c7c85;
          font-size: 12px;
          line-height: 1.6;
        }
        @media (max-width: 1080px) {
          .hydra-shell { grid-template-columns: 260px minmax(0, 1fr); }
        }
        @media (max-width: 960px) {
          .hydra-app { padding: 12px; }
          .hydra-shell { min-height: calc(100vh - 24px); grid-template-columns: 1fr; }
          .hydra-sidebar { border-right: none; border-bottom: 1px solid #2a2a2a; }
          .hydra-thread-list {
            display: grid;
            grid-auto-flow: column;
            grid-auto-columns: minmax(240px, 1fr);
            overflow-x: auto;
            overflow-y: hidden;
          }
          .hydra-chip-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .hydra-head, .hydra-compose, .hydra-sidebar, .hydra-scroll { padding: 16px; }
          .hydra-row { align-items: flex-start; flex-direction: column; }
          .hydra-thread-item { grid-template-columns: 1fr; }
          .hydra-frame { grid-template-columns: 1fr; }
          .hydra-send { width: 100%; }
          .hydra-card { width: 100%; }
        }
      `}</style>

      <div className="hydra-shell">
        <aside className="hydra-sidebar">
          <div className="hydra-row">
            <div>
              <div className="hydra-brand">Hydra</div>
              <div className="hydra-muted">AI chat workspace</div>
            </div>
            <button className="hydra-btn" type="button" onClick={() => createNewThread()}>
              New chat
            </button>
          </div>

          <div className="hydra-section-title">Chats</div>

          <div className="hydra-muted">
            Conversations are stored locally in this browser. Longer answers can refine
            automatically after the first draft arrives.
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
                  <span className="hydra-thread-snippet">{getThreadPreview(thread)}</span>
                  <div className="hydra-thread-meta">
                    <span>{thread.messages.length} messages</span>
                    <span>{thread.rigor}</span>
                    <span>{formatThreadTime(thread.updatedAt)}</span>
                    {thread.id === sendingThreadId && <span>sending</span>}
                  </div>
                </button>
                <button
                  className="hydra-thread-delete"
                  type="button"
                  aria-label={`Delete ${thread.title}`}
                  disabled={thread.id === sendingThreadId}
                  onClick={() => deleteThread(thread.id)}
                >
                  Delete
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
                <p className="hydra-subtitle">
                  {activeThread
                    ? `${activeThread.messages.length} messages in this thread. ${RIGOR_COPY[activeThread.rigor]}`
                    : "Loading your workspace..."}
                </p>
              </div>
              {activeThread && (
                <div className="hydra-pills">
                  <span className="hydra-pill">updated {formatThreadTime(activeThread.updatedAt)}</span>
                  <span className="hydra-pill">{activeThread.rigor}</span>
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
                  <div className="hydra-kicker">New conversation</div>
                  <h2>Start a chat with Hydra.</h2>
                  <p className="hydra-empty-copy">
                    Ask a question, paste a problem, or choose one of the starter prompts below to
                    begin.
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
              <div className="hydra-conversation">
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
                      {message.role === "assistant" &&
                        message.trace?.kind === "compound" &&
                        message.trace.nodes.length > 0 && (
                          <div className="hydra-trace">
                            <button
                              className="hydra-trace-toggle"
                              type="button"
                              onClick={() => toggleTrace(message.id)}
                            >
                              {expandedTraceMessageId === message.id
                                ? "Hide reasoning trace"
                                : "Reasoning trace"}
                            </button>
                            {expandedTraceMessageId === message.id && (
                              <div className="hydra-trace-panel">
                                {message.trace.nodes.map((node) => (
                                  <div className="hydra-trace-node" key={`${message.id}-${node.id}`}>
                                    <div className="hydra-trace-head">
                                      <span className="hydra-trace-id">Node {node.id}</span>
                                      <span className="hydra-badge">{node.status}</span>
                                      {node.dependsOn.length > 0 && (
                                        <span className="hydra-badge">
                                          depends on {node.dependsOn.join(", ")}
                                        </span>
                                      )}
                                    </div>
                                    <p className="hydra-trace-question">{node.question}</p>
                                    <p className="hydra-trace-answer">
                                      {summarizeTraceAnswer(node.answer)}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
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
                      <p className="hydra-text">
                        Building a first-pass reply before any follow-up refinement step.
                      </p>
                    </div>
                  </article>
                )}
              </div>
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
              <span>Enter sends. Shift+Enter adds a new line.</span>
              <span>
                {sendingThreadId
                  ? "Hydra is drafting..."
                  : "Follow-up refinement runs automatically when needed."}
              </span>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
