import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { DirectoryPage } from "@/features/directory/page";

export const Route = createFileRoute("/dashboard/directory/")({
	validateSearch: z.object({
		tab: z.enum(["companies", "contacts"]).optional().catch(undefined),
		company: z.string().optional().catch(undefined),
		contact: z.string().optional().catch(undefined),
	}),
	component: RouteComponent,
});
function RouteComponent() {
	return <DirectoryPage {...Route.useSearch()} />;
}
