"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  MessageSquare,
  Send,
  Loader2,
  Bot,
  User,
  Wrench,
} from "lucide-react";
import LlmProviderSelector from "./LlmProviderSelector";

interface Props {
  projectId: string;
  token: string;
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
}

const mergeStreamText = (existing: string, incoming: string) => {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.endsWith(incoming) || existing.includes(incoming)) return existing;
  return `${existing}${incoming}`;
};

const toFriendlyError = (message?: string) => {
  const raw = (message || "").trim();
  if (!raw) return "ZeroOps Agent is temporarily unavailable. Please try again.";
  if (raw.toLowerCase().includes("quota") || raw.toLowerCase().includes("rate")) {
    return raw;
  }
  return "ZeroOps Agent hit a temporary issue. Please retry in a few seconds.";
};

export default function ChatPanel({ projectId, token }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeAssistantIdRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadHistory();
  }, [projectId]);

  const loadHistory = async () => {
    try {
      const data = await api(`/api/chat/${projectId}/history`, { token });
      const history: DisplayMessage[] = (data.messages || []).map(
        (m: ChatMessage) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })
      );
      setMessages(history);
    } catch {
      // Fresh chat
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setSending(true);

    const userMsg: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };

    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMsg: DisplayMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };
    activeAssistantIdRef.current = assistantMessageId;

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

      const response = await fetch(`${apiUrl}/api/chat/${projectId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) throw new Error("Chat request failed");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No response body");

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "text") {
              const chunk = typeof event.content === "string" ? event.content : "";
              const currentAssistantId = activeAssistantIdRef.current;
              if (!currentAssistantId) continue;
              setMessages((prev) => {
                return prev.map((msg) => {
                  if (msg.id !== currentAssistantId) return msg;
                  return {
                    ...msg,
                    content: mergeStreamText(msg.content, chunk),
                  };
                });
              });
            }

            if (event.type === "tool_call") {
              const toolMsg: DisplayMessage = {
                id: `tool-${Date.now()}-${event.tool}`,
                role: "tool",
                content: `Calling ${event.tool}...`,
                toolName: event.tool,
              };
              setMessages((prev) => [...prev, toolMsg]);
            }

            if (event.type === "tool_result") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.toolName === event.tool && m.role === "tool"
                    ? { ...m, content: `${event.tool}: Done` }
                    : m
                )
              );
            }

            if (event.type === "done") {
              const currentAssistantId = activeAssistantIdRef.current;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentAssistantId
                    ? {
                        ...m,
                        content: mergeStreamText(
                          m.content,
                          typeof event.content === "string" ? event.content : ""
                        ),
                        isStreaming: false,
                      }
                    : m
                )
              );
              activeAssistantIdRef.current = null;
            }

            if (event.type === "error") {
              const currentAssistantId = activeAssistantIdRef.current;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === currentAssistantId
                    ? {
                        ...m,
                        content: toFriendlyError(event.message),
                        isStreaming: false,
                      }
                    : m
                )
              );
              activeAssistantIdRef.current = null;
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err: any) {
      const currentAssistantId = activeAssistantIdRef.current;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentAssistantId
            ? {
                ...m,
                content: toFriendlyError(err?.message),
                isStreaming: false,
              }
            : m
        )
      );
      activeAssistantIdRef.current = null;
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
          Chat
          </h2>
          <LlmProviderSelector />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Ask about deployments, logs, and fixes.
        </p>
      </div>

      {/* Messages */}
      <div className="no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {loadingHistory ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 text-center">
            <Bot className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">
              Ask me anything about your deployment.
            </p>
            <div className="mt-4 space-y-2">
              {[
                "Why is my app failing?",
                "Deploy my app",
                "Show me the logs",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="mx-auto block cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand-violet/40 hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border p-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your deployment..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background/60 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="shrink-0 rounded-lg bg-primary px-3 py-2.5 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  if (message.role === "tool") {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <Wrench className="w-3 h-3" />
        <span>{message.content}</span>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-xl border px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "border-primary/20 bg-primary text-primary-foreground"
            : "border-border bg-accent/40 text-accent-foreground"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap wrap-break-word">{message.content}</div>
        ) : (
          <div className="space-y-2 wrap-break-word text-sm leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="my-2 whitespace-pre-wrap">{children}</p>,
                ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                code: ({ children }) => (
                  <code className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-xs">
                    {children}
                  </code>
                ),
                pre: ({ children }) => (
                  <pre className="my-2 overflow-x-auto rounded-lg border border-border/60 bg-background/70 p-3 text-xs">
                    {children}
                  </pre>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5" />
        )}
      </div>
      {isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
