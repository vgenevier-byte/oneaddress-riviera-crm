/** Disposable provider text only, to exercise real anti-repetition with scenery. */
import { readFileSync, writeFileSync } from 'node:fs';
const counterFile='/private/tmp/oar-publisher-car-selection-bench-20261021/scenery-counter.txt';
const scenes=[
  ['A quiet coastal turnout overlooks pale turquoise water and distant limestone cliffs.','The horizon is wide above coarse grey tarmac and a soft band of sea haze.'],
  ['A mineral courtyard opens between tall pines and a shaded stone wall.','The foreground holds small gravel textures while irregular foliage shadows cross cream paving.'],
  ['A peaceful hillside lane curves beside olive terraces under gentle amber light.','Warm terracotta earth and silvery leaves frame a long diagonal towards layered hills.'],
  ['A plain esplanade faces a calm open bay beneath thin rose clouds.','The composition places a broad peach sky above horizontal harbour reflections.'],
  ['A discreet cypress-lined entrance meets an ochre facade with a shadowed arched passage.','Natural side light traces rough plaster and slender dark trunks in a balanced symmetrical frame.'],
  ['A broad sandy overlook borders low dune grasses and wind-shaped scrub.','Low afternoon light reveals soft beige grains against a deep azure sea and sparse silver foliage.'],
  ['A sheltered garden patio rests beside a terraced orchard and dry rosemary hedges.','The close paving edge leads diagonally past sage leaves towards a distant shaded pergola.'],
  ['An open stone forecourt meets a long flight of shallow steps beside a weathered balustrade.','Quiet tonal layers of ivory masonry recede towards an empty elevated terrace.'],
  ['A narrow village square is framed by pale stucco arcades and a tiled fountain.','The still basin catches muted coral tones between soft shadows and worn circular cobbles.'],
  ['A leafy arrival path crosses a discreet private garden beside a shallow rill.','Morning mist hangs beyond clipped shrubs and damp slate edging in cool green tones.'],
  ['A secluded gravel clearing meets old fig trees above a small sheltered inlet.','The low composition layers broad leaves and dappled pebbles against softly glowing water.'],
  ['A peaceful bluff offers an uninterrupted view across a calm offshore anchorage.','Blue distance is balanced by chalky dry earth and sparse tufts of wild thyme.'],
  ['A terracotta courtyard borders a small citrus grove beneath a woven reed canopy.','The diagonal shadows cut across warm tiles and baskets of fallen fragrant leaves.'],
  ['A plain hilltop landing overlooks distant ridgelines under a muted lavender sky.','Evening light washes textured plaster while dark conifers punctuate the empty background.'],
  ['A quiet paved approach curves past a sculpted stone bank and climbing jasmine.','The layered entrance planting leads softly from smooth cream flagstones towards blurred arches.'],
  ['A limestone terrace sits above a rocky cove edged with low native succulents.','Soft wave highlights meet pale pebbles and narrow angular shadows along the retaining edge.'],
  ['A secluded courtyard lies between warm brick colonnades and a square reflecting pool.','The symmetrical paving rhythm opens onto rippled copper reflections and a deep shaded recess.'],
  ['A sheltered crest clearing is framed by lentisk shrubs and distant blue headlands.','Natural haze softens the open skyline above mottled warm soil and delicate grassy textures.'],
  ['A small garden forecourt opens beside rough stone planters and a climbing bougainvillea.','Golden sidelight illuminates irregular magenta petals against an uncluttered chalk facade.'],
  ['A discreet paved overlook faces a broad estuary beneath high pearl clouds.','The empty composition balances cool silt bands with soft ripples and pale sandstone edges.'],
  ['A quiet orchard entrance is bordered by gnarled almond trunks and aromatic ground cover.','The narrow foreground path draws the eye between muted cream blossoms and silvery distant branches.'],
  ['A peaceful courtyard joins weathered mosaic paving with deep shaded arcades.','The sun traces small geometric fragments across a still empty basin and worn clay surfaces.'],
  ['A low seaside garden terrace rests beside an irregular dune path and bleached driftwood.','Soft overcast light settles into ivory reeds and a narrow stripe of calm distant surf.'],
  ['A plain elevated plaza overlooks undulating vineyard terraces and hazy inland valleys.','The broad diagonal frame pairs pale dry masonry with restrained olive greens and warm late light.'],
];
export function fixtureScenery(){
  let index=0;try{index=Number(readFileSync(counterFile,'utf8'));}catch{/* first local fixture */}
  if(!Number.isSafeInteger(index)||index<0||index>=scenes.length)throw new Error('Dedicated scenery fixtures exhausted; inspect history instead of bypassing duplicate rules');
  writeFileSync(counterFile,String(index+1));
  return {scene_summary:scenes[index][0],visual_signature:scenes[index][1]};
}
