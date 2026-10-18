// @vitest-environment happy-dom

import type { AiReasoning } from "@reactive-resume/ai/reasoning";
import type { AIProvider } from "@reactive-resume/ai/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { ReasoningField, reasoningSummary } from "./reasoning";

i18n.loadAndActivate({ locale: "en", messages: {} });

function Harness({
	provider,
	initial,
	onChange,
}: {
	provider: AIProvider;
	initial: AiReasoning | null;
	onChange: (value: AiReasoning | null) => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<ReasoningField
			provider={provider}
			value={value}
			onChange={(next) => {
				setValue(next);
				onChange(next);
			}}
		/>
	);
}

const renderField = (provider: AIProvider, initial: AiReasoning | null) => {
	const onChange = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<Harness provider={provider} initial={initial} onChange={onChange} />
		</I18nProvider>,
	);
	return onChange;
};

const toggle = (name: string) => screen.getByRole("switch", { name: new RegExp(name) });
const effort = () => screen.getByLabelText("Effort") as HTMLSelectElement;

describe("Reasoning", () => {
	it("starts on Model default, with thinking and effort unavailable", () => {
		renderField("openai-compatible", null);
		expect(toggle("Model default").getAttribute("aria-checked")).toBe("true");
		expect(toggle("Thinking").hasAttribute("data-disabled")).toBe(true);
		expect(effort().disabled).toBe(true);
	});

	it("turns thinking off and back on at the last effort chosen", () => {
		const onChange = renderField("openai-compatible", "high");
		fireEvent.change(effort(), { target: { value: "xhigh" } });
		fireEvent.click(toggle("Thinking"));
		fireEvent.click(toggle("Thinking"));
		expect(onChange.mock.calls.map(([value]) => value)).toEqual(["xhigh", "none", "xhigh"]);
	});

	it("goes back to sending nothing with Model default", () => {
		const onChange = renderField("openai-compatible", "low");
		fireEvent.click(toggle("Model default"));
		expect(onChange).toHaveBeenLastCalledWith(null);
	});

	it("offers Ultra only where it can be sent as-is", () => {
		renderField("openrouter", "medium");
		expect([...effort().options].map((option) => option.value)).toContain("ultra");
	});

	it("leaves Ultra out for providers that translate the level", () => {
		renderField("anthropic", "medium");
		expect([...effort().options].map((option) => option.textContent)).toEqual([
			"Minimal",
			"Low",
			"Medium",
			"High",
			"Extra high",
			"Max",
		]);
	});

	it("summarises the setting for the connection's row", () => {
		expect(reasoningSummary("none")).toBe("Thinking off");
		expect(reasoningSummary("xhigh")).toBe("Thinking: Extra high");
	});
});
