import { Fragment, ReactNode, useId, useMemo, useState } from "react";
import { json, type LoaderFunction, useCatch, useLoaderData } from "remix";
import prettyBytes from "pretty-bytes";

const enableCaching = true;

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
	pages: [string, Size][];
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
	const msgUint8 = new TextEncoder().encode(message);
	const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return hashHex;
}

export let loader: LoaderFunction = async ({ request }) => {
	let params = new URL(request.url).searchParams;
	let baseCommit = params.get("baseCommit")!;
	let baseRef = params.get("baseRef")!;
	let prNumber = +params.get("prNumber")!;
	let circleCIBuildNumber = +params.get("circleCIBuildNumber")!;

	const ifNoneMatch = request.headers.get("if-none-match");
	const etag = await digest(`v1-${params.toString()}`);
	const headers = new Headers();
	headers.set("ETag", etag);
	headers.set("Cache-Control", "immutable, max-age=86400");

	if (enableCaching) {
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
	const pages: [string, Size][] = [];
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

		if (bundle.startsWith("docs:")) {
			pages.push(entry);
		} else {
			main.push(entry);
		}
	});

	let data: AppData = { main, pages };
	return json(data, { headers });
};
