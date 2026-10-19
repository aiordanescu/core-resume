import { BudgetMeter } from "./budget";
import { GroupsCard } from "./groups";
import { DuplicatesCard, StoriesCard } from "./upkeep";

/** Curate: what the AI sees of your Knowledge, and the upkeep that keeps it right. */
export function CuratePage() {
	return (
		<div className="grid max-w-[820px] gap-3.5">
			<BudgetMeter showSettingsLink />
			<GroupsCard />
			<StoriesCard />
			<DuplicatesCard />
		</div>
	);
}
