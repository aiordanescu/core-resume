import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { NO_REPLY_DAYS } from "@reactive-resume/utils/reminders";
import { SettingsSection } from "./section";
import { useNoReplyDays } from "@/features/applications/next-step";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { sessionQueryKey } from "@/libs/root-context";

type ReminderChange = { noReplyDays: number } | { interviewReminders: boolean };

/**
 * Which built-in reminders the account gets: the follow-up nudge for applications with no reply (and after how many
 * days), and the next-interview card on Career → Today. Each change is saved at once.
 */
export function RemindersSection() {
	const id = useId();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { session } = useRouteContext({ strict: false });
	const savedDays = useNoReplyDays();
	const interviewReminders = session?.user.interviewReminders ?? true;
	const nudging = savedDays > 0;
	// Switching the nudge back on returns to the last number of days used here.
	const [lastDays, setLastDays] = useState(nudging ? savedDays : NO_REPLY_DAYS.default);
	const [value, setValue] = useState(String(lastDays));
	const parsed = Number(value);
	const invalid = !Number.isInteger(parsed) || parsed < 1 || parsed > NO_REPLY_DAYS.max || value.trim() === "";

	const save = async (change: ReminderChange) => {
		const { error } = await authClient.updateUser(change);
		if (error) {
			setValue(String(lastDays));
			toast.add({ type: "error", description: getReadableErrorMessage(error, t`Couldn't save the reminders.`) });
			return;
		}
		await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		await router.invalidate();
	};

	const saveDays = () => {
		if (invalid || parsed === savedDays) return;
		setLastDays(parsed);
		void save({ noReplyDays: parsed });
	};

	return (
		<SettingsSection title={<Trans>Reminders</Trans>}>
			<div className="grid gap-1">
				<SwitchRow
					label={<Trans>Follow-up nudges</Trans>}
					description={
						<Trans>
							When an application has been at Applied with no reply for the days below, Applications suggests a short
							follow-up and its next step turns amber.
						</Trans>
					}
					checked={nudging}
					onCheckedChange={(checked) => void save({ noReplyDays: checked ? lastDays : 0 })}
				/>
				<div className="flex items-center justify-between gap-4 py-2">
					<Label htmlFor={`${id}-days`} className={nudging ? undefined : "text-ink-3"}>
						<Trans>Days without a reply</Trans>
					</Label>
					<Input
						id={`${id}-days`}
						type="number"
						inputMode="numeric"
						min={1}
						max={NO_REPLY_DAYS.max}
						step={1}
						value={value}
						disabled={!nudging}
						aria-invalid={(nudging && invalid) || undefined}
						aria-describedby={`${id}-hint`}
						onChange={(event) => setValue(event.target.value)}
						onBlur={saveDays}
						onKeyDown={(event) => event.key === "Enter" && saveDays()}
						className="w-24"
					/>
				</div>
				<SwitchRow
					label={<Trans>Next interview</Trans>}
					description={<Trans>Shows your next interview, with a countdown, at the top of Career → Today.</Trans>}
					checked={interviewReminders}
					onCheckedChange={(checked) => void save({ interviewReminders: checked })}
				/>
			</div>
			<p id={`${id}-hint`} className={nudging && invalid ? "text-xs text-danger-text" : "text-xs text-ink-3"}>
				{nudging && invalid ? (
					<Trans>Enter a whole number of days from 1 to {NO_REPLY_DAYS.max}.</Trans>
				) : (
					<Trans>
						Follow-up dates you set yourself still show. Career schedules have their own switches in Career → Today.
					</Trans>
				)}
			</p>
		</SettingsSection>
	);
}
