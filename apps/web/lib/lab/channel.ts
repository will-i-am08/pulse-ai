import { createLabChannel, type LabChannel } from "@pulse/channel-lab";
import type { Brand } from "@pulse/shared";

/** Build a lab channel + brand resolver pinned to this lab brand. */
export function labChannelContext(brand: Brand): {
  channel: LabChannel;
  resolveBrand: (from: string) => Promise<Brand | null>;
} {
  const channel = createLabChannel();
  return {
    channel,
    resolveBrand: async () => brand,
  };
}
