import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";

const region = process.env.AWS_REGION || "us-east-1";
const ec2InstanceId = process.env.EC2_INSTANCE_ID!;
const ec2PublicHost = process.env.EC2_PUBLIC_HOST!;
const accountId = process.env.AWS_ACCOUNT_ID!;

const ssm = new SSMClient({ region });

async function runCommandOnEc2(commands: string[]): Promise<string> {
  const { Command } = await ssm.send(
    new SendCommandCommand({
      InstanceIds: [ec2InstanceId],
      DocumentName: "AWS-RunShellScript",
      Parameters: { commands },
      TimeoutSeconds: 300,
    })
  );

  const commandId = Command!.CommandId!;

  // Poll for completion
  let attempts = 0;
  while (attempts < 60) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const result = await ssm.send(
        new GetCommandInvocationCommand({
          CommandId: commandId,
          InstanceId: ec2InstanceId,
        })
      );

      if (result.Status === "Success") {
        return result.StandardOutputContent || "";
      }
      if (result.Status === "Failed" || result.Status === "Cancelled") {
        const errOutput = result.StandardErrorContent || "Unknown error";
        throw new Error(`EC2 command failed: ${errOutput}`);
      }
    } catch (err: any) {
      if (err.name === "InvocationDoesNotExist") {
        // Not ready yet
      } else if (err.message?.includes("EC2 command failed")) {
        throw err;
      }
    }
    attempts++;
  }

  throw new Error("EC2 command timed out");
}

async function getExistingContainerPort(
  containerName: string
): Promise<number | null> {
  const output = await runCommandOnEc2([
    `docker ps --filter name=^/${containerName}$ --format "{{.Ports}}"`,
  ]);
  // Example: 0.0.0.0:3005->3000/tcp, :::3005->3000/tcp
  const match = output.match(/:(\d+)->3000\/tcp/);
  return match ? parseInt(match[1], 10) : null;
}

async function findFreePort(start: number = 3001, end: number = 3100): Promise<number> {
  const output = await runCommandOnEc2([
    `docker ps --format "{{.Ports}}"`,
  ]);
  const used = new Set<number>();
  const matches = output.matchAll(/:(\d+)->/g);
  for (const m of matches) used.add(parseInt(m[1], 10));

  for (let p = start; p <= end; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error(`No free ports available in range ${start}-${end}`);
}

export async function deployToEc2(
  slug: string,
  ecrUri: string,
  imageTag: string,
  envVars: { key: string; value: string }[]
): Promise<{ port: number; url: string }> {
  const imageFullUri = `${ecrUri}:${imageTag}`;
  const containerName = `zeroops-${slug}`;
  const existingPort = await getExistingContainerPort(containerName);
  const port = existingPort ?? (await findFreePort(3001, 3100));

  const envFlags = envVars
    .map((v) => `-e ${v.key}="${v.value}"`)
    .join(" ");

  const commands = [
    // Login to ECR
    `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${accountId}.dkr.ecr.${region}.amazonaws.com`,
    // Pull the image
    `docker pull ${imageFullUri}`,
    // Stop and remove existing container for this project
    `docker stop ${containerName} 2>/dev/null || true`,
    `docker rm ${containerName} 2>/dev/null || true`,
    // Run the new container
    `docker run -d --name ${containerName} --restart unless-stopped -p ${port}:3000 -e PORT=3000 ${envFlags} ${imageFullUri}`,
    // Verify it's running
    `docker ps --filter name=${containerName} --format "{{.Status}}"`,
  ];

  const output = await runCommandOnEc2(commands);
  console.log(`[EC2] Deploy output for ${slug}:`, output);

  const url = `http://${ec2PublicHost}:${port}`;
  return { port, url };
}

export async function restartEc2Container(slug: string): Promise<void> {
  const containerName = `zeroops-${slug}`;
  await runCommandOnEc2([`docker restart ${containerName}`]);
}

export async function stopEc2Container(slug: string): Promise<void> {
  const containerName = `zeroops-${slug}`;
  await runCommandOnEc2([
    `docker stop ${containerName} 2>/dev/null || true`,
    `docker rm ${containerName} 2>/dev/null || true`,
  ]);
}

export async function getEc2ContainerLogs(
  slug: string,
  lines: number = 50
): Promise<string> {
  const containerName = `zeroops-${slug}`;
  return runCommandOnEc2([`docker logs --tail ${lines} ${containerName} 2>&1`]);
}
