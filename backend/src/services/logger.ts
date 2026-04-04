type LogLevel = "INFO" | "WARN" | "ERROR";

function now() {
  return new Date().toISOString();
}

function format(level: LogLevel, scope: string, message: string) {
  return `[${now()}] [${level}] [${scope}] ${message}`;
}

export const logger = {
  info(scope: string, message: string) {
    console.log(format("INFO", scope, message));
  },
  warn(scope: string, message: string) {
    console.warn(format("WARN", scope, message));
  },
  error(scope: string, message: string, error?: unknown) {
    console.error(format("ERROR", scope, message));
    if (error) {
      const details = error instanceof Error ? error.stack || error.message : String(error);
      console.error(format("ERROR", scope, `Details: ${details}`));
    }
  },
};

