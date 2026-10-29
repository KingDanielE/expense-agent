import { isAbsolute, join } from "node:path";

/** Receipt paths are stored relative to the project root (bundled test receipts) or absolute (uploads). */
export const resolveFile = (p: string) => (isAbsolute(p) ? p : join(process.cwd(), p));
