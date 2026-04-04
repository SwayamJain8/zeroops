"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Terminal, RefreshCw, Filter, Loader2 } from "lucide-react";
import { GlassPanel } from "@/components/design/primitives";

interface LogEntry {
  timestamp: number;
  message: string;
  level: "error" | "warn" | "info";
}

interface Props {
  projectId: string;
  token: string;
}

const LEVEL_STYLES: Record<string, string> = {
  error: "text-red-400",
  warn: "text-yellow-400",
  info: "text-zinc-400",
};

export default function LogViewer({ projectId, token }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (errorsOnly) params.set("errors", "true");
      params.set("limit", "50");

      const data = await api(
        `/api/logs/${projectId}?${params.toString()}`,
        { token }
      );
      setLogs(data.logs);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [projectId, errorsOnly]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Application Logs
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setErrorsOnly(!errorsOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              errorsOnly
                ? "bg-destructive/20 text-destructive"
                : "bg-accent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Filter className="w-3 h-3" />
            {errorsOnly ? "Errors Only" : "All Logs"}
          </button>
          <button
            onClick={fetchLogs}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <GlassPanel className="overflow-hidden border-brand-violet/20">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-sm">
            {errorsOnly
              ? "No errors found."
              : "No logs available. Deploy your app first."}
          </div>
        ) : (
          <div className="max-h-[500px] overflow-x-auto overflow-y-auto font-mono text-xs leading-relaxed">
            {logs.map((log, i) => (
              <div
                key={i}
                className="flex gap-3 border-b border-zinc-900 px-4 py-1 hover:bg-zinc-900/50 last:border-0"
              >
                <span className="text-zinc-600 shrink-0 select-none tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={`shrink-0 w-12 text-right uppercase font-semibold ${LEVEL_STYLES[log.level]}`}
                >
                  {log.level}
                </span>
                <span className="text-zinc-300 whitespace-pre-wrap break-all">
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
