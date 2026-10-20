import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { localeSchema } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { prefersReducedMotion, SCENE, useLanding } from "./scroll";
import { CtaLink, Doodle, labelClass } from "./ui";
import { orpc } from "@/libs/orpc/client";

const crowdinUrl = "https://crowdin.com/project/reactive-resume";
// The statistics service caches the totals for six hours.
const statisticsStaleTime = 6 * 60 * 60 * 1000;
// A fresh self-hosted install has a handful of users; a total that small reads as a joke, so it isn't shown.
const smallestTotalShown = 100;

type RollingNumberProps = { value: number; roll: boolean; delay: number };

/** A total whose digits roll up into place, one column per digit, in the locale's own digits. */
function RollingNumber({ value, roll, delay }: RollingNumberProps) {
	const { i18n } = useLingui();
	const text = i18n.number(value);
	const digits = Array.from({ length: 10 }, (_, digit) => i18n.number(digit));

	return (
		<>
			<span className="sr-only">{text}</span>
			<span aria-hidden="true" dir="ltr" className="inline-flex">
				{Array.from(text).map((character, index) => {
					const digit = digits.indexOf(character);
					return (
						<span key={index} className="inline-block h-[1.15em] overflow-hidden">
							<span
								className="flex translate-y-[calc(var(--offset)*1.15em)] flex-col transition-transform duration-[2s] ease-[cubic-bezier(.2,.8,.2,1)] starting:translate-y-0"
								style={
									{
										"--offset": roll ? -Math.max(0, digit) : 0,
										transitionDelay: `${delay + index * 80}ms`,
									} as CSSProperties
								}
							>
								{digit === -1 ? (
									<span className="h-[1.15em] leading-[1.15]">{character}</span>
								) : (
									digits.map((glyph) => (
										<span key={glyph} className="h-[1.15em] leading-[1.15]">
											{glyph}
										</span>
									))
								)}
							</span>
						</span>
					);
				})}
			</span>
		</>
	);
}

/** 08 Numbers: the live community totals, side by side, each figure over what it counts. */
export function Numbers() {
	const inView = useLanding((state) => state.numbersInView);
	const { data } = useQuery(orpc.statistics.getTotals.queryOptions({ staleTime: statisticsStaleTime }));
	const { data: stars } = useQuery(
		orpc.statistics.github.getStarCount.queryOptions({ staleTime: statisticsStaleTime }),
	);
	const rows = [
		{ label: t`People using it`, detail: t`writing, tailoring and sending`, value: data?.users },
		{ label: t`Resumes created`, detail: t`and counting`, value: data?.resumes },
		{ label: t`Stars on GitHub`, detail: t`from developers who back it`, value: stars },
	].filter((row) => row.value == null || row.value >= smallestTotalShown);
	if (rows.length === 0) return null;

	return (
		<section
			data-scene={SCENE.numbers}
			aria-labelledby="numbers-title"
			className="relative mx-auto max-w-[1440px] px-(--gutter) pt-[20vh] pb-[14vh]"
		>
			<h2 id="numbers-title" className={cn(labelClass, "text-ink-3")}>
				{t`In good company`}
			</h2>
			<dl
				className="@container mt-8 grid border-t border-line min-[900px]:grid-cols-(--columns)"
				style={{ "--columns": `repeat(${rows.length}, minmax(0, 1fr))`, "--count": rows.length } as CSSProperties}
			>
				{rows.map((row, index) => (
					<div
						key={row.label}
						className="flex flex-col-reverse justify-end gap-7 border-b border-line py-[6vh] min-[900px]:border-e min-[900px]:border-b-0 min-[900px]:pe-8 min-[900px]:not-first:ps-8 min-[900px]:last:border-e-0 min-[1200px]:pe-12 min-[1200px]:not-first:ps-12"
					>
						<dt className="flex flex-col gap-2">
							<span className={cn(labelClass, "text-ink-3")}>{row.label}</span>
							<span className="font-display text-[clamp(18px,1.6vw,24px)] leading-[1.3] text-ink-2 italic">
								{row.detail}
							</span>
						</dt>
						<dd className="font-anybody text-[clamp(44px,14cqi,80px)] leading-none font-light tracking-[-.03em] text-ink tabular-nums min-[900px]:text-[clamp(40px,calc(15cqi/var(--count)),80px)]">
							{row.value == null ? (
								<span className="text-ink-3">
									<span aria-hidden="true">—</span>
									<span className="sr-only">{t`Loading the total`}</span>
								</span>
							) : (
								<RollingNumber value={row.value} roll={inView} delay={index * 150} />
							)}
						</dd>
					</div>
				))}
			</dl>
			<p className="border-t border-line pt-5 font-ui text-[13px] text-ink-3 max-[900px]:border-t-0">{t`Live totals, refreshed every 6 hours.`}</p>
		</section>
	);
}

/** The word for "résumé" in sixteen languages, each in its own script and direction, whatever the page's locale. */
const words = [
	{ word: "Résumé", language: "Français", lang: "fr" },
	{ word: "Lebenslauf", language: "Deutsch", lang: "de" },
	{ word: "Currículum", language: "Español", lang: "es" },
	{ word: "履歴書", language: "日本語", lang: "ja" },
	{ word: "Życiorys", language: "Polski", lang: "pl" },
	{ word: "السيرة الذاتية", language: "العربية", lang: "ar", dir: "rtl" },
	{ word: "Currículo", language: "Português", lang: "pt" },
	{ word: "简历", language: "中文", lang: "zh" },
	{ word: "Özgeçmiş", language: "Türkçe", lang: "tr" },
	{ word: "Резюме", language: "Русский", lang: "ru" },
	{ word: "이력서", language: "한국어", lang: "ko" },
	{ word: "קורות חיים", language: "עברית", lang: "he", dir: "rtl" },
	{ word: "Životopis", language: "Čeština", lang: "cs" },
	{ word: "Βιογραφικό", language: "Ελληνικά", lang: "el" },
	{ word: "बायोडाटा", language: "हिन्दी", lang: "hi" },
	{ word: "Curriculum", language: "Italiano", lang: "it" },
];

/** 09 Languages. The word turns over every 1.9s while the section is near; it can be paused. */
export function Languages() {
	const { i18n } = useLingui();
	const languageCount = i18n.number(localeSchema.options.length - 1);
	const near = useLanding((state) => state.activeScene >= SCENE.numbers && state.activeScene <= SCENE.faq);
	const reducedMotion = useLanding((state) => state.reducedMotion);
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const current = words[index % words.length] ?? words[0];
	const previous = words[(index - 1) % words.length];

	useEffect(() => {
		if (!near || paused || prefersReducedMotion()) return;
		const timer = window.setInterval(() => setIndex((value) => value + 1), 1900);
		return () => window.clearInterval(timer);
	}, [near, paused, reducedMotion]);

	return (
		<section
			data-scene={SCENE.languages}
			aria-labelledby="languages-title"
			className="relative flex flex-col items-center gap-[22px] overflow-hidden px-(--gutter) py-[14vh] text-center"
		>
			<Doodle
				name="globe"
				wipe="clamp(0, (var(--p) - .25) / .2, 1)"
				className="start-[6vw] top-[10vh] w-[11vw] translate-y-[calc(var(--p)*-40px)] rotate-[-6deg] max-[900px]:hidden"
			/>
			<h2 id="languages-title" className={cn(labelClass, "text-ink-3")}>
				{t`Speaks your language`}
			</h2>
			<div
				aria-hidden="true"
				className="font-anybody h-[1.25em] w-full overflow-hidden text-[clamp(48px,7.5vw,140px)] leading-[1.25] font-light tracking-[-.03em] text-ink"
			>
				<div
					key={index}
					className={cn(index > 0 && "motion-safe:animate-language-turn [transform:translateY(-1.25em)]")}
				>
					{previous && (
						<div lang={previous.lang} dir={previous.dir} className="h-[1.25em] whitespace-nowrap">
							{previous.word}
						</div>
					)}
					<div lang={current?.lang} dir={current?.dir} className="h-[1.25em] whitespace-nowrap">
						{current?.word}
					</div>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<span
					lang={current?.lang}
					className="font-martian text-[12px] leading-[1.4] font-medium tracking-[.1em] text-accent-text"
				>
					{current?.language}
				</span>
				<button
					type="button"
					onClick={() => setPaused((value) => !value)}
					aria-label={paused ? t`Play the list of languages` : t`Pause the list of languages`}
					className="grid size-6 place-items-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink motion-reduce:hidden"
				>
					<Icon name={paused ? "play" : "pause"} size={16} filled />
				</button>
			</div>
			<p className="mt-3 max-w-[30em] font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
				<a
					href={crowdinUrl}
					className="text-accent-text italic underline underline-offset-[3px] transition-colors hover:text-accent-hover"
				>
					{t`Translated into ${languageCount} languages. Help translate it into yours.`}
				</a>
			</p>
		</section>
	);
}

/**
 * 12 Closing call to action. The story hands over: Alex's Fieldnote card rests at Interview on the board Tailor
 * started, and an empty card waits under Saved for the reader's own.
 */
export function Closing() {
	const stages = [
		{ label: t`Saved`, dot: "bg-stage-saved" },
		{ label: t`Applied`, dot: "bg-stage-applied" },
		{ label: t`Interview`, dot: "bg-stage-interview" },
		{ label: t`Offer`, dot: "bg-stage-offer" },
	];

	return (
		<section
			aria-labelledby="closing-title"
			className="relative mx-auto flex max-w-[1440px] flex-col items-center gap-7 border-t border-line px-(--gutter) pt-[16vh] pb-[18vh] text-center"
		>
			<div
				aria-hidden="true"
				className="mb-4 w-[min(100%,560px)] rounded-[14px] border border-dashed border-line-2 px-3.5 py-3"
			>
				<div className="font-martian grid grid-cols-4 gap-2 text-[10px] leading-none font-medium tracking-[.06em] text-ink-3 uppercase">
					{stages.map((stage) => (
						<span key={stage.label} className="flex min-w-0 items-center gap-[5px]">
							<span className={cn("size-[7px] shrink-0 rounded-full", stage.dot)} />
							{stage.label}
						</span>
					))}
				</div>
				<div className="mt-2.5 grid grid-cols-4 gap-2 text-start">
					<span className="flex h-11 items-center justify-center rounded-[9px] border-[1.5px] border-dashed border-accent font-display text-[15px] text-accent-text italic">
						{t`Yours`}
					</span>
					<span className="col-start-3 flex h-11 min-w-0 flex-col justify-center rounded-[9px] border border-line bg-raised px-2 font-ui text-[11.5px] leading-[1.2] font-semibold text-ink shadow-e2">
						{t`Fieldnote`}
						<span className="truncate text-[10.5px] font-normal text-ink-3">{t`Interview done`}</span>
					</span>
				</div>
			</div>
			<span className={cn(labelClass, "text-ink-3")}>{t`Your turn`}</span>
			<h2
				id="closing-title"
				className="font-anybody text-[clamp(48px,6vw,108px)] leading-none font-light tracking-[-.03em] text-balance text-ink"
			>
				<Trans>
					Put it all on <em className="font-display font-normal text-accent-text italic">one page.</em>
				</Trans>
			</h2>
			<p className="max-w-[28em] font-display text-[clamp(17px,1.4vw,21px)] leading-normal text-pretty text-ink-2">
				{t`Start from scratch or import what you have. It takes a few minutes, and you can come back to it anytime.`}
			</p>
			<CtaLink size="closing" />
		</section>
	);
}
