import { unstable_createRoot } from "react-dom";
import { RemixBrowser } from "remix";

unstable_createRoot(document, { hydrate: true }).render(<RemixBrowser />);
