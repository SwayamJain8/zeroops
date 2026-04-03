import { Router, Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../db/supabase";
import { getAppRunnerLogs, getRecentErrors } from "../services/logs";

const router = Router();

router.get(
  "/:projectId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const projectId = req.params.projectId as string;
    const errorsOnly = req.query.errors === "true";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("app_runner_service_arn, user_id")
      .eq("id", projectId)
      .eq("user_id", req.userId!)
      .single();

    if (error || !project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!project.app_runner_service_arn) {
      res.json({ logs: [], message: "No deployment found — deploy first to see logs." });
      return;
    }

    try {
      const logs = errorsOnly
        ? await getRecentErrors(project.app_runner_service_arn, limit)
        : await getAppRunnerLogs(project.app_runner_service_arn, false, limit);

      res.json({ logs });
    } catch (err: any) {
      res.status(500).json({ error: `Failed to fetch logs: ${err.message}` });
    }
  }
);

export default router;
