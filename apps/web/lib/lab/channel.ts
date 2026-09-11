import { createLabChannel } from "@pulse/channel-lab";
import type { Brand, MessageChannel } from "@pulse/shared";

/** Build a lab channel + brand resolver pinned to this lab brand. */
export function labChannelContext(brand: Brand): {
  channel: MessageChannel;
  resolveBrand: (from: string) => Promise<Brand | null>;
} {
  const channel = createLabChannel();
  return {
    channel,
    resolveBrand: async () => brand,
  };
}
