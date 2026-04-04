import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../db/supabase";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  accessToken?: string;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const queryToken =
    typeof req.query.token === "string" && req.query.token.trim()
      ? req.query.token.trim()
      : null;
  const token = bearerToken || queryToken;
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.userId = user.id;
  req.userEmail = user.email;
  req.accessToken = token;
  next();
}
