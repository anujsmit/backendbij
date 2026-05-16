import axios from "axios";
import { db } from "../db";
import { smsLogs } from "../db/schema";

export type SmsType =
  | "otp_login"
  | "otp_phone_change"
  | "otp_account_deletion"
  | "otp_admin"
  | "service_accepted"
  | "service_completed"
  | "mistri_approved";

export const sendSms = async (to: string, message: string, type: SmsType) => {
  const token = process.env.SPARROW_SMS_TOKEN;
  const sender = process.env.SPARROW_SMS_SENDER;

  if (!token || !sender) {
    throw new Error("Sparrow SMS credentials are not configured");
  }

  const url = "https://api.sparrowsms.com/v2/sms/";

  const params = new URLSearchParams();
  params.append("token", token);
  params.append("from", sender);
  params.append("to", to);
  params.append("text", message);

  try {
    await axios.get(url, { params });
    await db.insert(smsLogs).values({ to, type, status: "success" }).catch(() => {});
  } catch (error) {
    await db.insert(smsLogs).values({ to, type, status: "failed" }).catch(() => {});
    console.error("Failed to send SMS:", error);
    throw new Error("Failed to send SMS");
  }
};
