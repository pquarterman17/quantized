// Calculators ▸ Thin Film tab — deposition / sputter rate, diffusion length,
// implant dose + peak concentration, Kiessig thickness, multilayer thermal
// conductivity, projected range, Stoney stress, thermal-mismatch strain
// (calc.thin_film, ports DiraCulator buildThinFilmTab + +calc/+thinFilm/*).
// Decomposed via the workshop pattern (MAIN_PLAN #1): each card is a
// self-contained sub-component (own local state) in thinfilm/, composed here
// in the ORIGINAL card order — tests click the Nth "Calculate" button, so
// this order is part of the contract.

import {
  DepositionRateCard,
  DiffusionLengthCard,
  ImplantDoseCard,
  PeakConcentrationCard,
  SputterRateCard,
} from "./thinfilm/GrowthCards";
import {
  KiessigCard,
  MultilayerThermalCard,
  ProjectedRangeCard,
  StoneyStressCard,
  ThermalMismatchCard,
} from "./thinfilm/FilmCards";

export default function ThinFilmTab() {
  return (
    <div style={{ marginTop: 12 }}>
      <DepositionRateCard />
      <SputterRateCard />
      <DiffusionLengthCard />
      <ImplantDoseCard />
      <PeakConcentrationCard />
      <KiessigCard />
      <MultilayerThermalCard />
      <ProjectedRangeCard />
      <StoneyStressCard />
      <ThermalMismatchCard />
    </div>
  );
}
