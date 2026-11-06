import { z } from "zod";
import { catalog, categories } from "./catalog.js";

export const toolId = z.enum(catalog.map((tool) => tool.id));
export const schemas = Object.freeze({
  capabilities: z.object({ category: z.enum(categories).optional() }).strict(),
  discover: z.object({ toolId: toolId.optional() }).strict(),
  probe: z.object({ toolId }).strict(),
  recommend: z.object({ category: z.enum(categories) }).strict(),
});

export class InputError extends Error {
  constructor() {
    super("Invalid arguments");
    this.code = "INVALID_ARGUMENTS";
  }
}

export function validate(method, input) {
  if (!Object.hasOwn(schemas, method)) throw new InputError();
  const result = schemas[method].safeParse(input);
  if (!result.success) throw new InputError();
  return result.data;
}

export async function invoke(sdk, method, input) {
  validate(method, input);
  return sdk[method](input);
}
