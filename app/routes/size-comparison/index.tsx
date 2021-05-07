import { Fragment, memo, useCallback, useMemo, Suspense } from "react";
import prettyBytes from "pretty-bytes";
import { json, Response, useRouteData } from "remix";
import type { HeadersFunction, LoaderFunction } from "remix";
import { hash as baseHash } from "../../utils/crypto.server";

function hash(data: string): string {
  // TODO: How does versioning work? Should remix provide a version hash based on file input?
  return baseHash(`v1-${data}`);
}

function Heading({
  children,
}: {
  children: React.ReactNode;
  level: "1" | "2" | "3" | "4" | "5";
}) {
  return <h1>{children}</h1>;
}

/**
 * https://docs.microsoft.com/en-us/rest/api/azure/devops/build/artifacts/list?view=azure-devops-rest-5.1#artifactresource
 */
interface AzureArtifactResource {
  data: string;
  downloadUrl: string;
  properties: object;
  type: string;
  url: string;
}

/**
 * https://docs.microsoft.com/en-us/rest/api/azure/devops/build/artifacts/get?view=azure-devops-rest-4.1&viewFallbackFrom=azure-devops-rest-5.1#buildartifact
 */
interface AzureBuildArtifact {
  id: string;
  name: string;
  resource: AzureArtifactResource;
}

interface AzureApiBody<Response> {
  value: Response;
  message: unknown;
  typeKey: unknown;
}

interface SizeSnapshot {
  [bundleId: string]: { parsed: number; gzip: number };
}

async function fetchArtifact({
  buildId,
  artifactName,
}: {
  buildId: number;
  artifactName: string;
}): Promise<AzureBuildArtifact | undefined> {
  const response = await fetch(
    `https://dev.azure.com/mui-org/material-ui/_apis/build/builds/${buildId}/artifacts?api-version=5.1`
  );

  const body: AzureApiBody<AzureBuildArtifact[]> = await response.json();

  if (response.status === 200) {
    const artifacts = body.value;
    return artifacts.find((artifact) => artifact.name === artifactName);
  }

  throw new Error(`${body.typeKey}: ${body.message}`);
}

async function downloadSnapshot(downloadUrl: string) {
  const response = await fetch(downloadUrl);
  const snapshot = await response.json();
  return snapshot;
}

async function fetchAzureSizeSnapshot(buildId: number): Promise<SizeSnapshot> {
  const snapshotArtifact = await fetchArtifact({
    artifactName: "size-snapshot",
    buildId,
  });

  const downloadUrl = new URL(snapshotArtifact!.resource.downloadUrl);
  downloadUrl.searchParams.set("format", "file");
  downloadUrl.searchParams.set("subPath", "/size-snapshot.json");
  const sizeSnapshot = await downloadSnapshot(downloadUrl.toString());

  return sizeSnapshot;
}

async function fetchS3SizeSnapshot(
  ref: string,
  commitId: string
): Promise<SizeSnapshot> {
  const artifactServer =
    "https://s3.eu-central-1.amazonaws.com/eps1lon-material-ui";

  const downloadUrl = `${artifactServer}/artifacts/${ref}/${commitId}/size-snapshot.json`;
  const sizeSnapshot = downloadSnapshot(downloadUrl);

  return sizeSnapshot;
}

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

const BundleCell = "td";

const CompareTable = memo(function CompareTable({
  entries,
  getBundleLabel,
  renderBundleLabel = getBundleLabel,
}: {
  entries: [string, Size][];
  getBundleLabel: (bundleId: string) => string;
  renderBundleLabel?: (bundleId: string) => string;
}) {
  const rows = useMemo(() => {
    return (
      entries
        .map(([bundleId, size]): [string, Size & { id: string }] => [
          getBundleLabel(bundleId),
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
  }, [entries, getBundleLabel]);

  return (
    <table>
      <thead>
        <tr>
          <BundleCell>bundle</BundleCell>
          <td align="right">Size change</td>
          <td align="right">Size</td>
          <td align="right">Gzip change</td>
          <td align="right">Gzip</td>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, { parsed, gzip, id }]) => {
          return (
            <tr key={label}>
              <BundleCell>{renderBundleLabel(id)}</BundleCell>
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
  );
});

function getMainBundleLabel(bundleId: string): string {
  if (
    bundleId === "packages/material-ui/build/umd/material-ui.production.min.js"
  ) {
    return "@material-ui/core[umd]";
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
  return bundleId.replace(/^@material-ui\/core\//, "").replace(/\.esm$/, "");
}

function getPageBundleLabel(bundleId: string): string {
  // a page
  if (bundleId.startsWith("docs:/")) {
    const page = bundleId.replace(/^docs:/, "");
    return page;
  }

  // shared
  return bundleId;
}

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
function Comparison({
  baseSnapshot,
  prNumber,
  targetSnapshot,
}: {
  baseSnapshot: SizeSnapshot;
  prNumber: number;
  targetSnapshot: SizeSnapshot;
}) {
  const { main: mainResults, pages: pageResults } = useMemo(() => {
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

    return { main, pages };
  }, [baseSnapshot, targetSnapshot]);

  const renderPageBundleLabel = useCallback(
    (bundleId) => {
      // a page
      if (bundleId.startsWith("docs:/")) {
        const page = bundleId.replace(/^docs:/, "");
        const host = `https://deploy-preview-${prNumber}--material-ui.netlify.app`;
        return <a href={`${host}${page}`}>{page}</a>;
      }

      // shared
      return bundleId;
    },
    [prNumber]
  );

  return (
    <Fragment>
      <details open>
        <summary>Modules</summary>
        <CompareTable
          entries={mainResults}
          getBundleLabel={getMainBundleLabel}
        />
      </details>
      <details>
        <summary>Pages</summary>
        <CompareTable
          entries={pageResults}
          getBundleLabel={getPageBundleLabel}
          renderBundleLabel={renderPageBundleLabel}
        />
      </details>
    </Fragment>
  );
}

interface AppData {
  baseSnapshot: SizeSnapshot;
  prNumber: number;
  targetSnapshot: SizeSnapshot;
}

export let loader: LoaderFunction = async ({ request }) => {
  const { searchParams } = new URL(request.url);

  const baseCommit = searchParams.get("baseCommit")!;
  const baseRef = searchParams.get("baseRef")!;
  const buildId = +searchParams.get("buildId")!;
  const prNumber = +searchParams.get("prNumber")!;

  const etag = hash(`${baseCommit}--${baseRef}--${buildId}--${prNumber}`);
  if (etag === request.headers.get("If-None-Match")) {
    return new Response(undefined, { status: 304 });
  }

  try {
    const [baseSnapshot, targetSnapshot] = await Promise.all([
      fetchS3SizeSnapshot(baseRef, baseCommit),
      fetchAzureSizeSnapshot(buildId),
    ]);

    return json(
      { baseSnapshot, targetSnapshot, prNumber },
      {
        headers: {
          "Cache-Control": `max-age=${60 * 60 * 24}`,
          ETag: etag,
        },
      }
    );
  } catch {
    return json({ buildId }, { status: 404 });
  }
};

// The HTTP headers for the server rendered request, just use the cache control
// from the loader.
export let headers: HeadersFunction = ({ loaderHeaders }) => {
  return {
    "Cache-Control": loaderHeaders.get("Cache-Control")!,
    ETag: loaderHeaders.get("ETag")!,
  };
};

export default function SizeComparison() {
  const { baseSnapshot, prNumber, targetSnapshot } = useRouteData<AppData>();

  return (
    <Fragment>
      <Heading level="1">Size comparison</Heading>

      <Comparison
        baseSnapshot={baseSnapshot}
        prNumber={prNumber}
        targetSnapshot={targetSnapshot}
      />
    </Fragment>
  );
}
