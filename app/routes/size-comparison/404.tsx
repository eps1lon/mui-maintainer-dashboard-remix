import type { LoaderFunction, MetaFunction } from "@remix-run/node";
import { Link } from "remix";

export let loader: LoaderFunction = (args) => {
  console.log(args);
};

export let meta: MetaFunction = () => {
  return { title: "Ain't nothing here" };
};

// FIXME: not working
export default function SizeComparsionNotFound() {
  const prNumber = -1; // FIXME
  return (
    <p>
      Could not load comparison for{" "}
      <a href={`https://github.com/mui-org/material-ui/pull/${prNumber}`}>
        #{prNumber}
      </a>
      . This can happen if the build in the Azure Pipeline didn't finish yet.{" "}
      <Link to="">Reload this page</Link> once the Azure build has finished.
    </p>
  );
}
