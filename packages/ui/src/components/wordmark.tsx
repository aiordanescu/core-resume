import { APP_NAME } from "@reactive-resume/utils/brand";
import { cn } from "@reactive-resume/utils/style";

// Vector outlines of the All That Work logo, so it renders without fonts. Source files: the brand asset folder.
// The asterisk sits in a 100-unit box (visible 6..94 vertically); letters sit on a 100-unit line (ascender 0, x-height 30, baseline 100).
const MARK =
	"M38.48 8.79Q38.2 6 41 6L59 6Q61.8 6 61.52 8.79L58.93 34.29Q58.9 34.58 59.14 34.41L79.93 19.42Q82.21 17.78 83.61 20.21L92.61 35.79Q94 38.22 91.45 39.37L68.07 49.88Q67.8 50 68.07 50.12L91.45 60.63Q94 61.78 92.61 64.21L83.61 79.79Q82.21 82.22 79.93 80.58L59.14 65.59Q58.9 65.42 58.93 65.71L61.52 91.21Q61.8 94 59 94L41 94Q38.2 94 38.48 91.21L41.07 65.71Q41.1 65.42 40.86 65.59L20.07 80.58Q17.79 82.22 16.39 79.79L7.39 64.21Q6 61.78 8.55 60.63L31.93 50.12Q32.2 50 31.93 49.88L8.55 39.37Q6 38.22 7.39 35.79L16.39 20.21Q17.79 17.78 20.07 19.42L40.86 34.41Q41.1 34.58 41.07 34.29Z";

const A = "M35 30a35 35 0 1 1 0 70a35 35 0 1 1 0-70Zm0 20a15 15 0 1 0 0 30a15 15 0 1 0 0-30ZM52 30H72V100H52Z";
const L = "M0 0H20V100H0Z";
const T = "M17 10H38V31H57V50H38V73Q38 82 48 82H57V100H42Q17 100 17 75V50H0V31H17Z";
const H = "M0 0H21V41Q28 30 43 30Q70 30 70 61V100H49V64Q49 50 38 50Q21 50 21 68V100H0Z";
const W = "M0 31H21L31 73L41 31H59L69 73L79 31H100L80 100H60L50 62L40 100H20Z";
const O = "M35 30a35 35 0 1 1 0 70a35 35 0 1 1 0-70Zm0 20a15 15 0 1 0 0 30a15 15 0 1 0 0-30Z";
const R = "M0 31H20V43Q30 27 49 30V51Q35 49 28 56Q21 63 21 77V100H0Z";
const K = "M0 0H21V57L42 31H67L40 64L67 100H42L21 71V100H0Z";

type Glyph = [x: number, d: string];

const ALLTHAT: Glyph[] = [
	[0, A],
	[78, L],
	[104, L],
	[130, T],
	[193, H],
	[269, A],
	[347, T],
];
const ALLTHAT_WIDTH = 404;

const WORK: Glyph[] = [
	[0, W],
	[106, O],
	[182, R],
	[237, K],
];

/** Distance from the top of "allthat" to the top of "work" when stacked. */
const LINE_ADVANCE = 112;

type Placement = { x: number; y: number; size: number };

function Mark({ x, y, size }: Placement) {
	return <path className="fill-brand" transform={`translate(${x} ${y}) scale(${size / 100})`} d={MARK} />;
}

type LettersProps = Placement & { glyphs: Glyph[]; brand?: boolean };

/** `size` is the height of one 100-unit text line. */
function Letters({ glyphs, x, y, size, brand = false }: LettersProps) {
	return (
		<g className={brand ? "fill-brand" : "fill-current"} transform={`translate(${x} ${y}) scale(${size / 100})`}>
			{glyphs.map(([offset, d]) => (
				<path key={offset} transform={`translate(${offset} 0)`} d={d} />
			))}
		</g>
	);
}

type Layout = { width: number; height: number; render: () => React.ReactNode };

const layouts = {
	/** Mark and a one-line name, for the homepage header. */
	inline: {
		width: 170,
		height: 30,
		render: () => (
			<>
				<Mark x={0} y={0} size={30} />
				<Letters glyphs={ALLTHAT} x={37} y={5} size={18} />
				<Letters glyphs={WORK} x={37 + (ALLTHAT_WIDTH + 26) * 0.18} y={5} size={18} brand />
			</>
		),
	},
	/** Mark above "allthat" over "work", all flush left, for the footer and the auth and error screens. */
	stacked: {
		width: 140,
		height: 130,
		render: () => (
			<>
				<Mark x={-3} y={-3} size={50} />
				<Letters glyphs={ALLTHAT} x={0} y={56} size={34.65} />
				<Letters glyphs={WORK} x={0} y={56 + LINE_ADVANCE * 0.3465} size={34.65} brand />
			</>
		),
	},
	/** Mark beside the stacked name, for the app sidebar. */
	beside: {
		width: 166,
		height: 53,
		render: () => (
			<>
				<Mark x={-3.9} y={-3.6} size={60.2} />
				<Letters glyphs={ALLTHAT} x={64.3} y={0} size={25} />
				<Letters glyphs={WORK} x={64.3} y={LINE_ADVANCE * 0.25} size={25} brand />
			</>
		),
	},
	/** The stacked name without the mark, for the large cropped footer treatment. */
	name: {
		width: ALLTHAT_WIDTH,
		height: LINE_ADVANCE + 100,
		render: () => (
			<>
				<Letters glyphs={ALLTHAT} x={0} y={0} size={100} />
				<Letters glyphs={WORK} x={0} y={LINE_ADVANCE} size={100} brand />
			</>
		),
	},
} satisfies Record<string, Layout>;

type WordmarkProps = Omit<React.ComponentProps<"svg">, "height" | "width"> & {
	variant?: keyof typeof layouts;
	/** Rendered height in px; the width follows. Omit it to size the logo with CSS instead. */
	height?: number;
};

/** The All That Work logo. "allthat" takes the current text color (`text-ink` by default), the mark and "work" the brand blue. */
export function Wordmark({ variant = "inline", height, className, ...props }: WordmarkProps) {
	const layout = layouts[variant];
	const size = height === undefined ? {} : { height, width: (height * layout.width) / layout.height };

	return (
		<svg
			role="img"
			aria-label={APP_NAME}
			viewBox={`0 0 ${layout.width} ${layout.height}`}
			className={cn("shrink-0 overflow-visible text-ink", className)}
			{...size}
			{...props}
		>
			{layout.render()}
		</svg>
	);
}

type LogomarkProps = Omit<React.ComponentProps<"svg">, "height" | "width"> & {
	/** Rendered size in px. */
	size?: number;
};

/** The asterisk alone, for slots too small for the name, like the collapsed sidebar. */
export function Logomark({ size = 32, className, ...props }: LogomarkProps) {
	return (
		<svg
			role="img"
			aria-label={APP_NAME}
			viewBox="0 0 100 100"
			width={size}
			height={size}
			className={cn("shrink-0", className)}
			{...props}
		>
			<Mark x={0} y={0} size={100} />
		</svg>
	);
}
