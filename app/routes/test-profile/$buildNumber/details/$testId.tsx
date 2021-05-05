import { Fragment, useContext } from "react";
import type { LoaderFunction, MetaFunction } from "remix";
import { json, Link, useRouteData } from "remix";
import { Context } from "../../../../components/TestProfileContext";
import type {
  ProfilerReport,
  TestProfileData,
} from "../../../../components/TestProfileContext";

interface AppData {
  testId: string;
}

export let loader: LoaderFunction = async ({ params }) => {
  const testId = params.testId;

  return json({
    testId,
  });
};

export let meta: MetaFunction = (args) => {
  const { params, parentsData } = args;
  const { testProfileDetails }: TestProfileData = parentsData[
    "routes/test-profile/$buildNumber"
  ];

  return {
    title: `${testProfileDetails.label}: ${params.testId}`,
  };
};

interface TimingAnalysisProps {
  timings: number[];
  format: (n: number) => string;
}

function TimingAnalysisMean(props: TimingAnalysisProps) {
  const { format, timings } = props;
  const mean = timings.sort((a, b) => a - b)[timings.length >> 1];

  const details = `mean:\n  ${mean}\nvalues:\n${timings.join("\n")}`;

  return <span title={details}>{format(mean)}</span>;
}

function ProfilerInteractions(props: {
  interactions: { id: number; name: string }[];
}) {
  const { testProfileDetails } = useContext(Context);

  const interactions = props.interactions.map((interaction) => {
    const traceByStackMatch = interaction.name.match(
      /^([^:]+):(\d+):\d+ \(([^)]+)\)$/
    );
    if (traceByStackMatch === null) {
      const unknownLineMatch = interaction.name.match(
        /^unknown line \(([^)]+)\)$/
      );
      return (
        <li key={interaction.id}>
          {unknownLineMatch?.[1] ?? interaction.name}
        </li>
      );
    }
    const [, filename, lineNumber, interactionName] = traceByStackMatch;
    return (
      <li key={interaction.id}>
        <a
          href={`${testProfileDetails.codeUrl}/${filename}#L${lineNumber}`}
          rel="noreferrer noopener"
          target="_blank"
        >
          {interactionName}@L{lineNumber}
        </a>
      </li>
    );
  });

  return <ul>{interactions}</ul>;
}

function formatMs(ms: number): string {
  return ms.toFixed(2);
}

export default function TestId() {
  const { testId } = useRouteData<AppData>();
  const { testProfiles } = useContext(Context);

  const profilesByBrowserName: Record<
    string,
    Array<{
      phase: ProfilerReport["phase"];
      actualDuration: ProfilerReport["actualDuration"][];
      baseDuration: ProfilerReport["baseDuration"][];
      startTime: ProfilerReport["startTime"][];
      commitTime: ProfilerReport["commitTime"][];
      interactions: ProfilerReport["interactions"];
    }>
  > = {};
  testProfiles.forEach(({ browserName, profile }) => {
    const testProfiles = profile[testId];
    if (testProfiles?.length > 0) {
      // squash {a: T, b: U}[] to {a: T[], b: U[]}
      if (profilesByBrowserName[browserName] === undefined) {
        profilesByBrowserName[browserName] = testProfiles.map((testProfile) => {
          return {
            phase: testProfile.phase,
            actualDuration: [testProfile.actualDuration],
            baseDuration: [testProfile.baseDuration],
            startTime: [testProfile.startTime],
            commitTime: [testProfile.commitTime],
            interactions: testProfile.interactions,
          };
        });
      } else {
        testProfiles.forEach((testProfile, interactionIndex) => {
          let interaction =
            profilesByBrowserName[browserName][interactionIndex];

          if (interaction === undefined) {
            // invariant number of interactions in
            // 209850/details/<Accordion%20%2F>%20should%20be%20controlled in FireFox
            profilesByBrowserName[browserName][interactionIndex] = {
              phase: testProfile.phase,
              actualDuration: [testProfile.actualDuration],
              baseDuration: [testProfile.baseDuration],
              startTime: [testProfile.startTime],
              commitTime: [testProfile.commitTime],
              interactions: testProfile.interactions,
            };
          } else {
            interaction.actualDuration.push(testProfile.actualDuration);
            interaction.baseDuration.push(testProfile.baseDuration);
            interaction.startTime.push(testProfile.startTime);
            interaction.commitTime.push(testProfile.commitTime);
          }
        });
      }
    }
  });

  return (
    <Fragment>
      <Link to="../..">Back</Link>
      <table>
        <caption>
          Profiles for <em>{testId}</em>
        </caption>
        <thead>
          <tr>
            {Object.keys(profilesByBrowserName).map((browserName) => {
              return <th key={browserName}>{browserName}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            {Object.keys(profilesByBrowserName).map((browserName) => {
              const renders = profilesByBrowserName[browserName];

              return (
                <td key={browserName}>
                  <table>
                    <thead>
                      <tr>
                        <th>phase</th>
                        <th>actual</th>
                        <th>base</th>
                        <th>interactions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renders.map((render, interactionIndex) => {
                        return (
                          <tr key={interactionIndex}>
                            <td>{render.phase}</td>
                            <td
                              align="right"
                              style={{ fontVariantNumeric: "tabular-nums" }}
                            >
                              <TimingAnalysisMean
                                format={formatMs}
                                timings={render.actualDuration}
                              />
                            </td>
                            <td
                              align="right"
                              style={{ fontVariantNumeric: "tabular-nums" }}
                            >
                              <TimingAnalysisMean
                                format={formatMs}
                                timings={render.baseDuration}
                              />
                            </td>
                            <td>
                              <ProfilerInteractions
                                interactions={render.interactions}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <h2>Explainer</h2>
      <dl>
        <dt>actual</dt>
        <dd>mean actualDuration in ms</dd>
        <dt>base</dt>
        <dd>mean baseDuration in ms</dd>
        <dt>interactions</dt>
        <dd>traced interactions linking to the code that triggered it.</dd>
      </dl>
      <p>
        For more information check{" "}
        <a
          href="https://github.com/reactjs/rfcs/blob/master/text/0051-profiler.md#detailed-design"
          rel="noreferrer noopener"
          target="_blank"
        >
          React.Profiler RFC
        </a>
      </p>
    </Fragment>
  );
}
