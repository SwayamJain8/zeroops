import { getEc2ContainerLogs } from "./ec2Deployer";

export interface LogEntry {
  timestamp: number;
  message: string;
  level: "error" | "warn" | "info";
}

const ERROR_PATTERNS = [
  /error/i, /exception/i, /fatal/i, /failed/i,
  /ENOENT/, /ECONNREFUSED/, /EACCES/,
  /Cannot find module/i, /TypeError/, /ReferenceError/, /SyntaxError/,
  /ModuleNotFoundError/, /ImportError/, /Traceback/,
  /exit code/i, /killed/i, /OOMKilled/i,
];

const WARN_PATTERNS = [/warn/i, /deprecat/i, /timeout/i, /retry/i];

function classifyLogLevel(message: string): "error" | "warn" | "info" {
  if (ERROR_PATTERNS.some((p) => p.test(message))) return "error";
  if (WARN_PATTERNS.some((p) => p.test(message))) return "warn";
  return "info";
}

export async function getAppRunnerLogs(
  serviceArnOrSlug: string,
  onlyErrors: boolean = false,
  limit: number = 50
): Promise<LogEntry[]> {
  // Extract slug from service ARN or ec2:slug format
  let slug = serviceArnOrSlug;
  if (serviceArnOrSlug.startsWith("ec2:")) {
    slug = serviceArnOrSlug.replace("ec2:", "");
  }

  try {
    const rawLogs = await getEc2ContainerLogs(slug, limit);
    const lines = rawLogs.split("\n").filter((l) => l.trim());

    const entries: LogEntry[] = lines.map((line) => ({
      timestamp: Date.now(),
      message: line.trim(),
      level: classifyLogLevel(line),
    }));

    if (onlyErrors) {
      return entries.filter((e) => e.level !== "info").slice(0, limit);
    }

    return entries.slice(0, limit);
  } catch (err: any) {
    if (err.message?.includes("No such container")) {
      return [];
    }
    throw err;
  }
}

export async function getRecentErrors(
  serviceArnOrSlug: string,
  limit: number = 20
): Promise<LogEntry[]> {
  return getAppRunnerLogs(serviceArnOrSlug, true, limit);
}
