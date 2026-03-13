import { z } from "zod";

const envSchema = z.object({
	NEXT_PUBLIC_SUPABASE_URL: z.url(),
	NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
	SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
	DATABASE_URL: z.string().min(1),
	DIRECT_DATABASE_URL: z.string().min(1),
	GCS_SERVICE_ACCOUNT_KEY: z.string().min(1),
	GCS_PROJECT_ID: z.string().min(1),
	GCS_MODEL_WEIGHTS_BUCKET: z.string().min(1).default("lacestudio-model-weights-private"),
	GPU_SERVICE_URL: z.url(),
	GPU_API_KEY: z.string().min(1),
	GPU_WEBHOOK_SECRET: z.string().min(1),
	CRON_SECRET: z.string().min(1).optional(),
	OPENAI_API_KEY: z.string().min(1).optional(),
	OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-1"),
	OPENAI_VISION_MODEL: z.string().min(1).default("gpt-4.1-mini"),
	ZAI_API_BASE_URL: z.url().default("https://api.z.ai/api/paas/v4"),
	ZAI_API_KEY: z.string().min(1).optional(),
	ZAI_TEXT_MODEL: z.string().min(1).default("glm-4.6"),
	ZAI_VISION_MODEL: z.string().min(1).default("glm-4.6v"),
	ZAI_IMAGE_MODEL: z.string().min(1).default("glm-image"),
	NANO_BANANA_API_URL: z.url().optional(),
	NANO_BANANA_API_KEY: z.string().min(1).optional(),
	NANO_BANANA_MODEL: z.string().min(1).default("gemini-3.1-flash-image-preview"),
	VEO_API_URL: z.url().optional(),
	VEO_API_KEY: z.string().min(1).optional(),
	VEO_MODEL: z.string().min(1).default("veo-3.1-generate-preview"),
	INSTAGRAM_ACCESS_TOKEN: z.string().min(1).optional(),
	INSTAGRAM_USER_ID: z.string().min(1).optional(),
	FACEBOOK_APP_ID: z.string().min(1).optional(),
	FACEBOOK_APP_SECRET: z.string().min(1).optional(),
	INSTAGRAM_OAUTH_REDIRECT_URI: z.url().optional(),
	APP_ENCRYPTION_KEY: z.string().min(32).optional(),
	NEXT_PUBLIC_APP_URL: z.url(),
	VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
	IMAGE_PROVIDER_DEFAULT: z.enum(["gpu", "openai", "nano_banana_2", "zai_glm"]).default("zai_glm"),
	GPU_PROVIDER_MODE: z.enum(["mock", "live"]).default("mock"),
	VIDEO_PROVIDER_MODE: z.enum(["mock", "live"]).default("mock"),
	INSTAGRAM_PROVIDER_MODE: z.enum(["mock", "live"]).default("mock"),
	ENABLE_PROMPT_SIMILARITY: z.enum(["true", "false"]).default("false"),
	ENABLE_CLIENT_DASHBOARD: z.enum(["true", "false"]).default("false"),
	ENABLE_MODEL_CREATION_WIZARD: z.enum(["true", "false"]).default("false"),
	CSRF_TRUSTED_ORIGINS: z.string().optional(),
	API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
	API_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
	API_RATE_LIMIT_MAX_REQUESTS_PER_USER: z.coerce.number().int().positive().optional(),
	WEBHOOK_MAX_SKEW_MS: z.coerce.number().int().positive().optional(),
	ALLOW_LOCALHOST_AUTH_BYPASS: z.enum(["true", "false"]).optional()
});

let cachedEnv: z.infer<typeof envSchema> | null = null;

export function getEnv(): z.infer<typeof envSchema> {
	if (cachedEnv) return cachedEnv;

	const parsed = envSchema.safeParse(process.env);
	if (!parsed.success) {
		const details = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n");

		throw new Error(`Invalid environment variables:\n${details}`);
	}

	cachedEnv = parsed.data;
	return parsed.data;
}
