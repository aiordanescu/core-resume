import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as schema from "@reactive-resume/db/schema";
import { companyFieldsSchema, contactFieldsSchema, directorySourceSchema } from "@reactive-resume/schema/directory";
import { linkedInImportSchema } from "@reactive-resume/schema/directory-import";

const id = z.object({ id: z.string().min(1) });
const company = createSelectSchema(schema.company, { sources: z.array(directorySourceSchema) }).omit({ userId: true });
const contact = createSelectSchema(schema.contact, { sources: z.array(directorySourceSchema) }).omit({ userId: true });
const employment = createSelectSchema(schema.contactEmployment).omit({ userId: true });
const note = createSelectSchema(schema.contactNote).omit({ userId: true });
const query = z.object({ query: z.string().max(300).optional(), companyId: z.string().optional() }).default({});
const applicationSummary = z.object({
	id: z.string(),
	company: z.string(),
	role: z.string(),
	status: z.string(),
	at: z.coerce.date(),
});
export const directoryDto = {
	importLinkedIn: {
		input: linkedInImportSchema,
		output: z.object({
			created: z.number(),
			updated: z.number(),
			unchanged: z.number(),
			skipped: z.number(),
			companiesCreated: z.number(),
		}),
	},
	companies: { input: query, output: z.array(company) },
	company: {
		input: id,
		output: z.object({ company, contacts: z.array(contact), applications: z.array(applicationSummary) }),
	},
	createCompany: { input: companyFieldsSchema, output: company },
	updateCompany: { input: companyFieldsSchema.partial().extend(id.shape), output: company },
	deleteCompany: { input: id, output: z.void() },
	contacts: { input: query, output: z.array(contact) },
	contact: {
		input: id,
		output: z.object({
			contact,
			company: company.nullable(),
			employment: z.array(employment),
			notes: z.array(note),
			applications: z.array(applicationSummary),
			interviews: z.array(
				applicationSummary.extend({ entryId: z.string(), contextRole: z.string(), kind: z.string() }),
			),
		}),
	},
	createContact: { input: contactFieldsSchema, output: contact },
	updateContact: { input: contactFieldsSchema.partial().extend(id.shape), output: contact },
	deleteContact: { input: id, output: z.void() },
	deleteAllContacts: { input: z.object({ confirm: z.literal(true) }), output: z.void() },
	addNote: {
		input: z.object({
			id: z.string().min(1),
			text: z.string().trim().min(1).max(20_000),
			at: z.coerce.date().optional(),
		}),
		output: note,
	},
	deleteNote: { input: id, output: z.void() },
};
