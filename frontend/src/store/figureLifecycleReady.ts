// Importing this module for its effect holds the importing chunk back until
// the figure lifecycle bodies (store/figureLifecycleRun.ts) are in (bundle
// diet slice 36). Only the chunks that read one of those actions' results on
// the first call import it: the Publication Preview opener (lib/exportFigureView.ts),
// the Graph Builder, the figure builder and the Figure Page hooks. A top-level
// `await` is only allowed in a module no eager module reaches
// (architecture.test.ts), and this one is imported by lazy chunks alone.
import { warmFigureLifecycle } from "./figureLifecycleLazy";

await warmFigureLifecycle();
