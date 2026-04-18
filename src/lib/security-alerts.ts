import { createServiceClient } from "./supabase";

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const PAGERDUTY_KEY = process.env.PAGERDUTY_API_KEY;

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SecurityAlert {
  type: string;
  severity: AlertSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

const ALERT_THRESHOLDS = {
  auth_failed: { count: 5, windowMs: 5 * 60 * 1000 },
  rate_limit: { count: 3, windowMs: 60 * 1000 },
  audit_failure: { count: 2, windowMs: 60 * 1000 },
};

const alertStore: Record<string, { count: number; resetTime: number }> = {};

function getIP(req: Request): string {
  const headers = req.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0] ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function logSecurityAlert(alert: SecurityAlert): Promise<void> {
  const timestamp = Date.now();
  const key = `${alert.type}:${getIP(new Request("http://internal"))}`;

  if (!alertStore[key]) {
    alertStore[key] = { count: 0, resetTime: timestamp + 60000 };
  }

  alertStore[key].count++;

  const threshold = ALERT_THRESHOLDS[alert.type as keyof typeof ALERT_THRESHOLDS];
  if (threshold && alertStore[key].count > threshold.count) {
    alert.severity = "CRITICAL";
  }

  await sendToSlack(alert);

  if (alert.severity === "CRITICAL" && PAGERDUTY_KEY) {
    await pageOnCall(alert);
  }

  if (alertStore[key].resetTime < timestamp) {
    alertStore[key] = { count: 0, resetTime: timestamp + 60000 };
  }
}

async function sendToSlack(alert: SecurityAlert): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return;

  const severityEmoji = {
    CRITICAL: ":rotating_light:",
    HIGH: ":warning:",
    MEDIUM: ":large_blue_circle:",
    LOW: ":white_circle:",
  }[alert.severity];

  const payload = {
    text: `${severityEmoji} *Security Alert*`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${severityEmoji} Security Alert: ${alert.type}`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Severity:*\n${alert.severity}`,
          },
          {
            type: "mrkdwn",
            text: `*Type:*\n${alert.type}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Message:*\n${alert.message}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Timestamp: ${new Date().toISOString()}`,
          },
        ],
      },
    ],
  };

  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to send Slack alert:", error);
  }
}

async function pageOnCall(alert: SecurityAlert): Promise<void> {
  if (!PAGERDUTY_KEY) return;

  try {
    await fetch(`https://events.pagerduty.com/v2/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: PAGERDUTY_KEY,
        event_action: "trigger",
        payload: {
          summary: `[PetShop] ${alert.type}: ${alert.message}`,
          severity: alert.severity.toLowerCase(),
          source: "petshop-api",
          timestamp: new Date().toISOString(),
        },
      }),
    });
  } catch (error) {
    console.error("Failed to page on-call:", error);
  }
}

export async function trackAuthFailure(email: string, ip: string = "unknown"): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from("auth_failures").insert({
      email,
      ip_address: ip,
      attempted_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to track auth failure:", error);
  }
}

export async function checkAuthThreshold(ip: string): Promise<boolean> {
  const supabase = createServiceClient();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from("auth_failures")
    .select("*", { count: "exact", head: true })
    .eq("ip_address", ip)
    .gte("attempted_at", fiveMinutesAgo);

  if (count && count > 5) {
    await logSecurityAlert({
      type: "auth_failed_threshold",
      severity: "HIGH",
      message: `>5 failed auth attempts from IP ${ip} in 5 minutes`,
      metadata: { ip, count },
    });
    return true;
  }

  return false;
}