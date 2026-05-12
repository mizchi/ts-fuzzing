import * as v from "valibot";
import * as z from "zod";

export type ZodInstance = z.ZodString;
export type ZodObjectInstance = z.ZodObject<{ name: z.ZodString }>;
export type ValibotInstance = v.StringSchema<undefined>;

export const zodSchema = z.object({ name: z.string() });
export type ZodInferredObject = z.infer<typeof zodSchema>;
