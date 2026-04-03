import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../db/supabase";
import { runAgent } from "../services/agent";

const router = Router();

router.post(
  "/:projectId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const projectId = req.params.projectId as string;
    const { message } = req.body;

    if (!message || typeof message !== "string") {
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
        sendEvent("tool_call", { tool: name, args });
      },
      onToolResult(name, result) {
        sendEvent("tool_result", { tool: name, result });
      },
      onDone(fullText) {
        sendEvent("done", { content: fullText });
        res.end();
      },
      onError(error) {
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

    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", req.userId!)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ messages: data });
  }
);

export default router;
