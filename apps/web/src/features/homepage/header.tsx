import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@reactive-resume/ui/components/wordmark";
import { cn } from "@reactive-resume/utils/style";
import { goToScene, SCENE, useLanding } from "./scroll";
import { CtaLink } from "./ui";
import { useTheme } from "@/features/theme/provider";

const getStoryScenes = () => [
	{ scene: SCENE.write, label: t`Write` },
	{ scene: SCENE.design, label: t`Design` },
	{ scene: SCENE.check, label: t`Check` },
	{ scene: SCENE.tailor, label: t`Tailor` },
	{ scene: SCENE.share, label: t`Share` },
	{ scene: SCENE.prepare, label: t`Prepare` },
	{ scene: SCENE.remember, label: t`Remember` },
];

export function LandingHeader() {
	const scrolled = useLanding((state) => state.scrolled);
	const activeScene = useLanding((state) => state.activeScene);

	return (
		<header
			className={cn(
				// The ink fades to light with Share's sky (--nt), so it never jumps against a half-dark background.
				"night-ink fixed inset-x-0 top-0 z-70 flex h-16 items-center gap-7 ps-(--gutter) pe-[calc(var(--gutter)+30px)] whitespace-nowrap",
			)}
		>
			<div
				aria-hidden="true"
				className={cn(
					"header-taper pointer-events-none absolute inset-x-0 top-0 -z-1 h-28 transition-opacity duration-[.4s]",
					scrolled ? "opacity-[calc(1-var(--nt,0))]" : "opacity-0",
				)}
			/>

			{/* "allthat" follows the header's night ink; the mark and "work" keep the brand blue. */}
			<a href="#top" className="flex items-center rounded-md">
				<Wordmark height={30} className="text-inherit" />
			</a>

			<nav aria-label={t`Story`} className="mx-auto hidden items-center gap-0.5 min-[1240px]:flex">
				{getStoryScenes().map(({ scene, label }) => {
					const active = activeScene === scene;
					return (
						<button
							key={scene}
							type="button"
							aria-current={active ? "step" : undefined}
							onClick={() => goToScene(scene, 0.04)}
							className={cn(
								"font-martian flex h-[34px] items-center gap-[7px] rounded-full px-[11px] text-[11px] leading-none font-medium tracking-[.08em] uppercase font-stretch-[87.5%] transition-opacity duration-300",
								!active && "opacity-65 hover:opacity-100",
							)}
						>
							<span
								aria-hidden="true"
								className={cn("size-1.5 rounded-full transition-colors duration-300", active && "bg-accent")}
							/>
							{label}
						</button>
					);
				})}
			</nav>

			<div className="ms-auto flex items-center gap-2">
				<CtaLink size="header" />
			</div>
		</header>
	);
}

/**
 * The only theme switch: a pull cord with a line-drawn bulb, hanging at the top corner. It sways every few seconds
 * until it's first pulled, and the bulb lights up in dark mode.
 */
export function ThemeCord() {
	const { resolvedTheme, toggleTheme } = useTheme();
	const [pulling, setPulling] = useState(false);
	const [pulledOnce, setPulledOnce] = useState(false);
	const timeout = useRef(0);

	useEffect(() => () => window.clearTimeout(timeout.current), []);

	const pull = () => {
		setPulling(true);
		setPulledOnce(true);
		window.clearTimeout(timeout.current);
		// The theme changes as the cord reaches the bottom of its pull.
		timeout.current = window.setTimeout(() => {
			setPulling(false);
			toggleTheme();
		}, 170);
	};

	const label = resolvedTheme === "dark" ? t`Switch to light mode` : t`Switch to dark mode`;

	return (
		<button
			type="button"
			onClick={pull}
			aria-label={label}
			title={label}
			className={cn(
				"night-ink fixed end-[clamp(8px,1.2vw,18px)] top-0 z-72 flex w-[30px] origin-top flex-col items-center [transition:height_.45s_cubic-bezier(.3,1.7,.5,1)]",
				pulling ? "h-[124px]" : "h-[92px] hover:h-[112px]",
				!pulledOnce && "motion-safe:animate-swing",
			)}
		>
			<span aria-hidden="true" className="w-[1.5px] flex-1 bg-current opacity-50" />
			<svg aria-hidden="true" width="30" height="40" viewBox="0 0 30 40" className="flex-none overflow-visible">
				<circle
					cx="15"
					cy="22"
					r="16"
					className="dark:motion-safe:animate-flicker fill-[oklch(0.9_0.14_90)] opacity-0 blur-[6px] transition-opacity duration-500 dark:opacity-35"
				/>
				<rect x="11.5" y="2" width="7" height="6" rx="1.2" fill="currentColor" opacity="0.75" />
				<path d="M11.8 5h6.4M11.8 7h6.4" strokeWidth="0.8" opacity="0.6" className="stroke-bg" />
				<path
					d="M11.5 8 C11.5 12 5 15 5 22 a10 10 0 0 0 20 0 C25 15 18.5 12 18.5 8 Z"
					stroke="currentColor"
					strokeWidth="1.3"
					className="fill-[color-mix(in_oklch,var(--bg)_60%,transparent)] transition-[fill] duration-[.4s] dark:fill-[oklch(0.95_0.11_92)]"
				/>
				<path
					d="M12.5 10 V16 M17.5 10 V16 M12.5 16 c0 3 1 4 1.25 5 c.25-1 .5-2 1.25-2 c.75 0 1 1 1.25 2 c.25-1 1.25-2 1.25-5"
					fill="none"
					strokeWidth="1"
					strokeLinecap="round"
					className="stroke-current opacity-55 dark:stroke-[oklch(0.7_0.16_60)] dark:opacity-100"
				/>
			</svg>
		</button>
	);
}
