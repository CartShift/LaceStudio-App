"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type BreadcrumbContextValue = {
	segmentTitles: Record<number, string>;
	setSegmentTitle: (index: number, title: string | null) => void;
};

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
	const [segmentTitles, setSegmentTitles] = useState<Record<number, string>>({});

	const setSegmentTitle = useCallback((index: number, title: string | null) => {
		setSegmentTitles(prev => {
			if (title === null) {
				const next = { ...prev };
				delete next[index];
				return next;
			}
			return { ...prev, [index]: title };
		});
	}, []);

	const value = useMemo(
		() => ({ segmentTitles, setSegmentTitle }),
		[segmentTitles, setSegmentTitle]
	);

	return (
		<BreadcrumbContext.Provider value={value}>
			{children}
		</BreadcrumbContext.Provider>
	);
}

export function useBreadcrumb() {
	const ctx = useContext(BreadcrumbContext);
	if (!ctx) throw new Error("useBreadcrumb must be used within BreadcrumbProvider");
	return ctx;
}
