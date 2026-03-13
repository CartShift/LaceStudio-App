import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyFriendlyTerms, DISALLOWED_JARGON } from "@/lib/copy";

const USER_FACING_SCAN_ROOTS = [path.join(process.cwd(), "src", "app", "(app)"), path.join(process.cwd(), "src", "components")];
const USER_FACING_SCAN_FILES = [path.join(process.cwd(), "src", "app", "error.tsx"), path.join(process.cwd(), "src", "app", "global-error.tsx"), path.join(process.cwd(), "src", "app", "not-found.tsx")];

const EXPLICIT_ALLOWLIST_EXCEPTIONS: Record<string, string[]> = {
	"src/components/providers/notice-provider.tsx": ["provider"],
	"src/components/providers/breadcrumb-provider.tsx": ["provider"],
	"src/components/ui/step-celebration.tsx": ["drift"]
};

const BANNED_PATTERNS: Array<{ term: string; pattern: RegExp }> = [
	{ term: "canonical pack", pattern: /\bcanonical pack\b/i },
	{ term: "front-shot candidate", pattern: /\bfront-shot candidate\b/i },
	{ term: "provider", pattern: /\bprovider\b/i },
	{ term: "model id", pattern: /\bmodel id\b/i },
	{ term: "workflow", pattern: /\bworkflow\b/i },
	{ term: "batch generation", pattern: /\bbatch generation\b/i },
	{ term: "moderation", pattern: /\bmoderation\b/i },
	{ term: "artifact", pattern: /\bartifact(s)?\b/i },
	{ term: "drift", pattern: /\bdrift\b/i }
];

describe("copy regression", () => {
	it("maps high-frequency technical terms to friendly language", () => {
		const input =
			"Canonical Pack and Front-shot Candidate use Provider and Model ID during Workflow with Batch Generation, Moderation, Artifact checks, and Drift alerts.";

		const normalized = applyFriendlyTerms(input);

		expect(normalized).toBe(
			"Reference Set and Front Look Option use Image Engine and Engine Version during Setup Flow with Multi-shot Run, Review, Visual Glitch checks, and Look Mismatch alerts."
		);
		for (const term of ["canonical pack", "front-shot candidate", "provider", "model id", "workflow", "batch generation", "moderation", "artifact", "drift"]) {
			expect(DISALLOWED_JARGON).toContain(term as (typeof DISALLOWED_JARGON)[number]);
		}
	});

	it("blocks disallowed jargon in user-facing copy paths (with explicit allowlist exceptions)", () => {
		const files = Array.from(
			new Set([
				...USER_FACING_SCAN_ROOTS.flatMap(scanTsFiles),
				...USER_FACING_SCAN_FILES.filter(file => {
					try {
						return statSync(file).isFile();
					} catch {
						return false;
					}
				})
			])
		);

		const violations: string[] = [];

		for (const file of files) {
			const projectPath = normalizeProjectPath(file);
			const allowedTerms = new Set(EXPLICIT_ALLOWLIST_EXCEPTIONS[projectPath] ?? []);
			const source = readFileSync(file, "utf8");
			const literals = extractLikelyUserFacingStrings(source);

			for (const literal of literals) {
				for (const { term, pattern } of BANNED_PATTERNS) {
					if (!pattern.test(literal) || allowedTerms.has(term)) continue;
					violations.push(`${projectPath}: "${literal}" contains "${term}"`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});

function scanTsFiles(target: string): string[] {
	let stats;
	try {
		stats = statSync(target);
	} catch {
		return [];
	}

	if (!stats.isDirectory()) return [];

	const files: string[] = [];
	for (const entry of readdirSync(target, { withFileTypes: true })) {
		const entryPath = path.join(target, entry.name);
		if (entry.isDirectory()) {
			files.push(...scanTsFiles(entryPath));
			continue;
		}
		if (!entry.isFile()) continue;
		if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(entryPath);
	}

	return files;
}

function extractLikelyUserFacingStrings(source: string): string[] {
	const withoutImports = source.replace(/^\s*import\s.+$/gm, "");
	const literals: string[] = [];
	const matcher = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

	for (const match of withoutImports.matchAll(matcher)) {
		const rawLiteral = match[2];
		if (rawLiteral == null) continue;
		const literal = rawLiteral.trim();
		if (!literal || isNonUserFacingLiteral(literal)) continue;
		literals.push(literal);
	}

	return literals;
}

function isNonUserFacingLiteral(literal: string): boolean {
	if (literal.startsWith("@/") || literal.startsWith("./") || literal.startsWith("../")) return true;
	if (literal.includes("/")) return true;
	if (literal.startsWith("--")) return true;
	if (literal.includes("${")) return true;
	if (/^[A-Z0-9_]+$/.test(literal)) return true;
	if (/^[a-z0-9_-]+$/i.test(literal) && (literal.includes("_") || literal.includes("-") || literal === literal.toLowerCase())) return true;
	return false;
}

function normalizeProjectPath(file: string): string {
	return path.relative(process.cwd(), file).split(path.sep).join("/");
}
