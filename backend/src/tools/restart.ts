import { supabaseAdmin } from "../db/supabase";
import { restartEc2Container } from "../services/ec2Deployer";

export const restartToolDefinition = {
  name: "restart_service",
  description:
    "Restart the deployed service without rebuilding. Use this when the user wants to restart their app or when a simple restart might fix the issue.",
  parameters: {
    type: "object" as const,
    properties: {
      projectId: {
        type: "string",
        description: "The project ID to restart",
      },
    },
    required: ["projectId"],
  },
};

export async function executeRestart(projectId: string): Promise<string> {
  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .select("app_runner_service_arn, name, slug")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    return "Error: Project not found.";
  }

  if (!project.app_runner_service_arn) {
    return `Project "${project.name}" has not been deployed yet. Deploy it first.`;
  }

  try {
    await restartEc2Container(project.slug);
    return `Service for "${project.name}" is restarting. This typically takes a few seconds.`;
  } catch (err: any) {
    return `Failed to restart service: ${err.message}`;
  }
}
