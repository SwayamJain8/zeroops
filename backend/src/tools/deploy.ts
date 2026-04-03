import { supabaseAdmin } from "../db/supabase";
import { addDeployJob } from "../queue/deployQueue";

export const deployToolDefinition = {
  name: "deploy_app",
  description:
    "Trigger a new deployment for the user's project. Use this when the user wants to deploy or redeploy their app.",
  parameters: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        description: "The project ID to deploy",
      },
    },
    required: ["projectId"],
  },
};

export async function executeDeploy(projectId: string): Promise<string> {
  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    return "Error: Project not found.";
  }

  if (project.status === "building") {
    return "A deployment is already in progress. Please wait for it to complete.";
  }

  const { data: deployment, error: deployError } = await supabaseAdmin
    .from("deployments")
    .insert({ project_id: projectId, status: "queued" })
    .select()
    .single();

  if (deployError || !deployment) {
    return "Error: Failed to create deployment record.";
  }

  await supabaseAdmin
    .from("projects")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("id", projectId);

  // Get GitHub token for private repo cloning
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("github_access_token")
    .eq("id", project.user_id)
    .single();

  await addDeployJob({
    projectId,
    deploymentId: deployment.id,
    slug: project.slug,
    repoUrl: project.repo_url,
    stackInfo: project.stack_info,
    envVars: project.env_vars || [],
    githubToken: user?.github_access_token || undefined,
  });

  return `Deployment started! Deployment ID: ${deployment.id}. The build will take a few minutes. I'll let you know the status.`;
}
