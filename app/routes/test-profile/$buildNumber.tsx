import React, { Fragment } from "react";
import { Outlet } from "react-router-dom";
import type { LoaderFunction, MetaFunction } from "remix";
import { json, useRouteData } from "remix";
import { Context } from "../../components/TestProfileContext";
import type {
  TestProfileData,
  TestProfileDetails,
  TestProfiles,
} from "../../components/TestProfileContext";

function Heading({
  children,
}: {
  children: React.ReactNode;
  level: "1" | "2" | "3" | "4" | "5";
}) {
  return <h1>{children}</h1>;
}

async function fetchCircleCIApiV2<Data>(endpoint: string): Promise<Data> {
  const apiEndpoint = `https://circleci.com/api/v2/`;
  const url = `${apiEndpoint}${endpoint}`;

  const response = await fetch(url, {
    headers: { "Circle-Token": String(process.env.CIRCLE_TOKEN) },
  });
  const json = await response.json();
  return json;
}

interface CircleCIJobDetails {
  pipeline: {
    id: string;
  };
  web_url: string;
}

async function fetchCircleCIJobDetails(
  jobNumber: number
): Promise<CircleCIJobDetails> {
  return fetchCircleCIApiV2<CircleCIJobDetails>(
    `project/github/mui-org/material-ui/job/${jobNumber}`
  );
}

interface CircleCIPipeline {
  vcs: {
    branch: string;
    origin_repository_url: string;
    revision: string;
  };
}

async function fetchCircleCIPipelineDetails(
  pipelineId: string
): Promise<CircleCIPipeline> {
  return fetchCircleCIApiV2<CircleCIPipeline>(`pipeline/${pipelineId}`);
}

interface CircleCIPipeline {}

/**
 * Computes a URL to github where the change relevant to this PR is reviewable.
 *
 * The relevant change is the full PR if the pipeline ran on a PR.
 * Otherwise it's the commit associated with this pipeline.
 *
 * @param pipeline
 * @returns string
 */
function computeReviewUrl(pipeline: CircleCIPipeline): string {
  const { branch } = pipeline.vcs;
  const pullMatch =
    branch !== undefined ? branch.match(/pull\/(\d+)\/(head|merge)/) : null;

  if (pullMatch === null) {
    return `${pipeline.vcs.origin_repository_url}/commit/${pipeline.vcs.revision}/`;
  }
  return `${pipeline.vcs.origin_repository_url}/pull/${pullMatch[1]}/`;
}

function computeLabel(pipeline: CircleCIPipeline): string {
  const { branch, revision } = pipeline.vcs;
  if (branch === undefined) {
    return "Unknown";
  }

  const pullMatch = branch.match(/pull\/(\d+)\//);
  if (pullMatch !== null) {
    return `#${pullMatch[1]}`;
  }

  return `${branch} (${revision.slice(0, 8)})`;
}

async function fetchCircleCIArtifactsInfos(
  buildNumber: number
): Promise<Array<{ pretty_path: string; url: string }>> {
  const apiEndpoint = `https://circleci.com/api/v1.1/`;
  const url = `${apiEndpoint}project/github/mui-org/material-ui/${buildNumber}/artifacts`;

  const response = await fetch(url);
  const json = await response.json();
  return json;
}

interface TestProfileArtifactsInfo {
  browserName: string;
  timestamp: number;
  url: string;
}

async function fetchTestProfileArtifactsInfos(
  buildNumber: number
): Promise<TestProfileArtifactsInfo[]> {
  const infos = await fetchCircleCIArtifactsInfos(buildNumber);

  return infos
    .map((artifactInfo) => {
      const match = artifactInfo.pretty_path.match(
        /^react-profiler-report\/karma\/([^/]+)\/(\d+)\.json$/
      );
      if (match === null) {
        return null;
      }
      const [, browserName, timestampRaw] = match;
      const timestamp = parseInt(timestampRaw, 10);

      return {
        browserName,
        timestamp,
        url: artifactInfo.url,
      };
    })
    .filter(
      (
        maybeTestProfileArtifact
      ): maybeTestProfileArtifact is TestProfileArtifactsInfo => {
        return maybeTestProfileArtifact !== null;
      }
    );
}

async function fetchTestProfileDetails(
  buildNumber: number
): Promise<TestProfileDetails> {
  const job = await fetchCircleCIJobDetails(buildNumber);
  const pipeline = await fetchCircleCIPipelineDetails(job.pipeline.id);

  return {
    codeUrl: `${pipeline.vcs.origin_repository_url}/tree/${pipeline.vcs.revision}/`,
    label: computeLabel(pipeline),
    reviewUrl: computeReviewUrl(pipeline),
    webUrl: job.web_url,
  };
}

async function fetchTestProfiles(buildNumber: number): Promise<TestProfiles> {
  const infos = await fetchTestProfileArtifactsInfos(buildNumber);
  return Promise.all(
    infos.map(
      async (info): Promise<TestProfiles[0]> => {
        const response = await fetch(info.url);
        const testProfileArtifact = await response.json();

        return {
          browserName: info.browserName,
          profile: testProfileArtifact,
          timestamp: info.timestamp,
        };
      }
    )
  );
}

type AppData = TestProfileData;

export let loader: LoaderFunction = async ({ params }) => {
  // TODO: validate input
  const buildNumber = +params.buildNumber;

  const [testProfiles, testProfileDetails] = await Promise.all([
    fetchTestProfiles(buildNumber),
    fetchTestProfileDetails(buildNumber),
  ]);

  if (testProfiles.length === 0) {
    return json(
      { buildNumber },
      { status: 404, statusText: "Build contains no profiling artifacts" }
    );
  }

  return json({
    testProfileDetails,
    testProfiles,
  });
};

export let meta: MetaFunction = (args) => {
  const data: AppData = args.data;

  return {
    title: `${data.testProfileDetails.label} | Profile Dashboard`,
  };
};

export default function TestProfileLayout() {
  const { testProfiles, testProfileDetails } = useRouteData<AppData>();

  return (
    <Fragment>
      <Heading level="2">
        Tests for{" "}
        <a
          href={testProfileDetails.reviewUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {testProfileDetails.label}
        </a>
      </Heading>
      <Context.Provider value={{ testProfileDetails, testProfiles }}>
        <Outlet />
      </Context.Provider>
    </Fragment>
  );
}
