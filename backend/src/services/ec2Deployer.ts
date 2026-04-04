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
        const out = (result.StandardOutputContent || "").trim();
        const err = (result.StandardErrorContent || "").trim();
        const details = [out ? `STDOUT:\n${out}` : "", err ? `STDERR:\n${err}` : ""]
          .filter(Boolean)
          .join("\n\n");
        throw new Error(`EC2 command failed.\n${details || "No output returned by SSM command."}`);
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
  // Example: 0.0.0.0:3005->3000/tcp, :::3005->3000/tcp or ->5000/tcp
  const match = output.match(/:(\d+)->\d+\/tcp/);
  return match ? parseInt(match[1], 10) : null;
}

async function findFreePort(start: number = 3001, end: number = 3100): Promise<number> {
  const output = await runCommandOnEc2([
    // Check both Docker published ports and any host listener (ss) to avoid bind collisions.
    `docker ps --format "{{.Ports}}"; ss -ltnH | awk '{print $4}'`,
  ]);
  const used = new Set<number>();
  const matches = output.matchAll(/:(\d+)(?:->|\s|$)/g);
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
  envVars: { key: string; value: string }[],
  healthPath: string = "/"
): Promise<{ port: number; url: string }> {
  const imageFullUri = `${ecrUri}:${imageTag}`;
  const containerName = `zeroops-${slug}`;
  const existingPort = await getExistingContainerPort(containerName);
  const port = existingPort ?? (await findFreePort(3001, 3100));

  // Reserve PORT for deployment runtime mapping; user-provided PORT can break container startup.
  const userEnvVars = envVars.filter(
    (v) => v.key.trim().toUpperCase() !== "PORT"
  );
  const envFlags = userEnvVars
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
    `INTERNAL_PORT=3000; HOST_PORT=${port}; RUN_ERR=/tmp/zeroops-run-${containerName}.err; rm -f "$RUN_ERR"; for _ in 1 2 3 4 5 6 7 8 9 10; do docker run -d --name ${containerName} --restart unless-stopped -p $HOST_PORT:$INTERNAL_PORT ${envFlags} -e PORT=$INTERNAL_PORT ${imageFullUri} 2>"$RUN_ERR" && break; if grep -qi "port is already allocated" "$RUN_ERR"; then HOST_PORT=$((HOST_PORT+1)); continue; fi; cat "$RUN_ERR"; exit 1; done; if [ ! -z "$RUN_ERR" ] && [ -s "$RUN_ERR" ] && grep -qi "port is already allocated" "$RUN_ERR"; then echo "RUN_FAILED_AFTER_PORT_RETRIES"; cat "$RUN_ERR"; exit 1; fi; echo "ASSIGNED_HOST_PORT=$HOST_PORT"`,
    // Verify container process is running
    `docker ps --filter name=${containerName} --format "{{.Status}}"`,
    // Verify app health before marking deployment success
    `probe_http() {
      PATH_TO_CHECK="$1";
      CODE="$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${'$'}HOST_PORT${'$'}PATH_TO_CHECK" || true)";
      if [ "${'$'}CODE" != "000" ]; then
        echo "HTTP_ALIVE code=${'$'}CODE path=${'$'}PATH_TO_CHECK";
        return 0;
      fi;
      return 1;
    };
    for i in $(seq 1 30); do
      probe_http "${healthPath}" && echo "HEALTH_OK" && exit 0;
      [ "${healthPath}" != "/" ] && probe_http "/" && echo "HEALTH_OK_FALLBACK_ROOT" && exit 0;
      STATUS="$(docker ps --filter name=^/${containerName}$ --format "{{.Status}}")";
      if [ -z "${'$'}STATUS" ]; then
        echo "CONTAINER_EXITED_BEFORE_HEALTHCHECK";
        echo "LAST_CONTAINER_STATE:";
        docker ps -a --filter name=^/${containerName}$ --format "{{.Status}}";
        echo "CONTAINER_LOGS_START";
        docker logs --tail 200 ${containerName} 2>&1 || true;
        echo "CONTAINER_LOGS_END";
        exit 1;
      fi;
      sleep 2;
    done;
    DETECTED_PORT="$(docker logs --tail 200 ${containerName} 2>&1 | sed -n 's/.*\\(localhost\\|0\\.0\\.0\\.0\\|127\\.0\\.0\\.1\\):\\([0-9][0-9]*\\).*/\\2/p' | tail -n 1)";
    if [ -n "${'$'}DETECTED_PORT" ] && [ "${'$'}DETECTED_PORT" != "3000" ]; then
      echo "DETECTED_APP_PORT=${'$'}DETECTED_PORT. Retrying with corrected container port mapping.";
      docker stop ${containerName} 2>/dev/null || true;
      docker rm ${containerName} 2>/dev/null || true;
      docker run -d --name ${containerName} --restart unless-stopped -p ${'$'}HOST_PORT:${'$'}DETECTED_PORT ${envFlags} -e PORT=${'$'}DETECTED_PORT ${imageFullUri};
      for i in $(seq 1 20); do
        probe_http "${healthPath}" && echo "HEALTH_OK_AFTER_PORT_REMAP" && exit 0;
        [ "${healthPath}" != "/" ] && probe_http "/" && echo "HEALTH_OK_AFTER_PORT_REMAP_FALLBACK_ROOT" && exit 0;
        sleep 2;
      done;
    fi;
    echo "HEALTHCHECK_TIMEOUT_OR_FAILED";
    echo "TARGET=http://127.0.0.1:${'$'}HOST_PORT${healthPath}";
    if [ -n "${'$'}DETECTED_PORT" ]; then echo "DETECTED_APP_PORT=${'$'}DETECTED_PORT"; fi;
    echo "LAST_CONTAINER_STATE:";
    docker ps -a --filter name=^/${containerName}$ --format "{{.Status}}";
    echo "CONTAINER_LOGS_START";
    docker logs --tail 200 ${containerName} 2>&1 || true;
    echo "CONTAINER_LOGS_END";
    exit 1`,
  ];

  const output = await runCommandOnEc2(commands);
  console.log(`[EC2] Deploy output for ${slug}:`, output);

  const assignedPortMatch = output.match(/ASSIGNED_HOST_PORT=(\d+)/);
  const finalPort = assignedPortMatch ? parseInt(assignedPortMatch[1], 10) : port;
  const url = `http://${ec2PublicHost}:${finalPort}`;
  return { port: finalPort, url };
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
