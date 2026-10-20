import { cn } from "@reactive-resume/utils/style";

type WordmarkProps = React.ComponentProps<"span"> & {
	/** "Core" above "Resume", for the auth and error screens. */
	stacked?: boolean;
};

/** "Core Resume" set as text, the mark until there's a logo. */
export function Wordmark({ stacked = false, className, ...props }: WordmarkProps) {
	return (
		<span
			className={cn(
				"inline-flex font-display leading-none font-medium tracking-tight text-ink",
				stacked ? "flex-col" : "gap-[0.25em]",
				className,
			)}
			{...props}
		>
			<span>Core</span>
			<span className="text-accent-text">Resume</span>
		</span>
	);
}

/** "Cr" in the wordmark's type, for slots too small for the full name, like the collapsed sidebar. */
export function Monogram({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span className={cn("font-display leading-none font-medium tracking-tight text-accent-text", className)} {...props}>
			Cr
		</span>
	);
}
