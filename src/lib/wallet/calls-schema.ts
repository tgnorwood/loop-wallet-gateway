import { z } from "zod";

const felt = z.string().regex(/^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/, "calldata must be hex or decimal felts");
export const callsSchema = z
  .array(
    z.object({
      contractAddress: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
      entrypoint: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/),
      calldata: z.array(felt).max(200),
    }),
  )
  .min(1)
  .max(10);
