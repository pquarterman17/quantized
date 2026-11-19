// "◇ Overlay these N" — plots grouped batch outputs together (one undo step,
// via plotSelectedTogether). Renders nothing below two outputs.

import { Button } from "../primitives";
import { plotSelectedTogether } from "../../lib/plotSelectedTogether";

export default function OverlayOutputsButton({ ids }: { ids: readonly string[] }) {
  if (ids.length < 2) return null;
  return (
    <Button size="sm" onClick={() => void plotSelectedTogether(ids)} style={{ marginTop: 8, width: "100%" }}>
      {`◇ Overlay these ${ids.length}`}
    </Button>
  );
}
