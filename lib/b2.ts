import { createHash, createHmac } from "node:crypto";

const REGION = process.env.B2_REGION?.trim();
const KEY_ID = process.env.B2_APPLICATION_KEY_ID?.trim();
const APPLICATION_KEY = process.env.B2_APPLICATION_KEY?.trim();
const BUCKET = process.env.B2_BUCKET_NAME?.trim();

function config() {
  if (!REGION || !KEY_ID || !APPLICATION_KEY || !BUCKET) {
    throw new Error("Backblaze B2 is not configured. Set B2_REGION, B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, and B2_BUCKET_NAME.");
  }
  return { region: REGION, keyId: KEY_ID, applicationKey: APPLICATION_KEY, bucket: BUCKET };
}

function awsEncode(value: string) {
  return encodeURIComponent(value)
    .replaceAll("!", "%21")
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalQuery(params: Array<[string, string]>) {
  return params
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function createB2PresignedUrl(
  method: "GET" | "PUT" | "DELETE",
  key: string,
  expiresIn = 3600
) {
  const { region, keyId, applicationKey, bucket } = config();

  if (!/^[a-zA-Z0-9_-]+$/.test(bucket)) {
    throw new Error("Invalid B2 bucket name.");
  }

  if (!key || key.includes("..") || key.startsWith("/")) {
    throw new Error("Invalid B2 object key.");
  }

  const safeExpires = Math.max(1, Math.min(3600, Math.floor(expiresIn)));
  const host = `s3.${region}.backblazeb2.com`;
  const encodedKey = key.split("/").map(awsEncode).join("/");
  const canonicalUri = `/${awsEncode(bucket)}/${encodedKey}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const shortDate = amzDate.slice(0, 8);
  const credentialScope = `${shortDate}/${region}/s3/aws4_request`;

  const query = canonicalQuery([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${keyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(safeExpires)],
    ["X-Amz-SignedHeaders", "host"],
  ]);

  const canonicalRequest = [
    method,
    canonicalUri,
    query,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${applicationKey}`, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");

  const signature = createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  return `https://${host}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
}
