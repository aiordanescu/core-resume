import { createFileRoute } from "@tanstack/react-router";
import { KnowledgeImportPage } from "@/features/career/knowledge/import";

export const Route = createFileRoute("/dashboard/career/knowledge/import")({ component: KnowledgeImportPage });
