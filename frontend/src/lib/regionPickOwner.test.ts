import { describe, expect, it } from "vitest";

import { armRegionPick, regionPickOwner, regionPickTaken, releaseRegionPick } from "./regionPickOwner";

describe("regionPickOwner (one drag, one panel)", () => {
  it("tags the arm and clears it on release by its owner only", () => {
    armRegionPick("curvefit");
    expect(regionPickOwner()).toBe("curvefit");
    releaseRegionPick("baseline");
    expect(regionPickOwner()).toBe("curvefit");
    releaseRegionPick("curvefit");
    expect(regionPickOwner()).toBeNull();
  });

  it("marks a taken pick, so a second listener in the same commit leaves it", () => {
    const pick = { x: [1, 2] };
    armRegionPick("curvefit");
    expect(regionPickTaken(pick)).toBe(false);
    releaseRegionPick("curvefit", pick);
    expect(regionPickOwner()).toBeNull(); // released...
    expect(regionPickTaken(pick)).toBe(true); // ...but Baseline still sees it as taken
    expect(regionPickTaken({ x: [1, 2] })).toBe(false); // a new drag is a new object
  });
});
