/**
 * The fifteen slots, in switch order: the three originals, then three more
 * hybrids, then three more in 3D.
 *
 * This is the ONLY file that knows about more than one demo, and the only
 * coupling between them. A demo author edits their own file and nothing else;
 * a demo carries its own name, dimension and claim.
 */

import type { DemoModule } from './contract';
import { laidOutByLink } from './LaidOutByLink';
import { laidOutByMeaning } from './LaidOutByMeaning';
import { overviewAndDetail } from './OverviewAndDetail';
import { timeAndNeighbourhood } from './TimeAndNeighbourhood';
import { textFirst } from './TextFirst';
import { contradictionLedger } from './ContradictionLedger';
import { strata } from './Strata';
import { axesAndChords } from './AxesAndChords';
import { linkTerrain } from './LinkTerrain';
import { memoryRiver } from './MemoryRiver';
import { memoryGalaxy } from './MemoryGalaxy';
import { memoryMatrix } from './MemoryMatrix';
import { orbitalCore } from './OrbitalCore';
import { memoryTree } from './MemoryTree';
import { memoryConstellations } from './MemoryConstellations';

export const DEMOS: readonly DemoModule[] = [
  laidOutByLink,
  laidOutByMeaning,
  overviewAndDetail,
  timeAndNeighbourhood,
  textFirst,
  contradictionLedger,
  strata,
  axesAndChords,
  linkTerrain,
  memoryRiver,
  memoryGalaxy,
  memoryMatrix,
  orbitalCore,
  memoryTree,
  memoryConstellations,
];
