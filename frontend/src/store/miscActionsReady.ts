// Importing this module for its effect holds the importing chunk back until
// the bodies in store/miscActionsRun.ts are in (bundle diet slice 37). Only
// the chunks that read one of those actions' results on the first call import
// it: the Separate and Combine dialogs, the Import-as-sheets command, Quick
// Plot With, the recipe library and the Quick Figure builder. A top-level
// `await` is only allowed in a module no eager module reaches
// (architecture.test.ts), and this one is imported by lazy chunks alone.
import { warmMiscActions } from "./miscActionsLazy";

await warmMiscActions();
