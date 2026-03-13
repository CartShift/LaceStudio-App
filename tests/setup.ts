import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
	class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	}

	Object.defineProperty(globalThis, "ResizeObserver", {
		writable: true,
		configurable: true,
		value: ResizeObserver
	});
}
