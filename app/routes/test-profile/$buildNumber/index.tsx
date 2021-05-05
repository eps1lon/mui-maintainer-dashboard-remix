import { Fragment, useContext } from "react";
import { Link } from "remix";
import { Context } from "../../../components/TestProfileContext";
import type {} from "../../../components/TestProfileContext";

interface ProfileAnalysisProps {
  testId: string;
}
function ProfileAnalysis(props: ProfileAnalysisProps) {
  const { testId } = props;

  return (
    <li>
      <Link to={`details/${encodeURIComponent(testId)}`}>{testId}</Link>
    </li>
  );
}

export default function TestProfileIndex() {
  const { testProfiles } = useContext(Context);

  const testIdsWithProfilingData = Array.from(
    new Set(
      testProfiles.reduce((testIdsDuplicated, { profile }) => {
        return testIdsDuplicated.concat(
          Object.keys(profile).filter((testId) => {
            return profile[testId].length > 0;
          })
        );
      }, [] as string[])
    )
  ).sort((a, b) => {
    return a.localeCompare(b);
  });

  return (
    <Fragment>
      <ol>
        {testIdsWithProfilingData.map((testId) => {
          return <ProfileAnalysis key={testId} testId={testId} />;
        })}
      </ol>
    </Fragment>
  );
}
