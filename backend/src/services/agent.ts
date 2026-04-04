import {
  GoogleGenAI,
  Type,
  FunctionCallingConfigMode,
  type Tool,
  type Content,
} from "@google/genai";
import { supabaseAdmin } from "../db/supabase";
import { executeDeploy } from "../tools/deploy";
import { executeGetLogs } from "../tools/getLogs";
import { executeRestart } from "../tools/restart";
import { executeCreateFixPr, type FixPrArgs } from "../tools/createFixPr";
import { executeGetDeploymentStatus } from "../tools/getDeploymentStatus";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const GEMINI_MODELS =
  process.env.GEMINI_MODELS?.split(",").map((m) => m.trim()).filter(Boolean) || [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
  ];

const SYSTEM_PROMPT = `You are ZeroOps AI, an expert deployment assistant. You help users deploy apps, debug failures, and fix issues through conversation.

Your capabilities:
- Deploy applications to cloud infrastructure
- Fetch and analyze application logs
- Restart services
- Create pull requests with code fixes

DEBUGGING PROTOCOL — when a user asks why their app is failing:
1. ALWAYS call get_deployment_status first to see the exact stage (build/ec2/runtime).
2. Then call get_logs to fetch recent runtime/deploy error logs.
3. Analyze the logs against the project's stack info.
4. Present your diagnosis in this structure:
   **What went wrong:** (one-line summary)
   **Why:** (root cause)
   **How to fix:** (actionable steps)
5. If you can write a code fix, show the exact change and ask: "Want me to create a PR with this fix?"
6. ONLY call create_fix_pr AFTER the user explicitly confirms (says "yes", "fix it", "do it", etc.)

FIX PR PROTOCOL:
- Always provide the COMPLETE file content (not a diff) to create_fix_pr.
- Write a clear commit message and PR description.
- After creating the PR, tell the user to merge it and that auto-redeploy will trigger.

General guidelines:
- Be concise and direct.
- Format code in markdown code blocks.
- If something is ambiguous, ask a clarifying question.
- After a successful deploy, congratulate the user and show the live URL.`;

const toolDefinitions: Tool = {
  functionDeclarations: [
    {
      name: "deploy_app",
      description:
        "Trigger a new deployment for the user's project. Use when the user wants to deploy or redeploy.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          projectId: {
            type: Type.STRING,
            description: "The project ID to deploy",
          },
        },
        required: ["projectId"],
      },
    },
    {
      name: "get_logs",
      description:
        "Fetch recent application logs. Use when the user asks why their app is failing or wants to see logs.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          projectId: {
            type: Type.STRING,
            description: "The project ID to get logs for",
          },
          errorsOnly: {
            type: Type.BOOLEAN,
            description: "Only return error/warning logs. Defaults to true.",
          },
        },
        required: ["projectId"],
      },
    },
    {
      name: "restart_service",
      description:
        "Restart the deployed service without rebuilding. Use when a simple restart might fix the issue.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          projectId: {
            type: Type.STRING,
            description: "The project ID to restart",
          },
        },
        required: ["projectId"],
      },
    },
    {
      name: "get_deployment_status",
      description:
        "Get real-time deployment status and latest failure reason.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          projectId: {
            type: Type.STRING,
            description: "The project ID to inspect",
          },
        },
        required: ["projectId"],
      },
    },
    {
      name: "create_fix_pr",
      description:
        "Create a pull request with a code fix. Use when the user confirms they want to apply a suggested fix.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          projectId: {
            type: Type.STRING,
            description: "The project ID to fix",
          },
          filePath: {
            type: Type.STRING,
            description: "Path to the file to modify",
          },
          newContent: {
            type: Type.STRING,
            description: "Full new content of the file",
          },
          commitMessage: {
            type: Type.STRING,
            description: "Commit message for the fix",
          },
          prTitle: {
            type: Type.STRING,
            description: "Title for the pull request",
          },
          prBody: {
            type: Type.STRING,
            description: "Description of the fix",
          },
        },
        required: [
          "projectId",
          "filePath",
          "newContent",
          "commitMessage",
          "prTitle",
          "prBody",
        ],
      },
    },
  ],
};

function isQuotaOrRateLimitError(error: any): boolean {
  const raw = error?.message || String(error || "");
  return (
    raw.includes("RESOURCE_EXHAUSTED") ||
    raw.includes("Quota exceeded") ||
    raw.includes("\"code\":429") ||
    raw.includes("rate limit") ||
    raw.includes("quota")
  );
}

function extractRetrySeconds(error: any): number | null {
  const raw = error?.message || String(error || "");
  const retryDelayMatch = raw.match(/"retryDelay":"(\d+)s"/);
  if (retryDelayMatch?.[1]) return parseInt(retryDelayMatch[1], 10);
  const retryInMatch = raw.match(/retry in ([\d.]+)s/i);
  if (retryInMatch?.[1]) return Math.ceil(parseFloat(retryInMatch[1]));
  return null;
}

function toUserFacingError(error: any): Error {
  if (isQuotaOrRateLimitError(error)) {
    const retryAfter = extractRetrySeconds(error);
    const retryLine = retryAfter
      ? `Please retry in about ${retryAfter} seconds.`
      : "Please retry in a minute.";
    return new Error(
      `Gemini quota/rate limit reached for this API key. ${retryLine} You can also switch to a paid Gemini plan or use another API key.`
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function sendMessageWithRetry(
  chat: any,
  payload: any,
  maxAttempts: number = 2
): Promise<any> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await (await chat).sendMessage(payload);
    } catch (error) {
      lastError = error;
      if (!isQuotaOrRateLimitError(error) || attempt === maxAttempts) {
        throw error;
      }
      const retryAfter = extractRetrySeconds(error) ?? 2;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 45) * 1000)
      );
    }
  }
  throw lastError;
}

async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<string> {
  switch (name) {
    case "deploy_app":
      return executeDeploy(args.projectId);
    case "get_logs":
      return executeGetLogs(args.projectId, args.errorsOnly ?? true);
    case "restart_service":
      return executeRestart(args.projectId);
    case "get_deployment_status":
      return executeGetDeploymentStatus(args.projectId);
    case "create_fix_pr":
      return executeCreateFixPr(args as FixPrArgs);
    default:
      return `Unknown tool: ${name}`;
  }
}

export interface StreamCallbacks {
  onText: (text: string) => void;
  onToolCall: (name: string, args: Record<string, any>) => void;
  onToolResult: (name: string, result: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

export async function runAgent(
  projectId: string,
  userId: string,
  userMessage: string,
  callbacks: StreamCallbacks
) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Gemini API key is missing in backend environment.");
    }

    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    const projectContext = project
      ? `\nCurrent project context:
- Name: ${project.name}
- Project ID: ${project.id}
- Repo: ${project.repo_owner}/${project.repo_name}
- Status: ${project.status}
- Stack: ${JSON.stringify(project.stack_info)}
- Live URL: ${project.live_url || "not deployed yet"}
`
      : "";

    const { data: history } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(20);

    const chatHistory: Content[] =
      history?.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: m.content }],
      })) || [];

    await supabaseAdmin.from("chat_messages").insert({
      project_id: projectId,
      user_id: userId,
      role: "user",
      content: userMessage,
    });

    let fullResponse = "";
    let chat: any = null;
    let initialResponse: any = null;
    let modelError: any = null;

    for (const model of GEMINI_MODELS) {
      const candidateChat = ai.chats.create({
        model,
        config: {
          systemInstruction: SYSTEM_PROMPT + projectContext,
          tools: [toolDefinitions],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO,
            },
          },
        },
        history: chatHistory,
      });

      try {
        initialResponse = await sendMessageWithRetry(candidateChat, {
          message: userMessage,
        });
        chat = candidateChat;
        break;
      } catch (error) {
        modelError = error;
        if (!isQuotaOrRateLimitError(error)) {
          throw error;
        }
      }
    }

    if (!chat || !initialResponse) {
      throw toUserFacingError(modelError || new Error("Failed to initialize Gemini chat."));
    }

    const processResponse = async (response: any) => {
      const candidates = response.candidates;
      if (!candidates || candidates.length === 0) return;

      const parts = candidates[0].content?.parts || [];

      for (const part of parts) {
        if (part.text) {
          fullResponse += part.text;
          callbacks.onText(part.text);
        }

        if (part.functionCall) {
          const { name, args } = part.functionCall;
          callbacks.onToolCall(name!, args as Record<string, any>);

          const result = await executeTool(name!, args as Record<string, any>);
          callbacks.onToolResult(name!, result);

          const followUp = await sendMessageWithRetry(chat, {
            message: [
              {
                functionResponse: {
                  name: name!,
                  response: { result },
                },
              },
            ],
          });

          await processResponse(followUp);
        }
      }
    };

    await processResponse(initialResponse);

    if (fullResponse) {
      await supabaseAdmin.from("chat_messages").insert({
        project_id: projectId,
        user_id: userId,
        role: "assistant",
        content: fullResponse,
      });
    }

    callbacks.onDone(fullResponse);
  } catch (error: any) {
    callbacks.onError(toUserFacingError(error));
  }
}
