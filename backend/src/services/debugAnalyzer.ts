import { GoogleGenAI } from "@google/genai";
import { StackInfo } from "./analyzer";
import { LogEntry } from "./logs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface DiagnosisResult {
  whatWentWrong: string;
  why: string;
  howToFix: string;
  suggestedFile: string | null;
  suggestedFix: string | null;
  confidence: "high" | "medium" | "low";
}

export async function analyzeFailure(
  logs: LogEntry[],
  stackInfo: StackInfo,
  repoOwner: string,
  repoName: string
): Promise<DiagnosisResult> {
  const logsText = logs
    .map(
      (l) =>
        `[${l.level.toUpperCase()}] ${l.message}`
    )
    .join("\n");

  const prompt = `You are a deployment debugging expert. Analyze these application logs and provide a structured diagnosis.

Stack info: ${JSON.stringify(stackInfo)}
Repository: ${repoOwner}/${repoName}

Logs:
${logsText}

Respond ONLY with valid JSON in this exact format:
{
  "whatWentWrong": "Brief description of the error",
  "why": "Root cause explanation",
  "howToFix": "Step-by-step fix instructions",
  "suggestedFile": "file path to modify (or null if unknown)",
  "suggestedFix": "the actual code fix content (or null if complex)",
  "confidence": "high | medium | low"
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  const text = response.text || "";

  try {
    return JSON.parse(text);
  } catch {
    return {
      whatWentWrong: "Could not automatically diagnose the issue.",
      why: "The error pattern was not recognized.",
      howToFix: "Please share the logs and I can help manually.",
      suggestedFile: null,
      suggestedFix: null,
      confidence: "low",
    };
  }
}
