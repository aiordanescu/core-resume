import { protectedProcedure } from "../../context";
import { directoryDto } from "../../dto/directory";
import { resumeMutationRateLimit } from "../../middleware/rate-limit";
import { importLinkedInContacts } from "./linkedin";
import { directoryService } from "./service";

export const directoryRouter = {
	importLinkedIn: protectedProcedure
		.route({
			method: "POST",
			path: "/directory/imports/linkedin",
			tags: ["Directory"],
			operationId: "importLinkedInContacts",
			summary: "Import reviewed LinkedIn connections",
			description:
				"Save up to 500 reviewed LinkedIn connections. Profile URLs identify re-imports. Explicitly resolve name duplicates and company mappings. Emails import only with importEmails=true. Updates require the reviewed contact's updatedAt; stale reviews fail atomically. Notes, tags, phone numbers, relationship and last-contacted dates are preserved. Employer or position changes retain the previous position with unknown dates.",
		})
		.input(directoryDto.importLinkedIn.input)
		.output(directoryDto.importLinkedIn.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => importLinkedInContacts(context.user.id, input)),
	companies: protectedProcedure
		.route({
			method: "GET",
			path: "/directory/companies",
			tags: ["Directory"],
			operationId: "directoryCompanies",
			summary: "List companies",
			description: "List companies in the authenticated account's private directory.",
		})
		.input(directoryDto.companies.input)
		.output(directoryDto.companies.output)
		.handler(({ input, context }) => directoryService.companies({ ...input, userId: context.user.id })),
	company: protectedProcedure
		.route({
			method: "GET",
			path: "/directory/companies/{id}",
			tags: ["Directory"],
			operationId: "directoryCompany",
			summary: "Read company",
			description: "Read company in the authenticated account's private directory.",
		})
		.input(directoryDto.company.input)
		.output(directoryDto.company.output)
		.handler(({ input, context }) => directoryService.company({ ...input, userId: context.user.id })),
	createCompany: protectedProcedure
		.route({
			method: "POST",
			path: "/directory/companies",
			tags: ["Directory"],
			operationId: "directoryCreateCompany",
			summary: "Create company",
			description: "Create company in the authenticated account's private directory.",
		})
		.input(directoryDto.createCompany.input)
		.output(directoryDto.createCompany.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.createCompany({ ...input, userId: context.user.id })),
	updateCompany: protectedProcedure
		.route({
			method: "PUT",
			path: "/directory/companies/{id}",
			tags: ["Directory"],
			operationId: "directoryUpdateCompany",
			summary: "Update company",
			description: "Update company in the authenticated account's private directory.",
		})
		.input(directoryDto.updateCompany.input)
		.output(directoryDto.updateCompany.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.updateCompany({ ...input, userId: context.user.id })),
	deleteCompany: protectedProcedure
		.route({
			method: "DELETE",
			path: "/directory/companies/{id}",
			tags: ["Directory"],
			operationId: "directoryDeleteCompany",
			summary: "Delete company",
			description: "Delete company in the authenticated account's private directory.",
		})
		.input(directoryDto.deleteCompany.input)
		.output(directoryDto.deleteCompany.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.deleteCompany({ ...input, userId: context.user.id })),
	contacts: protectedProcedure
		.route({
			method: "GET",
			path: "/directory/contacts",
			tags: ["Directory"],
			operationId: "directoryContacts",
			summary: "List contacts",
			description: "List contacts in the authenticated account's private directory.",
		})
		.input(directoryDto.contacts.input)
		.output(directoryDto.contacts.output)
		.handler(({ input, context }) => directoryService.contacts({ ...input, userId: context.user.id })),
	contact: protectedProcedure
		.route({
			method: "GET",
			path: "/directory/contacts/{id}",
			tags: ["Directory"],
			operationId: "directoryContact",
			summary: "Read contact",
			description: "Read contact in the authenticated account's private directory.",
		})
		.input(directoryDto.contact.input)
		.output(directoryDto.contact.output)
		.handler(({ input, context }) => directoryService.contact({ ...input, userId: context.user.id })),
	createContact: protectedProcedure
		.route({
			method: "POST",
			path: "/directory/contacts",
			tags: ["Directory"],
			operationId: "directoryCreateContact",
			summary: "Create contact",
			description: "Create contact in the authenticated account's private directory.",
		})
		.input(directoryDto.createContact.input)
		.output(directoryDto.createContact.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.createContact({ ...input, userId: context.user.id })),
	updateContact: protectedProcedure
		.route({
			method: "PUT",
			path: "/directory/contacts/{id}",
			tags: ["Directory"],
			operationId: "directoryUpdateContact",
			summary: "Update contact",
			description: "Update contact in the authenticated account's private directory.",
		})
		.input(directoryDto.updateContact.input)
		.output(directoryDto.updateContact.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.updateContact({ ...input, userId: context.user.id })),
	deleteContact: protectedProcedure
		.route({
			method: "DELETE",
			path: "/directory/contacts/{id}",
			tags: ["Directory"],
			operationId: "directoryDeleteContact",
			summary: "Delete contact",
			description: "Delete contact in the authenticated account's private directory.",
		})
		.input(directoryDto.deleteContact.input)
		.output(directoryDto.deleteContact.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.deleteContact({ ...input, userId: context.user.id })),
	deleteAllContacts: protectedProcedure
		.route({
			method: "POST",
			path: "/directory/contacts/erase",
			tags: ["Directory"],
			operationId: "bulkDeleteDirectoryContacts",
			summary: "Delete all contacts",
			description: "Delete all contacts in the authenticated account's private directory.",
		})
		.input(directoryDto.deleteAllContacts.input)
		.output(directoryDto.deleteAllContacts.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.deleteAllContacts({ ...input, userId: context.user.id })),
	addNote: protectedProcedure
		.route({
			method: "POST",
			path: "/directory/contacts/{id}/notes",
			tags: ["Directory"],
			operationId: "directoryAddNote",
			summary: "Add contact note",
			description: "Add contact note in the authenticated account's private directory.",
		})
		.input(directoryDto.addNote.input)
		.output(directoryDto.addNote.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.addNote({ ...input, userId: context.user.id })),
	deleteNote: protectedProcedure
		.route({
			method: "DELETE",
			path: "/directory/notes/{id}",
			tags: ["Directory"],
			operationId: "directoryDeleteNote",
			summary: "Delete contact note",
			description: "Delete contact note in the authenticated account's private directory.",
		})
		.input(directoryDto.deleteNote.input)
		.output(directoryDto.deleteNote.output)
		.use(resumeMutationRateLimit)
		.handler(({ input, context }) => directoryService.deleteNote({ ...input, userId: context.user.id })),
};
