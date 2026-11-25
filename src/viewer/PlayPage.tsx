// The prototype by itself, at full size: the page to put in front of someone
// when you want to watch them use the flow.

import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { tokens } from "../design-system/tokens";
import { findFrame, pageBehind } from "../shared/machine";
import type { FlowPayload } from "../shared/types";
import { useFlow } from "./FlowPage";
import { Device, StateLayout, type RenderContext } from "./kit/render";
import { links } from "./router";
import { usePrototype } from "./usePrototype";

export function PlayPage({ id, at }: { id: string; at?: string }): ReactElement {
  const { payload, error } = useFlow(id);
  if (error && !payload) {
    return (
      <div className="page">
        <main className="notice">
          <p>{error}</p>
          <a href={links.list}>See all flows</a>
        </main>
      </div>
    );
  }
  if (!payload) return <div className="page loading-page">Opening the prototype</div>;
  return <Player key={payload.id} payload={payload} at={at} />;
}

function Player({ payload, at }: { payload: FlowPayload; at?: string }): ReactElement {
  const flow = payload.spec;
  const proto = usePrototype(flow, at);
  const device = flow.device ?? "desktop";
  const size = tokens.device[device];
  const found = findFrame(flow, proto.current);

  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = (): void => {
      setScale(Math.min(1.25, (el.clientWidth - 32) / size.width, (el.clientHeight - 32) / size.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [size.width, size.height]);

  const { fire, change } = proto;
  const context = useMemo<RenderContext>(
    () => ({ data: proto.data, interactive: true, fire, change, pointing: false, point: () => undefined, seed: proto.current }),
    [proto.data, proto.current, fire, change],
  );

  return (
    <div className="page play">
      <header className="flowbar">
        <span className="flow-name">{flow.name}</span>
        <span className="sketch-tag">A sketch, not the finished design</span>
        <span className="grow" />
        <button type="button" className="bar-button" onClick={proto.restart}>
          Start over
        </button>
        <a className="bar-link" href={links.flow(payload.id, proto.current)}>
          Open the board
        </a>
      </header>
      <div className="play-stage" ref={stage}>
        <div className="play-fit" style={{ width: size.width * scale, height: size.height * scale }}>
          <div className="proto-scale" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
            {found && (
              <Device key={proto.current} device={device} seed={proto.current}>
                <StateLayout layout={found.state.layout} behind={pageBehind(flow, found.state)} context={context} />
              </Device>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
