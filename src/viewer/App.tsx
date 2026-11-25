import type { ReactElement } from "react";

import { BriefPage } from "./BriefPage";
import { FlowList } from "./FlowList";
import { FlowPage } from "./FlowPage";
import { useOnline, usePresence } from "./live";
import { PlayPage } from "./PlayPage";
import { useRoute, type Route } from "./router";
import { StyleGuide } from "./StyleGuide";

function Page({ route }: { route: Route }): ReactElement {
  switch (route.page) {
    case "flow":
      return <FlowPage key={route.id} id={route.id} at={route.at} />;
    case "play":
      return <PlayPage key={route.id} id={route.id} at={route.at} />;
    case "brief":
      return <BriefPage key={route.id} id={route.id} />;
    case "system":
      return <StyleGuide />;
    case "list":
      return <FlowList />;
  }
}

export function App(): ReactElement {
  const route = useRoute();
  const online = useOnline();
  const { role } = usePresence();
  return (
    <div className="app">
      {!online && (
        <p className="banner offline" role="alert">
          {role === "guest"
            ? "You are disconnected. Sharing may have been turned off: ask for a new link. What you see may be out of date."
            : "You are disconnected. quickmock will reconnect by itself; until then, what you see may be out of date."}
        </p>
      )}
      <Page route={route} />
    </div>
  );
}
