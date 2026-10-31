/*
 * What the sets are made of (#25): models (furniture, props, plants) and surfaces (textures for the
 * sets' own walls, floors and roofs), CC0 from Poly Haven (a lawn from ambientCG); and trees, grown by ez-tree (MIT, its
 * leaves) with Poly Haven's bark. `npm run sets` (scripts/sets.ts)
 * fetches each, fits it to its budget and writes it to public/sets/, with an index of what each
 * came to (triangles, bytes); lib/sets.ts places them. Within budget: a model ≤ 20 k triangles
 * (a small one 5 k, a tree 40 k), a texture ≤ 1K; a set ≤ 250 k triangles and 15 MB in all.
 */

export interface ModelAsset {
  /** Its Poly Haven id. */
  ph: string;
  /** The most triangles it may have (simplified down to it). */
  tris: number;
  /** Its textures' size (px, square at most). */
  tex: 512 | 1024;
}

/** A tree grown from one of ez-tree's presets, to a height (m). */
export interface TreeAsset {
  tree: string;
  height: number;
  tris: number;
  tex: 512 | 1024;
}

/** A surface's textures: Poly Haven's (`ph`) or ambientCG's (`acg`, CC0 too: a lawn Poly Haven has none of). */
export type SurfaceAsset = ({ ph: string } | { acg: string }) & { tex: 512 | 1024 };

/** A model's budget by its kind (most triangles). */
export const MODEL_BUDGET = { small: 5_000, model: 20_000, tree: 40_000 } as const;
/** A set's budget, all in. */
export const SET_BUDGET = { tris: 250_000, bytes: 15 * 1024 * 1024 } as const;

const small = (ph: string): ModelAsset => ({ ph, tris: MODEL_BUDGET.small, tex: 512 });
const model = (ph: string, tris: number = MODEL_BUDGET.model): ModelAsset => ({ ph, tris, tex: 1024 });
const tree = (preset: string, height: number): TreeAsset => ({ tree: preset, height, tris: MODEL_BUDGET.tree, tex: 1024 });

export const MODELS = {
  // Home
  'sofa': model('sofa_03', 8_000),
  'armchair': model('ArmChair_01', 6_000),
  'coffee-table': model('modern_coffee_table_01', 4_500),
  'side-table': small('side_table_01'),
  'tv-unit': model('modern_wooden_cabinet', 13_000),
  'bookshelf': model('wooden_bookshelf_worn', 10_000),
  'potted-plant': model('potted_plant_02', 12_000),
  'tall-plant': model('potted_plant_01', 12_000),
  'small-plant': small('potted_plant_04'),
  'picture': small('hanging_picture_frame_02'),
  'picture-2': small('hanging_picture_frame_01'),
  'wall-clock': small('wall_clock'),
  'ottoman': small('Ottoman_01'),
  // Work
  'office-desk': model('metal_office_desk', 7_000),
  'drawer-cabinet': model('drawer_cabinet', 8_000),
  'steel-shelves': small('steel_frame_shelves_01'),
  'meeting-table': small('dining_table'),
  'dining-chair': small('dining_chair_02'),
  'laptop': small('classic_laptop'),
  'notepads': small('office_notepads'),
  'stationery': small('stationery_supplies'),
  'projector-screen': model('projector_screen', 6_000),
  'chalkboard': small('standing_chalkboard_01'),
  // Café
  'cafe-table': small('round_wooden_table_02'),
  'cafe-chair': small('gallinera_chair'),
  'bar-stool': model('metal_stool_03', 7_000),
  'cash-register': small('CashRegister_01'),
  'display-shelves': small('wooden_display_shelves_01'),
  'pendant-lamp': small('hanging_industrial_lamp'),
  'wine-bottles': small('wine_bottles_01'),
  'tea-set': model('tea_set_01', 6_000),
  'vase': small('ceramic_vase_01'),
  // Street and park
  'street-lamp': model('street_lamp_01', 6_000),
  'park-lamp': small('street_lamp_02'),
  'bench': small('painted_wooden_bench'),
  'trash-can': small('metal_trash_can'),
  'hydrant': small('fire_hydrant'),
  'utility-box': small('utility_box_02'),
  'manhole': small('water_manhole_cover'),
  'covered-car': model('covered_car', 8_000),
  'shutter': small('rollershutter_door'),
  'aircon': small('exterior_aircon_unit'),
  'planter': small('planter_box_02'),
  'rocks': model('rock_moss_set_01', 10_000),
  'fern': small('fern_02'),
  'ash': tree('Ash Medium', 9),
  'oak': tree('Oak Medium', 8),
  'aspen': tree('Aspen Medium', 10),
  'bush': tree('Bush 1', 1.6),
  // China
  'chinese-armchair': small('chinese_armchair'),
  'chinese-tea-table': small('chinese_tea_table'),
  'chinese-stool': small('chinese_stool'),
  'chinese-cabinet': model('chinese_cabinet', 8_000),
  'chinese-console': model('chinese_console_table', 6_000),
  'chinese-screen': small('chinese_screen_panels'),
  'chinese-chandelier': small('chinese_chandelier'),
  'chinese-sofa': small('chinese_sofa'),
  'antique-vase': small('antique_ceramic_vase_01'),
  'brass-vase': small('brass_vase_01'),
  'clay-pot': small('ceramic_pot'),
  'wooden-lantern': small('wooden_lantern_01'),
  'barrel': small('Barrel_01'),
  'crate': small('wooden_crate_01'),
  'bucket': small('wooden_bucket_01'),
  'basket': small('wicker_basket_01'),
  // History
  'marble-bust': small('marble_bust_01'),
  'castle-door': model('large_castle_door', 6_000),
  'gothic-cabinet': model('GothicCabinet_01', 8_000),
  'gothic-commode': small('GothicCommode_01'),
  'throne': model('WoodenChair_01', 8_000),
  'chandelier': model('Chandelier_01', 8_000),
  'candleholders': model('brass_candleholders', 6_000),
  'goblets': small('brass_goblets'),
  'wine-barrel': small('wine_barrel_01'),
  'jug': small('jug_01'),
  'wooden-bowl': small('wooden_bowl_01'),
  'feast-table': small('painted_wooden_table'),
} satisfies Record<string, ModelAsset | TreeAsset>;
export type ModelId = keyof typeof MODELS;

export const SURFACES = {
  // Indoors, today
  'oak-floor': { ph: 'wood_floor', tex: 1024 },
  'plaster': { ph: 'plastered_wall', tex: 1024 },
  'rug': { ph: 'fabric_pattern_05', tex: 512 },
  'cafe-floor': { ph: 'checkered_pavement_tiles', tex: 1024 },
  'brick': { ph: 'brick_wall_001', tex: 1024 },
  'dark-wood': { ph: 'dark_wooden_planks', tex: 1024 },
  // Outdoors, today
  'asphalt': { ph: 'asphalt_02', tex: 1024 },
  'paving': { ph: 'rectangular_paving', tex: 1024 },
  'concrete': { ph: 'concrete_floor_01', tex: 1024 },
  'facade-tiles': { ph: 'rectangular_facade_tiles', tex: 1024 },
  'red-brick': { ph: 'red_brick_03', tex: 1024 },
  'grass': { acg: 'Grass001', tex: 1024 },
  'gravel': { ph: 'gravel_floor', tex: 1024 },
  'sandstone': { ph: 'sandstone_blocks_04', tex: 1024 },
  // China
  'grey-roof': { ph: 'grey_roof_tiles', tex: 1024 },
  'courtyard-paving': { ph: 'brick_floor_02', tex: 1024 },
  'palace-floor': { ph: 'square_floor', tex: 1024 },
  'stone-tiles': { ph: 'stone_tiles', tex: 1024 },
  'red-plaster': { ph: 'red_plaster_weathered', tex: 1024 },
  'rough-plaster': { ph: 'white_rough_plaster', tex: 1024 },
  'planks': { ph: 'brown_planks_05', tex: 1024 },
  'cobblestones': { ph: 'cobblestone_floor_01', tex: 1024 },
  // History
  'marble': { ph: 'marble_01', tex: 1024 },
  'temple-paving': { ph: 'sandstone_blocks_08', tex: 1024 },
  'dry-ground': { ph: 'dry_ground_01', tex: 1024 },
  'stone-blocks': { ph: 'medieval_blocks_03', tex: 1024 },
  'flagstones': { ph: 'precast_stone_paving', tex: 1024 },
  'old-planks': { ph: 'old_planks_02', tex: 1024 },
} satisfies Record<string, SurfaceAsset>;
export type SurfaceId = keyof typeof SURFACES;

/** The skies round the outdoor sets in 3D (Poly Haven's skies without ground, 1K HDR), by the light's time of day. */
export const SKIES = {
  day: 'kloofendal_48d_partly_cloudy_puresky',
  dusk: 'qwantani_dusk_2_puresky',
  night: 'qwantani_night_puresky',
  overcast: 'kloofendal_overcast_puresky',
} as const;
export type Sky = keyof typeof SKIES;

/** The bark the trees are grown with (Poly Haven). */
export const BARK = 'bark_brown_02';

/** What `npm run sets` made: each asset's file(s), triangles and bytes, and a surface's tile size (m). */
export interface SetIndex {
  models: Record<string, { file: string; tris: number; bytes: number; size: [number, number, number] }>;
  surfaces: Record<string, { color: string; normal: string; orm: string; bytes: number; tile: number }>;
  skies: Record<string, { file: string; bytes: number }>;
}
