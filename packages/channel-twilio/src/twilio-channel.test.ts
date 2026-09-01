import { describe, expect, it } from "vitest";
import { TwilioChannel } from "./twilio-channel.js";

describe("TwilioChannel.parseInbound", () => {
  const channel = new TwilioChannel();

  it("parses a message with no media", () => {
    const payload = {
      From: "+61400000000",
      To: "+61400000001",
      Body: "Hello there",
      NumMedia: "0",
      MessageSid: "SM123",
    };

    const result = channel.parseInbound(payload);

    expect(result).toEqual({
      from: "+61400000000",
      to: "+61400000001",
      body: "Hello there",
      media: [],
      providerMessageId: "SM123",
      raw: payload,
    });
  });

  it("parses a message with two media attachments", () => {
    const payload = {
      From: "+61400000000",
      To: "+61400000001",
      Body: "Check these out",
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/media/0",
      MediaContentType0: "image/jpeg",
      MediaUrl1: "https://api.twilio.com/media/1",
      MediaContentType1: "video/mp4",
      MessageSid: "SM456",
    };

    const result = channel.parseInbound(payload);

    expect(result.from).toBe("+61400000000");
    expect(result.providerMessageId).toBe("SM456");
    expect(result.media).toEqual([
      { url: "https://api.twilio.com/media/0", contentType: "image/jpeg" },
      { url: "https://api.twilio.com/media/1", contentType: "video/mp4" },
    ]);
  });

  it("skips a media index when its MediaUrl is missing, even if NumMedia claims it exists", () => {
    const payload = {
      From: "+61400000000",
      To: "+61400000001",
      Body: "",
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/media/0",
      MediaContentType0: "image/png",
      // MediaUrl1 intentionally absent
      MessageSid: "SM789",
    };

    const result = channel.parseInbound(payload);

    expect(result.media).toEqual([{ url: "https://api.twilio.com/media/0", contentType: "image/png" }]);
  });
});
