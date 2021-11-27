import { Fragment, ReactNode, useId, useMemo, useState } from "react";
import {
	json,
	type HeadersFunction,
	type LoaderFunction,
	useCatch,
	useLoaderData,
} from "remix";
import prettyBytes from "pretty-bytes";

const enableCaching = true;
const cacheEpoch = 1;

interface Size {
	parsed: {
		previous: number;
		current: number;
		absoluteDiff: number;
		relativeDiff: number;
	};
	gzip: {
		previous: number;
		current: number;
		absoluteDiff: number;
		relativeDiff: number;
	};
}

const nullSnapshot = { parsed: 0, gzip: 0 };

interface AppData {
	main: [string, Size][];
}

interface SizeSnapshot {
	[bundleId: string]: { parsed: number; gzip: number };
}

async function downloadSnapshot(downloadUrl: string): Promise<SizeSnapshot> {
	const response = await fetch(downloadUrl);
	const snapshot = await response.json();
	return snapshot;
}

async function fetchS3SizeSnapshot(
	ref: string,
	commitId: string
): Promise<SizeSnapshot> {
	const artifactServer =
		"https://s3.eu-central-1.amazonaws.com/mui-org-material-ui";

	const downloadUrl = `${artifactServer}/artifacts/${ref}/${commitId}/size-snapshot.json`;
	const sizeSnapshot = downloadSnapshot(downloadUrl);

	return sizeSnapshot;
}

interface CircleCIApiArtifacts {
	items: ReadonlyArray<{ path: string; url: string }>;
}

async function fetchCircleCISizeSnapshot(
	buildNumber: number
): Promise<SizeSnapshot> {
	const response = await fetch(
		`https://circleci.com/api/v2/project/gh/mui-org/material-ui/${buildNumber}/artifacts`
	);
	const body: CircleCIApiArtifacts = await response.json();

	if (response.status === 200) {
		const artifacts = body.items;
		const artifact = artifacts.find(
			(artifact) => artifact.path === "size-snapshot.json"
		);

		return downloadSnapshot(artifact!.url);
	}

	throw new Error(`${response.status}: ${response.statusText}`);
}

async function digest(message: string): Promise<string> {
	// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest#converting_a_digest_to_a_hex_string
	const msgUint8 = new TextEncoder().encode(`v${cacheEpoch}-${message}`);
	const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return hashHex;
}

export let headers: HeadersFunction = ({ loaderHeaders }) => {
	return {
		"Cache-Control": loaderHeaders.get("Cache-Control")!,
		ETag: loaderHeaders.get("ETag")!,
	};
};

export let loader: LoaderFunction = async ({ request }) => {
	let params = new URL(request.url).searchParams;
	let baseCommit = params.get("baseCommit")!;
	let baseRef = params.get("baseRef")!;
	let prNumber = +params.get("prNumber")!;
	let circleCIBuildNumber = +params.get("circleCIBuildNumber")!;

	const etag = await digest(`v1-${params.toString()}`);
	const headers = new Headers();
	headers.set("ETag", etag);
	headers.set("Cache-Control", "immutable, max-age=86400");

	if (enableCaching) {
		const ifNoneMatch = request.headers.get("if-none-match");
		if (ifNoneMatch === etag) {
			// No need to download every artifact again since they're immutable.
			const response = new Response(null, { status: 304, headers });

			return response;
		}
	}

	const [baseSnapshot, targetSnapshot] = await Promise.all([
		fetchS3SizeSnapshot(baseRef, baseCommit),
		fetchCircleCISizeSnapshot(circleCIBuildNumber),
	]).catch((error) => {
		throw json({ prNumber }, { status: 404, statusText: String(error) });
	});

	const bundleKeys = Object.keys({ ...baseSnapshot, ...targetSnapshot });

	const main: [string, Size][] = [];
	bundleKeys.forEach((bundle) => {
		// current vs previous based off: https://github.com/mui-org/material-ui/blob/f1246e829f9c0fc9458ce951451f43c2f166c7d1/scripts/sizeSnapshot/loadComparison.js#L32
		// if a bundle was added the change should be +inf
		// if a bundle was removed the change should be -100%
		const currentSize = targetSnapshot[bundle] || nullSnapshot;
		const previousSize = baseSnapshot[bundle] || nullSnapshot;

		const entry: [string, Size] = [
			bundle,
			{
				parsed: {
					previous: previousSize.parsed,
					current: currentSize.parsed,
					absoluteDiff: currentSize.parsed - previousSize.parsed,
					relativeDiff: currentSize.parsed / previousSize.parsed - 1,
				},
				gzip: {
					previous: previousSize.gzip,
					current: currentSize.gzip,
					absoluteDiff: currentSize.gzip - previousSize.gzip,
					relativeDiff: currentSize.gzip / previousSize.gzip - 1,
				},
			},
		];

		main.push(entry);
	});

	let data: AppData = { main };
	return json(data, { headers });
};

export function CatchBoundary() {
	let {
		data: { prNumber },
		statusText,
	} = useCatch();
	console.error(statusText);

	return (
		<p>
			Could not load comparison for{" "}
			<a href={`https://github.com/mui-org/material-ui/pull/${prNumber}`}>
				#{prNumber}
			</a>
			. This can happen if the build in the CI job didn't finish yet.{" "}
			<a href="">Reload this page</a> once the CI job has finished.
		</p>
	);
}

function getMainBundleLabel(bundleId: string): string {
	if (
		bundleId === "packages/material-ui/build/umd/material-ui.production.min.js"
	) {
		return "@mui/material[umd]";
	}
	if (bundleId === "@material-ui/core/Textarea") {
		return "TextareaAutosize";
	}
	if (bundleId === "docs.main") {
		return "docs:/_app";
	}
	if (bundleId === "docs.landing") {
		return "docs:/";
	}

	return (
		bundleId
			// package renames
			.replace(/^@material-ui\/core$/, "@mui/material")
			.replace(/^@material-ui\/core.legacy$/, "@mui/material.legacy")
			.replace(/^@material-ui\/icons$/, "@mui/material-icons")
			.replace(/^@material-ui\/unstyled$/, "@mui/core")
			// org rename
			.replace(/^@material-ui\/([\w-]+)$/, "@mui/$1")
			// path renames
			.replace(
				/^packages\/material-ui\/material-ui\.production\.min\.js$/,
				"packages/mui-material/material-ui.production.min.js"
			)
			.replace(/^@material-ui\/core\//, "")
			.replace(/\.esm$/, "")
	);
}

function ComparisonTable({
	defaultOpen,
	label,
	entries,
}: {
	defaultOpen?: boolean;
	label: ReactNode;
	entries: [string, Size][];
}) {
	let [open, setOpen] = useState(Boolean(defaultOpen));
	let labelId = useId();

	const rows = useMemo(() => {
		return (
			entries
				.map(([bundleId, size]): [string, Size & { id: string }] => [
					getMainBundleLabel(bundleId),
					{ ...size, id: bundleId },
				])
				// orderBy(|parsedDiff| DESC, |gzipDiff| DESC, name ASC)
				.sort(([labelA, statsA], [labelB, statsB]) => {
					const compareParsedDiff =
						Math.abs(statsB.parsed.absoluteDiff) -
						Math.abs(statsA.parsed.absoluteDiff);
					const compareGzipDiff =
						Math.abs(statsB.gzip.absoluteDiff) -
						Math.abs(statsA.gzip.absoluteDiff);
					const compareName = labelA.localeCompare(labelB);

					if (compareParsedDiff === 0 && compareGzipDiff === 0) {
						return compareName;
					}
					if (compareParsedDiff === 0) {
						return compareGzipDiff;
					}
					return compareParsedDiff;
				})
		);
	}, [entries]);

	/**
	 * Generates a user-readable string from a percentage change
	 * @param change
	 * @param goodEmoji emoji on reduction
	 * @param badEmoji emoji on increase
	 */
	function addPercent(
		change: number,
		goodEmoji: string = "",
		badEmoji: string = ":small_red_triangle:"
	): string {
		const formatted = (change * 100).toFixed(2);
		if (/^-|^0(?:\.0+)$/.test(formatted)) {
			return `${formatted}% ${goodEmoji}`;
		}
		return `+${formatted}% ${badEmoji}`;
	}

	function formatDiff(absoluteChange: number, relativeChange: number): string {
		if (absoluteChange === 0) {
			return "--";
		}

		const trendIcon = absoluteChange < 0 ? "▼" : "▲";

		return `${trendIcon} ${prettyBytes(absoluteChange, {
			signed: true,
		})} (${addPercent(relativeChange, "", "")})`;
	}

	return (
		<details open={open} onClick={() => setOpen((pendingOpen) => !pendingOpen)}>
			<summary id={labelId}>{label}</summary>
			<table aria-labelledby={labelId}>
				<thead>
					<tr>
						<th>bundle</th>
						<th>size change</th>
						<th>size</th>
						<th>Gzip change</th>
						<th>Gzip</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(([label, { parsed, gzip, id }]) => {
						return (
							<tr key={id}>
								<td>{label}</td>
								<td align="right">
									{formatDiff(parsed.absoluteDiff, parsed.relativeDiff)}
								</td>
								<td align="right">{prettyBytes(parsed.current)}</td>
								<td align="right">
									{formatDiff(gzip.absoluteDiff, gzip.relativeDiff)}
								</td>
								<td align="right">{prettyBytes(gzip.current)}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</details>
	);
}

export default function SizeComparison() {
	let { main }: AppData = useLoaderData();

	return (
		<Fragment>
			<h1>Size Comparison</h1>
			<ComparisonTable label="Modules" entries={main} defaultOpen />
		</Fragment>
	);
}
