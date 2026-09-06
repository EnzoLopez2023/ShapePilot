// GENERATED FILE -- do not edit by hand.
//
// Run `npm run filaments:generate` after changing scripts/filament-source.json;
// `npm run check:filaments` proves the two are in step.
//
// The filament catalogue: which products exist, not which ones anybody owns.
// Ownership is per-account and lives in the filament_inventory table; this is
// the vocabulary that table's keys are drawn from, which is why it is committed
// code rather than data. A colour is identified by its full path --
// `<brand>/<material>/<type>/<colour-slug>-<code>` -- so that adding a brand is
// a catalogue change and never a migration.
//
// Source: 3dfilamentprofiles.com, captured by hand. That site is a Next.js RSC
// app with no public API and it rate-limits, so there is no fetching script to
// run: browse the `/filaments/<brand>/<material>/<type>` page (it paginates at
// 50), read the Colour and RGB columns, and add the rows to
// scripts/filament-source.json.
//
// The code is part of the key because Bambu reissues a colour under a new code
// when it revises a SKU, and both stay listed -- PLA Basic "Blue" is 10600
// (discontinued) and 10601. Codes are NOT unique across lines: ABS "Grey" and
// PLA Basic "Gray" are both 10103. The path is what disambiguates them.

/** How a spool is sold. Bambu's refills are the same filament with no reel. */
export type FilamentVariant = 'spool' | 'refill'

/** One product line: a brand's material in one finish. */
export interface FilamentLine {
  /** Slug, as it appears in the source site's URL. */
  readonly brand: string
  readonly brandLabel: string
  readonly material: string
  readonly type: string
  /** What the maker calls it, e.g. 'PLA Basic'. */
  readonly label: string
  /** Every way this line can be bought; one checkbox per entry. */
  readonly variants: readonly FilamentVariant[]
}

export interface FilamentColor {
  /** `<brand>/<material>/<type>/<colour-slug>-<code>`. The stored key. */
  readonly key: string
  /** `<brand>/<material>/<type>`, matching a FilamentLine. */
  readonly line: string
  readonly name: string
  /** The maker's own code. Display only -- most brands publish none. */
  readonly code?: string
  /** One entry, or two for a dual-colour filament. Uppercase `#RRGGBB`. */
  readonly hexes: readonly string[]
  /** Still listed, no longer made. Kept: a spool you own outlives its SKU. */
  readonly discontinued?: true
}

export const FILAMENT_LINES: readonly FilamentLine[] = Object.freeze([
  { brand: 'bambu-lab', brandLabel: 'Bambu Lab', material: 'pla', type: 'basic', label: 'PLA Basic', variants: ['spool', 'refill'] },
  { brand: 'bambu-lab', brandLabel: 'Bambu Lab', material: 'pla', type: 'matte', label: 'PLA Matte', variants: ['spool', 'refill'] },
  { brand: 'bambu-lab', brandLabel: 'Bambu Lab', material: 'petg', type: 'basic', label: 'PETG Basic', variants: ['spool'] },
  { brand: 'bambu-lab', brandLabel: 'Bambu Lab', material: 'pla', type: 'wood', label: 'PLA Wood', variants: ['spool'] },
  { brand: 'bambu-lab', brandLabel: 'Bambu Lab', material: 'abs', type: 'basic', label: 'ABS', variants: ['spool'] },
])

/** Catalogue order is display order: lines as listed, colours alphabetical. */
export const FILAMENT_CATALOG: readonly FilamentColor[] = Object.freeze([
  // PLA Basic -- 32 colours
  { key: 'bambu-lab/pla/basic/bambu-green-10501', line: 'bambu-lab/pla/basic', name: 'Bambu Green', code: '10501', hexes: ['#00AE42'] },
  { key: 'bambu-lab/pla/basic/beige-10201', line: 'bambu-lab/pla/basic', name: 'Beige', code: '10201', hexes: ['#F7E6DE'] },
  { key: 'bambu-lab/pla/basic/black-10101', line: 'bambu-lab/pla/basic', name: 'Black', code: '10101', hexes: ['#000000'] },
  { key: 'bambu-lab/pla/basic/blue-10600', line: 'bambu-lab/pla/basic', name: 'Blue', code: '10600', hexes: ['#0A2989'], discontinued: true },
  { key: 'bambu-lab/pla/basic/blue-10601', line: 'bambu-lab/pla/basic', name: 'Blue', code: '10601', hexes: ['#0A2989'] },
  { key: 'bambu-lab/pla/basic/blue-gray-10602', line: 'bambu-lab/pla/basic', name: 'Blue Gray', code: '10602', hexes: ['#5B6579'] },
  { key: 'bambu-lab/pla/basic/bright-green-10503', line: 'bambu-lab/pla/basic', name: 'Bright Green', code: '10503', hexes: ['#BECF00'] },
  { key: 'bambu-lab/pla/basic/bronze-10801', line: 'bambu-lab/pla/basic', name: 'Bronze', code: '10801', hexes: ['#847D48'] },
  { key: 'bambu-lab/pla/basic/brown-10800', line: 'bambu-lab/pla/basic', name: 'Brown', code: '10800', hexes: ['#9D432C'] },
  { key: 'bambu-lab/pla/basic/cobalt-blue-10604', line: 'bambu-lab/pla/basic', name: 'Cobalt Blue', code: '10604', hexes: ['#0056B8'] },
  { key: 'bambu-lab/pla/basic/cocoa-brown-10802', line: 'bambu-lab/pla/basic', name: 'Cocoa Brown', code: '10802', hexes: ['#6F5034'] },
  { key: 'bambu-lab/pla/basic/cyan-10603', line: 'bambu-lab/pla/basic', name: 'Cyan', code: '10603', hexes: ['#0086D6'] },
  { key: 'bambu-lab/pla/basic/dark-gray-10105', line: 'bambu-lab/pla/basic', name: 'Dark Gray', code: '10105', hexes: ['#545454'] },
  { key: 'bambu-lab/pla/basic/gold-10401', line: 'bambu-lab/pla/basic', name: 'Gold', code: '10401', hexes: ['#E4BD68'] },
  { key: 'bambu-lab/pla/basic/gray-10103', line: 'bambu-lab/pla/basic', name: 'Gray', code: '10103', hexes: ['#8E9089'] },
  { key: 'bambu-lab/pla/basic/green-10500', line: 'bambu-lab/pla/basic', name: 'Green', code: '10500', hexes: ['#002914'], discontinued: true },
  { key: 'bambu-lab/pla/basic/hot-pink-10204', line: 'bambu-lab/pla/basic', name: 'Hot Pink', code: '10204', hexes: ['#F5547C'] },
  { key: 'bambu-lab/pla/basic/indigo-purple-10701', line: 'bambu-lab/pla/basic', name: 'Indigo Purple', code: '10701', hexes: ['#482960'] },
  { key: 'bambu-lab/pla/basic/jade-white-10100', line: 'bambu-lab/pla/basic', name: 'Jade White', code: '10100', hexes: ['#FFFFFF'] },
  { key: 'bambu-lab/pla/basic/light-gray-10104', line: 'bambu-lab/pla/basic', name: 'Light Gray', code: '10104', hexes: ['#D1D3D5'] },
  { key: 'bambu-lab/pla/basic/magenta-10202', line: 'bambu-lab/pla/basic', name: 'Magenta', code: '10202', hexes: ['#EC008C'] },
  { key: 'bambu-lab/pla/basic/maroon-red-10205', line: 'bambu-lab/pla/basic', name: 'Maroon Red', code: '10205', hexes: ['#9D2235'] },
  { key: 'bambu-lab/pla/basic/mistletoe-green-10502', line: 'bambu-lab/pla/basic', name: 'Mistletoe Green', code: '10502', hexes: ['#3F8E43'] },
  { key: 'bambu-lab/pla/basic/orange-10300', line: 'bambu-lab/pla/basic', name: 'Orange', code: '10300', hexes: ['#FF6A13'] },
  { key: 'bambu-lab/pla/basic/pink-10203', line: 'bambu-lab/pla/basic', name: 'Pink', code: '10203', hexes: ['#F55A74'] },
  { key: 'bambu-lab/pla/basic/pumpkin-orange-10301', line: 'bambu-lab/pla/basic', name: 'Pumpkin Orange', code: '10301', hexes: ['#FF9016'] },
  { key: 'bambu-lab/pla/basic/purple-10700', line: 'bambu-lab/pla/basic', name: 'Purple', code: '10700', hexes: ['#5E43B7'] },
  { key: 'bambu-lab/pla/basic/red-10200', line: 'bambu-lab/pla/basic', name: 'Red', code: '10200', hexes: ['#C12E1F'] },
  { key: 'bambu-lab/pla/basic/silver-10102', line: 'bambu-lab/pla/basic', name: 'Silver', code: '10102', hexes: ['#A6A9AA'] },
  { key: 'bambu-lab/pla/basic/sunflower-yellow-10402', line: 'bambu-lab/pla/basic', name: 'Sunflower Yellow', code: '10402', hexes: ['#FEC600'] },
  { key: 'bambu-lab/pla/basic/turquoise-10605', line: 'bambu-lab/pla/basic', name: 'Turquoise', code: '10605', hexes: ['#00B1B7'] },
  { key: 'bambu-lab/pla/basic/yellow-10400', line: 'bambu-lab/pla/basic', name: 'Yellow', code: '10400', hexes: ['#F4EE2A'] },
  // PLA Matte -- 25 colours
  { key: 'bambu-lab/pla/matte/apple-green-11502', line: 'bambu-lab/pla/matte', name: 'Apple Green', code: '11502', hexes: ['#C2E189'] },
  { key: 'bambu-lab/pla/matte/ash-gray-11102', line: 'bambu-lab/pla/matte', name: 'Ash Gray', code: '11102', hexes: ['#9B9EA0'] },
  { key: 'bambu-lab/pla/matte/bone-white-11103', line: 'bambu-lab/pla/matte', name: 'Bone White', code: '11103', hexes: ['#CBC6B8'] },
  { key: 'bambu-lab/pla/matte/caramel-11803', line: 'bambu-lab/pla/matte', name: 'Caramel', code: '11803', hexes: ['#AE835B'] },
  { key: 'bambu-lab/pla/matte/charcoal-11101', line: 'bambu-lab/pla/matte', name: 'Charcoal', code: '11101', hexes: ['#000000'] },
  { key: 'bambu-lab/pla/matte/dark-blue-11602', line: 'bambu-lab/pla/matte', name: 'Dark Blue', code: '11602', hexes: ['#042F56'] },
  { key: 'bambu-lab/pla/matte/dark-brown-11801', line: 'bambu-lab/pla/matte', name: 'Dark Brown', code: '11801', hexes: ['#7D6556'] },
  { key: 'bambu-lab/pla/matte/dark-chocolate-11802', line: 'bambu-lab/pla/matte', name: 'Dark Chocolate', code: '11802', hexes: ['#4D3324'] },
  { key: 'bambu-lab/pla/matte/dark-green-11501', line: 'bambu-lab/pla/matte', name: 'Dark Green', code: '11501', hexes: ['#68724D'] },
  { key: 'bambu-lab/pla/matte/dark-red-11202', line: 'bambu-lab/pla/matte', name: 'Dark Red', code: '11202', hexes: ['#BB3D43'] },
  { key: 'bambu-lab/pla/matte/desert-tan-11401', line: 'bambu-lab/pla/matte', name: 'Desert Tan', code: '11401', hexes: ['#E8DBB7'] },
  { key: 'bambu-lab/pla/matte/grass-green-11500', line: 'bambu-lab/pla/matte', name: 'Grass Green', code: '11500', hexes: ['#61C680'] },
  { key: 'bambu-lab/pla/matte/ice-blue-11601', line: 'bambu-lab/pla/matte', name: 'Ice Blue', code: '11601', hexes: ['#A3D8E1'] },
  { key: 'bambu-lab/pla/matte/ivory-white-11100', line: 'bambu-lab/pla/matte', name: 'Ivory White', code: '11100', hexes: ['#FFFFFF'] },
  { key: 'bambu-lab/pla/matte/latte-brown-11800', line: 'bambu-lab/pla/matte', name: 'Latte Brown', code: '11800', hexes: ['#D3B7A7'] },
  { key: 'bambu-lab/pla/matte/lemon-yellow-11400', line: 'bambu-lab/pla/matte', name: 'Lemon Yellow', code: '11400', hexes: ['#F7D959'] },
  { key: 'bambu-lab/pla/matte/lilac-purple-11700', line: 'bambu-lab/pla/matte', name: 'Lilac Purple', code: '11700', hexes: ['#AE96D4'] },
  { key: 'bambu-lab/pla/matte/mandarin-orange-11300', line: 'bambu-lab/pla/matte', name: 'Mandarin Orange', code: '11300', hexes: ['#F99963'] },
  { key: 'bambu-lab/pla/matte/marine-blue-11600', line: 'bambu-lab/pla/matte', name: 'Marine Blue', code: '11600', hexes: ['#0078BF'] },
  { key: 'bambu-lab/pla/matte/nardo-gray-11104', line: 'bambu-lab/pla/matte', name: 'Nardo Gray', code: '11104', hexes: ['#757575'] },
  { key: 'bambu-lab/pla/matte/plum-11204', line: 'bambu-lab/pla/matte', name: 'Plum', code: '11204', hexes: ['#950051'] },
  { key: 'bambu-lab/pla/matte/sakura-pink-11201', line: 'bambu-lab/pla/matte', name: 'Sakura Pink', code: '11201', hexes: ['#E8AFCF'] },
  { key: 'bambu-lab/pla/matte/scarlet-red-11200', line: 'bambu-lab/pla/matte', name: 'Scarlet Red', code: '11200', hexes: ['#DE4343'] },
  { key: 'bambu-lab/pla/matte/sky-blue-11603', line: 'bambu-lab/pla/matte', name: 'Sky Blue', code: '11603', hexes: ['#56B7E6'] },
  { key: 'bambu-lab/pla/matte/terracotta-11203', line: 'bambu-lab/pla/matte', name: 'Terracotta', code: '11203', hexes: ['#B15533'] },
  // PETG Basic -- 28 colours
  { key: 'bambu-lab/petg/basic/black-30101', line: 'bambu-lab/petg/basic', name: 'Black', code: '30101', hexes: ['#000000'], discontinued: true },
  { key: 'bambu-lab/petg/basic/black-30105', line: 'bambu-lab/petg/basic', name: 'Black', code: '30105', hexes: ['#000000'] },
  { key: 'bambu-lab/petg/basic/blue-30600', line: 'bambu-lab/petg/basic', name: 'Blue', code: '30600', hexes: ['#001489'], discontinued: true },
  { key: 'bambu-lab/petg/basic/blue-gray-30601', line: 'bambu-lab/petg/basic', name: 'Blue Gray', code: '30601', hexes: ['#2E4F66'], discontinued: true },
  { key: 'bambu-lab/petg/basic/dark-beige-30403', line: 'bambu-lab/petg/basic', name: 'Dark Beige', code: '30403', hexes: ['#DBC8B6'] },
  { key: 'bambu-lab/petg/basic/dark-brown-30800', line: 'bambu-lab/petg/basic', name: 'Dark Brown', code: '30800', hexes: ['#4F2C1D'] },
  { key: 'bambu-lab/petg/basic/gold-30401', line: 'bambu-lab/petg/basic', name: 'Gold', code: '30401', hexes: ['#F6D86A'], discontinued: true },
  { key: 'bambu-lab/petg/basic/gray-30102', line: 'bambu-lab/petg/basic', name: 'Gray', code: '30102', hexes: ['#ADB1B2'], discontinued: true },
  { key: 'bambu-lab/petg/basic/gray-30107', line: 'bambu-lab/petg/basic', name: 'Gray', code: '30107', hexes: ['#7F7E83'] },
  { key: 'bambu-lab/petg/basic/green-30500', line: 'bambu-lab/petg/basic', name: 'Green', code: '30500', hexes: ['#009639'], discontinued: true },
  { key: 'bambu-lab/petg/basic/green-30502', line: 'bambu-lab/petg/basic', name: 'Green', code: '30502', hexes: ['#009639'] },
  { key: 'bambu-lab/petg/basic/lake-blue-30602', line: 'bambu-lab/petg/basic', name: 'Lake Blue', code: '30602', hexes: ['#0069B1'], discontinued: true },
  { key: 'bambu-lab/petg/basic/lime-green-30501', line: 'bambu-lab/petg/basic', name: 'Lime Green', code: '30501', hexes: ['#7CD82B'], discontinued: true },
  { key: 'bambu-lab/petg/basic/misty-blue-30108', line: 'bambu-lab/petg/basic', name: 'Misty Blue', code: '30108', hexes: ['#688197'] },
  { key: 'bambu-lab/petg/basic/nature-30104', line: 'bambu-lab/petg/basic', name: 'Nature', code: '30104', hexes: ['#D7D7D7'], discontinued: true },
  { key: 'bambu-lab/petg/basic/navy-blue-30604', line: 'bambu-lab/petg/basic', name: 'Navy Blue', code: '30604', hexes: ['#0086D6'] },
  { key: 'bambu-lab/petg/basic/orange-30300', line: 'bambu-lab/petg/basic', name: 'Orange', code: '30300', hexes: ['#FF671F'], discontinued: true },
  { key: 'bambu-lab/petg/basic/orange-30301', line: 'bambu-lab/petg/basic', name: 'Orange', code: '30301', hexes: ['#FF671F'] },
  { key: 'bambu-lab/petg/basic/pine-green-30503', line: 'bambu-lab/petg/basic', name: 'Pine Green', code: '30503', hexes: ['#034638'] },
  { key: 'bambu-lab/petg/basic/purple-30700', line: 'bambu-lab/petg/basic', name: 'Purple', code: '30700', hexes: ['#9E007E'], discontinued: true },
  { key: 'bambu-lab/petg/basic/red-30200', line: 'bambu-lab/petg/basic', name: 'Red', code: '30200', hexes: ['#D6001C'], discontinued: true },
  { key: 'bambu-lab/petg/basic/red-30201', line: 'bambu-lab/petg/basic', name: 'Red', code: '30201', hexes: ['#D6001C'] },
  { key: 'bambu-lab/petg/basic/reflex-blue-30603', line: 'bambu-lab/petg/basic', name: 'Reflex Blue', code: '30603', hexes: ['#001489'] },
  { key: 'bambu-lab/petg/basic/translucent-30103', line: 'bambu-lab/petg/basic', name: 'Translucent', code: '30103', hexes: ['#FFFFFF'], discontinued: true },
  { key: 'bambu-lab/petg/basic/white-30100', line: 'bambu-lab/petg/basic', name: 'White', code: '30100', hexes: ['#EDF0F2'], discontinued: true },
  { key: 'bambu-lab/petg/basic/white-30106', line: 'bambu-lab/petg/basic', name: 'White', code: '30106', hexes: ['#FFFFFF'] },
  { key: 'bambu-lab/petg/basic/yellow-30400', line: 'bambu-lab/petg/basic', name: 'Yellow', code: '30400', hexes: ['#FCE300'], discontinued: true },
  { key: 'bambu-lab/petg/basic/yellow-30402', line: 'bambu-lab/petg/basic', name: 'Yellow', code: '30402', hexes: ['#FCE300'] },
  // PLA Wood -- 6 colours
  { key: 'bambu-lab/pla/wood/black-walnut-13107', line: 'bambu-lab/pla/wood', name: 'Black Walnut', code: '13107', hexes: ['#4F3F24'] },
  { key: 'bambu-lab/pla/wood/classic-birch-13505', line: 'bambu-lab/pla/wood', name: 'Classic Birch', code: '13505', hexes: ['#918669'] },
  { key: 'bambu-lab/pla/wood/clay-brown-13801', line: 'bambu-lab/pla/wood', name: 'Clay Brown', code: '13801', hexes: ['#995F11'] },
  { key: 'bambu-lab/pla/wood/ochre-yellow-13403', line: 'bambu-lab/pla/wood', name: 'Ochre Yellow', code: '13403', hexes: ['#C98935'] },
  { key: 'bambu-lab/pla/wood/rosewood-13204', line: 'bambu-lab/pla/wood', name: 'Rosewood', code: '13204', hexes: ['#4C241C'] },
  { key: 'bambu-lab/pla/wood/white-oak-13106', line: 'bambu-lab/pla/wood', name: 'White Oak', code: '13106', hexes: ['#D6CCA3'] },
  // ABS -- 17 colours
  { key: 'bambu-lab/abs/basic/azure-40601', line: 'bambu-lab/abs/basic', name: 'Azure', code: '40601', hexes: ['#489FDF'] },
  { key: 'bambu-lab/abs/basic/bambu-green-40500', line: 'bambu-lab/abs/basic', name: 'Bambu Green', code: '40500', hexes: ['#00AE42'] },
  { key: 'bambu-lab/abs/basic/beige-40401', line: 'bambu-lab/abs/basic', name: 'Beige', code: '40401', hexes: ['#DFD1A7'], discontinued: true },
  { key: 'bambu-lab/abs/basic/black-40101', line: 'bambu-lab/abs/basic', name: 'Black', code: '40101', hexes: ['#000000'] },
  { key: 'bambu-lab/abs/basic/blue-40600', line: 'bambu-lab/abs/basic', name: 'Blue', code: '40600', hexes: ['#0A2CA5'] },
  { key: 'bambu-lab/abs/basic/grey-10103', line: 'bambu-lab/abs/basic', name: 'Grey', code: '10103', hexes: ['#8E9089'], discontinued: true },
  { key: 'bambu-lab/abs/basic/lavender-40701', line: 'bambu-lab/abs/basic', name: 'Lavender', code: '40701', hexes: ['#7248BD'], discontinued: true },
  { key: 'bambu-lab/abs/basic/mint-40501', line: 'bambu-lab/abs/basic', name: 'Mint', code: '40501', hexes: ['#ADF4DC'], discontinued: true },
  { key: 'bambu-lab/abs/basic/navy-blue-40602', line: 'bambu-lab/abs/basic', name: 'Navy Blue', code: '40602', hexes: ['#0C2340'] },
  { key: 'bambu-lab/abs/basic/olive-40502', line: 'bambu-lab/abs/basic', name: 'Olive', code: '40502', hexes: ['#789D4A'] },
  { key: 'bambu-lab/abs/basic/orange-40300', line: 'bambu-lab/abs/basic', name: 'Orange', code: '40300', hexes: ['#FF6A13'] },
  { key: 'bambu-lab/abs/basic/purple-40700', line: 'bambu-lab/abs/basic', name: 'Purple', code: '40700', hexes: ['#AF1685'], discontinued: true },
  { key: 'bambu-lab/abs/basic/red-40200', line: 'bambu-lab/abs/basic', name: 'Red', code: '40200', hexes: ['#D32941'] },
  { key: 'bambu-lab/abs/basic/silver-40102', line: 'bambu-lab/abs/basic', name: 'Silver', code: '40102', hexes: ['#87909A'] },
  { key: 'bambu-lab/abs/basic/tangerine-yellow-40402', line: 'bambu-lab/abs/basic', name: 'Tangerine Yellow', code: '40402', hexes: ['#FFC72C'] },
  { key: 'bambu-lab/abs/basic/white-40100', line: 'bambu-lab/abs/basic', name: 'White', code: '40100', hexes: ['#FFFFFF'] },
  { key: 'bambu-lab/abs/basic/yellow-40400', line: 'bambu-lab/abs/basic', name: 'Yellow', code: '40400', hexes: ['#FFFF20'], discontinued: true },
])

const BY_KEY = new Map(FILAMENT_CATALOG.map((color) => [color.key, color]))
const BY_LINE = new Map(FILAMENT_LINES.map((line) => [
  `${line.brand}/${line.material}/${line.type}`, line,
]))

export const filamentByKey = (key: string): FilamentColor | undefined => BY_KEY.get(key)

export const filamentLineById = (id: string): FilamentLine | undefined => BY_LINE.get(id)

export const filamentsOfLine = (id: string): FilamentColor[] =>
  FILAMENT_CATALOG.filter((color) => color.line === id)

/**
 * Whether this filament can be bought in this form. The server rejects a tick
 * that fails this, so a refill of a line Bambu only sells on a reel can never
 * be stored.
 */
export const isFilamentVariantFor = (key: string, variant: string): boolean => {
  const color = BY_KEY.get(key)
  if (!color) return false
  const line = BY_LINE.get(color.line)
  return line ? (line.variants as readonly string[]).includes(variant) : false
}

/** Every (key, variant) pair the catalogue allows. The upper bound on a tick set. */
export const FILAMENT_PAIR_COUNT = FILAMENT_CATALOG.reduce(
  (total, color) => total + (BY_LINE.get(color.line)?.variants.length ?? 0), 0)
