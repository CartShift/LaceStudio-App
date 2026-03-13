import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";
import { LiveInstagramProvider } from "@/server/providers/instagram/live-instagram-provider";
import type { InstagramAccountContext } from "@/server/providers/instagram/types";

const account: InstagramAccountContext = {
  accessToken: "test-token",
  instagramUserId: "123456789",
  graphApiVersion: "v18.0",
  handle: "model_handle",
  profileId: "profile_1",
};

describe("live-instagram-provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates feed media with caption via form payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "container_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new LiveInstagramProvider();
    const result = await provider.createMedia(account, {
      imageUrl: "https://cdn.example.com/image.jpg",
      caption: "caption body",
      postType: "feed",
    });

    expect(result.containerId).toBe("container_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v18.0/123456789/media");
    expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });

    const body = String(init.body);
    expect(body).toContain("image_url=https%3A%2F%2Fcdn.example.com%2Fimage.jpg");
    expect(body).toContain("caption=caption+body");
    expect(body).not.toContain("media_type=STORIES");
  });

  it("creates story media with STORIES media_type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "container_story" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new LiveInstagramProvider();
    const result = await provider.createMedia(account, {
      imageUrl: "https://cdn.example.com/story.jpg",
      caption: "unused for story",
      postType: "story",
    });

    expect(result.containerId).toBe("container_story");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = String(init.body);
    expect(body).toContain("media_type=STORIES");
    expect(body).not.toContain("caption=");
  });

  it("rejects reel publishing in phase 1", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = new LiveInstagramProvider();

    await expect(
      provider.createMedia(account, {
        imageUrl: "https://cdn.example.com/reel.jpg",
        caption: "reel",
        postType: "reel",
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps upstream rate limits to ApiError with retry metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Rate limit hit",
          },
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "120",
          },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new LiveInstagramProvider();

    try {
      await provider.createMedia(account, {
        imageUrl: "https://cdn.example.com/feed.jpg",
        caption: "caption",
        postType: "feed",
      });
      throw new Error("Expected createMedia to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(429);
      expect(apiError.code).toBe("RATE_LIMITED");
      expect(apiError.details).toMatchObject({
        retry_after_seconds: 120,
      });
    }
  });
});
