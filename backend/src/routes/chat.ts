import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../db/supabase";
import { runAgent } from "../services/agent";
import { logger } from "../services/logger";

const router = Router();

router.post(
  "/:projectId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const projectId = req.params.projectId as string;
    const { message } = req.body;
    logger.info("CHAT", `Message received for project=${projectId} user=${req.userId}`);

    if (!message || typeof message !== "string") {
      logger.warn("CHAT", "Rejected chat request: missing or invalid message");
      res.status(400).json({ error: "Message is required" });
      return;
    }

    // Verify project ownership
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", req.userId!)
      .single();

    if (error || !project) {
      logger.warn("CHAT", `Project not found/unauthorized for chat: ${projectId}`);
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sendEvent = (type: string, data: any) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    await runAgent(projectId, req.userId!, message, {
      onText(text) {
        sendEvent("text", { content: text });
      },
      onToolCall(name, args) {
        logger.info("CHAT_TOOL", `Tool call: ${name} for project=${projectId}`);
        sendEvent("tool_call", { tool: name, args });
      },
      onToolResult(name, result) {
        logger.info("CHAT_TOOL", `Tool result: ${name} completed`);
        sendEvent("tool_result", { tool: name, result });
      },
      onDone(fullText) {
        logger.info("CHAT", `Response completed for project=${projectId} (${fullText.length} chars)`);
        sendEvent("done", { content: fullText });
        res.end();
      },
      onError(error) {
        logger.error("CHAT", `Agent failed for project=${projectId}`, error);
        sendEvent("error", { message: error.message });
        res.end();
      },
    });
  }
);

router.get(
  "/:projectId/history",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const projectId = req.params.projectId as string;
    logger.info("CHAT_HISTORY", `History requested for project=${projectId} user=${req.userId}`);

    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      logger.error("CHAT_HISTORY", `Failed to fetch history for project=${projectId}`, error);
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ messages: data });
  }
);

export default router;
