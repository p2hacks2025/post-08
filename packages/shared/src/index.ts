import { z } from "zod";

export const HandwashEventSchema = z.object({
  familyId: z.string(),
  childId: z.string(),
  scene: z.enum(["home", "meal"]).optional(),
  durationSec: z.number().int().min(1).max(300),
  finishedAt: z.string() // ISO
});

export type HandwashEvent = z.infer<typeof HandwashEventSchema>;
