import { expect, test } from "../fixtures/test";

test("Directory edits preserve shared contacts and their company history", async ({ authPage: page }) => {
	const companyResponse = await page.request.post("/api/openapi/directory/companies", { data: { name: "Lumen Labs" } });
	await expect(companyResponse).toBeOK();
	const company = await companyResponse.json();
	const agencyResponse = await page.request.post("/api/openapi/directory/companies", {
		data: { name: "Atlas Recruiting" },
	});
	await expect(agencyResponse).toBeOK();
	const agency = await agencyResponse.json();
	const contactResponse = await page.request.post("/api/openapi/directory/contacts", {
		data: { name: "Avery Chen", companyId: agency.id, position: "Recruiter" },
	});
	await expect(contactResponse).toBeOK();
	const contact = await contactResponse.json();
	const jobResponse = await page.request.post("/api/openapi/applications", {
		data: {
			company: company.name,
			role: "Platform engineer",
			contacts: [{ contactId: contact.id, name: contact.name, type: "Recruiter" }],
		},
	});
	await expect(jobResponse).toBeOK();
	const applicationId = await jobResponse.json();
	await page.goto("/dashboard/directory?tab=contacts");
	await page.getByRole("link", { name: /Avery Chen/ }).click();
	await expect(page.getByText("Platform engineer", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Edit contact", exact: true }).click();
	const editor = page.getByRole("dialog", { name: "Edit contact", exact: true });
	await editor.getByLabel("Name", { exact: true }).fill("Avery Morgan");
	await editor.getByLabel("Company", { exact: true }).selectOption(company.id);
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editor).not.toBeVisible();
	await expect(page.getByRole("heading", { name: "Avery Morgan", exact: true })).toBeVisible();
	await expect(page.getByText("Recruiter · Atlas Recruiting", { exact: true })).toBeVisible();
	const updated = await (await page.request.get(`/api/openapi/applications/${applicationId}`)).json();
	expect(updated.contacts).toEqual([
		expect.objectContaining({ contactId: contact.id, name: "Avery Morgan", type: "Recruiter" }),
	]);
	await page.getByRole("textbox", { name: "Add a note", exact: true }).fill("Introduced by a former teammate.");
	await page.getByRole("button", { name: "Add note", exact: true }).click();
	await expect(page.getByText("Introduced by a former teammate.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Delete contact", exact: true }).click();
	await page.getByRole("button", { name: "Delete contact", exact: true }).click();
	await expect.poll(() => new URL(page.url()).searchParams.has("contact")).toBe(false);
	await expect(page).toHaveURL(/tab=contacts/);
	const erased = await (await page.request.get(`/api/openapi/applications/${applicationId}`)).json();
	expect(erased.contacts).toEqual([]);
	await expect(page.getByRole("heading", { name: "Directory", exact: true })).toBeVisible();
});

test("application contact picker links a person without changing their employer or position", async ({
	authPage: page,
}) => {
	const personResponse = await page.request.post("/api/openapi/directory/contacts", {
		data: { name: "Morgan Lee", position: "Staff engineer", lookingForWork: true },
	});
	await expect(personResponse).toBeOK();
	const person = await personResponse.json();
	const jobResponse = await page.request.post("/api/openapi/applications", {
		data: { company: "Lumen Labs", role: "Platform lead" },
	});
	await expect(jobResponse).toBeOK();
	const applicationId = await jobResponse.json();
	await page.goto("/dashboard/applications");
	await page.getByText("Platform lead", { exact: true }).first().click();
	await page.getByRole("button", { name: "Contacts", exact: true }).click();
	await page.getByRole("textbox", { name: "Find a directory contact", exact: true }).fill("Morgan");
	await page.getByRole("button", { name: "Morgan Lee · Staff engineer", exact: true }).click();
	await page.getByRole("textbox", { name: "Role in this application for Morgan Lee", exact: true }).fill("Referral");
	await expect
		.poll(async () => (await (await page.request.get(`/api/openapi/applications/${applicationId}`)).json()).contacts)
		.toEqual([expect.objectContaining({ contactId: person.id, type: "Referral" })]);
	const central = await (await page.request.get(`/api/openapi/directory/contacts/${person.id}`)).json();
	expect(central.contact).toMatchObject({ companyId: null, position: "Staff engineer", lookingForWork: true });
});

test("imports career facts and optional contacts from one LinkedIn archive and matches reimports", async ({
	authPage: page,
}, testInfo) => {
	const { zipSync, strToU8 } = await import("fflate");
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const companyResponse = await page.request.post("/api/openapi/directory/companies", { data: { name: "Lumen" } });
	await expect(companyResponse).toBeOK();
	const company = await companyResponse.json();
	const duplicateResponse = await page.request.post("/api/openapi/directory/contacts", {
		data: { name: "Sam Patel", companyId: company.id, notes: "Met at a conference" },
	});
	await expect(duplicateResponse).toBeOK();
	const duplicate = await duplicateResponse.json();
	const archive = (position: string) =>
		Buffer.from(
			zipSync({
				"Profile.csv": strToU8("First Name,Last Name,Headline\nTaylor,Morgan,Platform engineering leader"),
				"Connections.csv": strToU8(
					`Notes:\nExported connections\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nCasey,Nguyen,https://linkedin.com/in/casey-nguyen,casey@example.test,Lumen Inc.,${position},13 Aug 2026\nSam,Patel,https://linkedin.com/in/sam-patel,sam@example.test,Lumen,Recruiter,12 Sep 2025`,
				),
				"messages.csv": strToU8("Private messages are ignored"),
			}),
		);
	await page.goto("/dashboard/career/knowledge/import");
	await page
		.getByLabel("Choose a file to import")
		.setInputFiles({ name: "LinkedIn.zip", mimeType: "application/zip", buffer: archive("Engineer") });
	const include = page.getByRole("checkbox", { name: "Import contacts from this export", exact: true });
	await expect(include).not.toBeChecked();
	await include.check();
	await expect(page.getByText("1 contact selected", { exact: true })).toBeVisible();
	await expect(page.getByRole("checkbox", { name: "Import Sam Patel", exact: true })).not.toBeChecked();
	await page.getByRole("checkbox", { name: "Import Sam Patel", exact: true }).check();
	await expect(page.getByRole("button", { name: "Import selected facts and contacts" })).toBeDisabled();
	await page.getByRole("radio", { name: "Update Sam Patel" }).check();
	await page.getByRole("button", { name: "Use Lumen", exact: true }).click();
	await expect(page.getByRole("checkbox", { name: "Also import email addresses" })).toHaveCount(0);
	await page.getByRole("checkbox", { name: "Import Casey Nguyen", exact: true }).uncheck();
	await expect(page.getByText("1 contact selected", { exact: true })).toBeVisible();
	await page.getByRole("checkbox", { name: "Import Casey Nguyen", exact: true }).check();
	const cards = page.getByRole("article");
	const firstCard = await cards.nth(0).boundingBox();
	const secondCard = await cards.nth(1).boundingBox();
	expect(
		firstCard && secondCard && Math.abs(firstCard.y - secondCard.y) < 2 && secondCard.x > firstCard.x,
	).toBeTruthy();
	await page.setViewportSize({ width: 390, height: 844 });
	const mobileFirst = await cards.nth(0).boundingBox();
	const mobileSecond = await cards.nth(1).boundingBox();
	expect(
		mobileFirst && mobileSecond && Math.abs(mobileFirst.x - mobileSecond.x) < 2 && mobileSecond.y > mobileFirst.y,
	).toBeTruthy();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.setViewportSize({ width: 1280, height: 720 });
	if (process.env.UPDATE_GUIDE_SCREENSHOTS === "true") {
		const screenshotStyle = await page.addStyleTag({ content: ".sticky { position: static !important; }" });
		await page.evaluate(() => window.scrollTo(0, 0));
		await page.screenshot({ path: "docs/images/guides/directory/linkedin-import.png", fullPage: true });
		await page.emulateMedia({ colorScheme: "dark" });
		await expect(page.locator("html")).toHaveClass(/dark/);
		await page.screenshot({ path: testInfo.outputPath("contact-import-review-dark.png"), fullPage: true });
		await page.emulateMedia({ colorScheme: "light" });
		await screenshotStyle.evaluate((element) => element.remove());
	}
	await page.getByRole("button", { name: "Import selected facts and contacts", exact: true }).click();
	await expect(page.getByText("Knowledge import complete", { exact: true })).toBeVisible();
	let people = await (await page.request.get("/api/openapi/directory/contacts")).json();
	expect(people).toHaveLength(2);
	const casey = people.find((person: { name: string }) => person.name === "Casey Nguyen");
	expect(casey).toMatchObject({ companyId: company.id, emails: ["casey@example.test"], position: "Engineer" });
	expect(people.find((person: { id: string }) => person.id === duplicate.id)).toMatchObject({
		notes: "Met at a conference",
		emails: ["sam@example.test"],
	});
	await page.getByRole("button", { name: "Import another file", exact: true }).click();
	await page
		.getByLabel("Choose a file to import")
		.setInputFiles({ name: "LinkedIn.zip", mimeType: "application/zip", buffer: archive("Staff Engineer") });
	await page.getByRole("checkbox", { name: "Import contacts from this export", exact: true }).check();
	await expect(page.getByRole("checkbox", { name: "Import Casey Nguyen", exact: true })).toBeChecked();
	await expect(page.getByLabel("Company for Lumen Inc.")).toHaveValue("Lumen");
	await page.getByRole("button", { name: "Import selected facts and contacts", exact: true }).click();
	await expect(page.getByText("Knowledge import complete", { exact: true })).toBeVisible();
	people = await (await page.request.get("/api/openapi/directory/contacts")).json();
	expect(people).toHaveLength(2);
	expect(people.find((person: { id: string }) => person.id === casey.id)).toMatchObject({
		position: "Staff Engineer",
		emails: ["casey@example.test"],
	});
	expect(errors).toEqual([]);
});
