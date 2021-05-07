import * as crypto from "crypto";

export function hash(data: string): string {
  return crypto.createHash("md5").update(data).digest("hex");
}
