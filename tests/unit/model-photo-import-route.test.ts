import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSessionContextMock: vi.fn(async () => ({ role: "admin", userId: "00000000-0000-0000-0000-000000000001" })),
	assertRoleMock: vi.fn(),
	isDemoModeMock: vi.fn(() => false),
	startModelPhotoImportMock: vi.fn(),
	getModelPhotoImportSnapshotMock: vi.fn(),
	applyModelPhotoImportSuggestionMock: vi.fn(),
	reanalyzeModelPhotoImportMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	getSessionContext: mocks.getSessionContextMock,
	assertRole: mocks.assertRoleMock,
}));

vi.mock("@/server/demo/mode", () => ({
	isDemoMode: mocks.isDemoModeMock,
}));

vi.mock("@/server/services/model-photo-import.service", () => ({
	startModelPhotoImport: mocks.startModelPhotoImportMock,
	getModelPhotoImportSnapshot: mocks.getModelPhotoImportSnapshotMock,
	applyModelPhotoImportSuggestion: mocks.applyModelPhotoImportSuggestionMock,
	reanalyzeModelPhotoImport: mocks.reanalyzeModelPhotoImportMock,
}));

import { GET, POST } from "@/app/api/models/[id]/workflow/photo-import/route";
import { POST as APPLY_POST } from "@/app/api/models/[id]/workflow/photo-import/apply/route";
import { POST as REANALYZE_POST } from "@/app/api/models/[id]/workflow/photo-import/reanalyze/route";

describe("photo-import routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isDemoModeMock.mockReturnValue(false);
		mocks.getModelPhotoImportSnapshotMock.mockResolvedValue({
			job_id: "job-1",
			status: "READY",
			started_at: new Date().toISOString(),
			completed_at: new Date().toISOString(),
			error: null,
			analysis_provider: "heuristic",
			counts: { pending: 0, accepted: 3, rejected: 0, total: 3 },
			options: {
				keep_as_references: true,
				auto_generate_on_apply: false,
				canonical_candidates_per_shot: 1,
			},
			references: [],
			latest_suggestion: null,
		});
		mocks.startModelPhotoImportMock.mockResolvedValue({
			job_id: "job-1",
			status: "ANALYZING",
			started_at: new Date().toISOString(),
			counts: { total: 3 },
		});
		mocks.reanalyzeModelPhotoImportMock.mockResolvedValue({
			job_id: "job-1",
			status: "ANALYZING",
			counts: { total: 3 },
		});
		mocks.applyModelPhotoImportSuggestionMock.mockResolvedValue({
			applied: true,
			model_id: "11111111-1111-4111-8111-111111111111",
			workflow_state: {
				current_step: "social_strategy",
				completed_steps: ["character_design", "personality", "social_strategy"],
				last_saved_at: new Date().toISOString(),
			},
			draft: {
				character_design: {},
				personality: {},
				social_strategy: {},
			},
		});
	});

	it("returns demo snapshot for GET in demo mode", async () => {
		mocks.isDemoModeMock.mockReturnValue(true);
		mocks.getSessionContextMock.mockResolvedValueOnce({ role: "operator", userId: "user-1" });

		const response = await GET(new Request("http://localhost/api/models/11111111-1111-4111-8111-111111111111/workflow/photo-import"), {
			params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: "IDLE",
			counts: { total: 0 },
		});
	});

	it("rejects POST when payload is not multipart", async () => {
		const response = await POST(
			new Request("http://localhost/api/models/11111111-1111-4111-8111-111111111111/workflow/photo-import", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			}),
			{ params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "VALIDATION_ERROR" },
		});
	});

	it("starts import for multipart POST", async () => {
		const form = new FormData();
		form.append("photos", new File([Uint8Array.of(1, 2, 3)], "a.jpg", { type: "image/jpeg" }));
		form.append("photos", new File([Uint8Array.of(1, 2, 3)], "b.jpg", { type: "image/jpeg" }));
		form.append("photos", new File([Uint8Array.of(1, 2, 3)], "c.jpg", { type: "image/jpeg" }));

		const response = await POST(
			new Request("http://localhost/api/models/11111111-1111-4111-8111-111111111111/workflow/photo-import", {
				method: "POST",
				body: form,
			}),
			{ params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
		);

		expect(response.status).toBe(202);
		expect(mocks.startModelPhotoImportMock).toHaveBeenCalledTimes(1);
	});

	it("applies suggestion via apply route", async () => {
		const response = await APPLY_POST(
			new Request("http://localhost/api/models/11111111-1111-4111-8111-111111111111/workflow/photo-import/apply", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					sections: ["character_design", "personality", "social_strategy"],
				}),
			}),
			{ params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
		);

		expect(response.status).toBe(200);
		expect(mocks.applyModelPhotoImportSuggestionMock).toHaveBeenCalledTimes(1);
	});

	it("requeues photo analysis via reanalyze route", async () => {
		const response = await REANALYZE_POST(
			new Request("http://localhost/api/models/11111111-1111-4111-8111-111111111111/workflow/photo-import/reanalyze", {
				method: "POST",
			}),
			{ params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
		);

		expect(response.status).toBe(202);
		expect(mocks.reanalyzeModelPhotoImportMock).toHaveBeenCalledTimes(1);
	});
});
