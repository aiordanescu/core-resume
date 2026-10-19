import { createFileRoute } from "@tanstack/react-router";
import { CuratePage } from "@/features/career/knowledge/curate";

export const Route = createFileRoute("/dashboard/career/knowledge/curate")({
	component: CuratePage,
});
