import { db } from "@/db";
import { seed } from "@/db/seed";

// Daily reset of the public demo (vercel.json cron). Vercel sends CRON_SECRET as a bearer token.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { ids } = await seed(db);
  return Response.json({ reset: true, employees: Object.keys(ids).length });
}
