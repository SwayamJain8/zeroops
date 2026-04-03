"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";
import {
  MessageSquare,
  Send,
  Loader2,
  Bot,
  User,
  Wrench,
} from "lucide-react";

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

export default function ChatPanel({ projectId, token }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

    const assistantMsg: DisplayMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

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
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.isStreaming) {
                  last.content += event.content;
                }
                return updated;
              });
            }

            if (event.type === "tool_call") {
              const toolMsg: DisplayMessage = {
                id: `tool-${Date.now()}`,
                role: "tool",
                content: `Calling ${event.tool}...`,
                toolName: event.tool,
              };
              setMessages((prev) => {
                const streaming = prev.filter((m) => m.isStreaming);
                const rest = prev.filter((m) => !m.isStreaming);
                return [...rest, toolMsg, ...streaming];
              });
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
              setMessages((prev) =>
                prev.map((m) =>
                  m.isStreaming ? { ...m, isStreaming: false } : m
                )
              );
            }

            if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.isStreaming
                    ? {
                        ...m,
                        content: `Error: ${event.message}`,
                        isStreaming: false,
                      }
                    : m
                )
              );
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.isStreaming
            ? {
                ...m,
                content: `Error: ${err.message || "Failed to send message"}`,
                isStreaming: false,
              }
            : m
        )
      );
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border shrink-0">
        <h2 className="font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Chat
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Ask about your deployment, debug errors, or request fixes.
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loadingHistory ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
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
                  className="block mx-auto px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer"
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
      <div className="p-4 border-t border-border shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your deployment..."
            rows={1}
            className="flex-1 px-3 py-2.5 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-3 py-2.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer shrink-0"
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Wrench className="w-3 h-3" />
        <span>{message.content}</span>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-accent text-accent-foreground"
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5" />
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
