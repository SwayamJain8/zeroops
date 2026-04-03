import { Router, Request, Response } from "express";
import crypto from "crypto";
import { supabaseAdmin } from "../db/supabase";
import { addDeployJob } from "../queue/deployQueue";

const router = Router();

function verifyGithubSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

router.post(
  "/github",
  async (req: Request, res: Response) => {
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    // Raw body for signature verification — express.raw or string
    let rawBody: string;
    if (typeof req.body === "string") {
      rawBody = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString("utf-8");
    } else {
      rawBody = JSON.stringify(req.body);
    }

    if (webhookSecret) {
      const sig = req.headers["x-hub-signature-256"] as string | undefined;
      if (!verifyGithubSignature(rawBody, sig, webhookSecret)) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const event = req.headers["x-github-event"] as string;
    let payload: any;
    try {
      payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    if (event === "push") {
      const repoFullName = payload.repository?.full_name;
      const branch = payload.ref?.replace("refs/heads/", "");

      if (!repoFullName || branch !== "main") {
        res.json({ message: "Ignored — not a push to main" });
        return;
      }

      const [owner, name] = repoFullName.split("/");

      // Find matching project
      const { data: projects } = await supabaseAdmin
        .from("projects")
        .select("*")
        .eq("repo_owner", owner)
        .eq("repo_name", name);

      if (!projects || projects.length === 0) {
        res.json({ message: "No matching project found" });
        return;
      }

      // Trigger redeploy for each matching project
      for (const project of projects) {
        if (project.status === "building") continue;

        const { data: deployment } = await supabaseAdmin
          .from("deployments")
          .insert({ project_id: project.id, status: "queued" })
          .select()
          .single();

        if (deployment) {
          await supabaseAdmin
            .from("projects")
            .update({
              status: "building",
              updated_at: new Date().toISOString(),
            })
            .eq("id", project.id);

          const { data: user } = await supabaseAdmin
            .from("users")
            .select("github_access_token")
            .eq("id", project.user_id)
            .single();

          await addDeployJob({
            projectId: project.id,
            deploymentId: deployment.id,
            slug: project.slug,
            repoUrl: project.repo_url,
            stackInfo: project.stack_info,
            envVars: project.env_vars || [],
            githubToken: user?.github_access_token || undefined,
          });
        }
      }

      res.json({
        message: `Auto-redeploy triggered for ${projects.length} project(s)`,
      });
      return;
    }

    if (event === "ping") {
      res.json({ message: "Pong" });
      return;
    }

    res.json({ message: `Event ${event} ignored` });
  }
);

export default router;
