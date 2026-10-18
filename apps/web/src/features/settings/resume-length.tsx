import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { RESUME_PAGES, resumePagesSchema } from "@reactive-resume/utils/resume-pages";
import { SettingsSection } from "./section";
import { useResumePages } from "@/features/resume/editor/design/fit";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { sessionQueryKey } from "@/libs/root-context";

/** How many pages a resume may run to before the editor flags overflow and Fit tightens it. Saved on blur. */
export function ResumeLengthSection() {
	const id = useId();
	const router = useRouter();
	const queryClient = useQueryClient();
	const saved = useResumePages();
	const [value, setValue] = useState(String(saved));
	const parsed = resumePagesSchema.safeParse(Number(value));
	const invalid = value.trim() === "" || !parsed.success;

	const save = async () => {
		if (invalid || parsed.data === saved) return;
		const { error } = await authClient.updateUser({ resumePages: parsed.data });
		if (error) {
			setValue(String(saved));
			toast.add({ type: "error", description: getReadableErrorMessage(error, t`Couldn't save the resume length.`) });
			return;
		}
		await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		await router.invalidate();
	};

	return (
		<SettingsSection title={<Trans>Resume length</Trans>}>
			<div className="flex items-center gap-2">
				<label htmlFor={id} className="sr-only">
					<Trans>Pages per resume</Trans>
				</label>
				<Input
					id={id}
					type="number"
					inputMode="numeric"
					min={RESUME_PAGES.min}
					max={RESUME_PAGES.max}
					step={1}
					value={value}
					aria-invalid={invalid || undefined}
					aria-describedby={`${id}-hint`}
					onChange={(event) => setValue(event.target.value)}
					onBlur={() => void save()}
					onKeyDown={(event) => event.key === "Enter" && void save()}
					className="w-24"
				/>
				<span className="text-[13px] text-ink-3">
					<Trans>pages</Trans>
				</span>
			</div>
			<p id={`${id}-hint`} className={invalid ? "text-xs text-danger-text" : "text-xs text-ink-3"}>
				{invalid ? (
					<Trans>
						Enter a whole number from {RESUME_PAGES.min} to {RESUME_PAGES.max}.
					</Trans>
				) : (
					<Trans>
						How long your resumes may run. Past this, the editor marks the overflow and Fit tightens the design to fit.
						A resume laid out on more pages keeps its own length.
					</Trans>
				)}
			</p>
		</SettingsSection>
	);
}
