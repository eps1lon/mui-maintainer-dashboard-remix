import { unstable_createRoot } from "react-dom";
import { RemixBrowser as Remix } from "@remix-run/react";

unstable_createRoot(document, { hydrate: true }).render(<Remix />);
