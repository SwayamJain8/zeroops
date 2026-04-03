import { supabaseAdmin } from "../db/supabase";

export const getDeploymentStatusToolDefinition = {
  name: "get_deployment_status",
  description:
    "Get latest deployment status, step, and failure reason for a project.",
  parameters: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        description: "The project ID to check deployment status for",
      },
    },
    required: ["projectId"],
  },
};

export async function executeGetDeploymentStatus(
  projectId: string
): Promise<string> {
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id,name,status,live_url,updated_at")
    .eq("id", projectId)
    .single();

  if (!project) return "Project not found.";

  const { data: deployment } = await supabaseAdmin
    .from("deployments")
    .select("id,status,error_message,started_at,finished_at")
    .eq("project_id", projectId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (!deployment) {
    return `Project "${project.name}" has no deployments yet.`;
  }

  let message = `Project: ${project.name}\nStatus: ${project.status}\nLatest deployment: ${deployment.status}\nStarted: ${deployment.started_at}`;
  if (deployment.finished_at) message += `\nFinished: ${deployment.finished_at}`;
  if (project.live_url) message += `\nLive URL: ${project.live_url}`;
  if (deployment.error_message) message += `\nFailure reason: ${deployment.error_message}`;

  return message;
}

