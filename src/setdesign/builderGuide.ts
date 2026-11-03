/**
 * Static guide for agents that build sets with the setdesign_* tools (setdesign_builder_guide).
 * Written for a model without prior knowledge of this app: conventions, workflow, real sizes.
 */
import { FURNITURE_SIZES, OPENING_DEFAULTS, ROOM_DEFAULTS, STAIRS_DEFAULTS } from './builders.ts';
import { PRIMITIVES } from './sceneModel.ts';

const primitiveRows = PRIMITIVES.map((p) => `| ${p.id} | ${p.hint} | centre of its box |`).join('\n');
const furnitureRows = Object.entries(FURNITURE_SIZES).map(([type, entry]) => `| ${type} | ${entry.size.join(' × ')} | ${entry.note} |`).join('\n');

export const BUILDER_GUIDE = `# Set Design 3D builder guide

## Conventions
- Units: metres. Angles: degrees.
- Axes (Blender convention): Z is up, X to the right, Y into the scene (away from a camera in Blender's front view). The floor is z = 0.
- "Front" of furniture and people faces -Y (towards a camera standing at -Y looking along +Y). North = +Y, east = +X.
- rotation is Euler XYZ in degrees; for set pieces you normally only turn about Z (rotationZ / rotation [0, 0, deg]); positive turns counter-clockwise seen from above.
- A camera with rotation [90, 0, 0] looks level along +Y; prefer lookAt / lookAtPoint to aim cameras and lights.
- location of a primitive is the CENTRE of its box: a 1 m box standing on the floor has location z = 0.5. Use dimensions [x, y, z] for real sizes instead of scale.
- Groups (empties) and model origins are where their location is; build.* pieces and groups created by setdesign_group_objects have their origin at the bottom centre, so z = 0 means "standing on the floor".
- Objects inside a group/parent store location/rotation/scale relative to the parent (pass space: "world" to setdesign_transform_object to set world values). Moving, rotating, duplicating, hiding or deleting a group affects everything inside.
- Names are unique (a second "Table" becomes "Table.001"); parts of built pieces are named "<Group>/<Part>", e.g. "Kitchen/Wall North A". Ids never change; use ids or exact names.

## Primitives
| primitive | base size | pivot |
|---|---|---|
${primitiveRows}

## Workflow
1. Plan on paper first: room size, where the camera stands, what must be in frame, in metres.
2. Build in one atomic step with setdesign_batch: build.room → build.furniture / object.add_primitive / object.add_model → material.set → object.add_light → object.add_camera. Steps can refer to earlier results by name, by "$alias" (set "as" on the step) or by "$N" (step number). If any step fails, nothing changes; the error names the step.
3. Check with setdesign_query: floating (gap above the floor and nothing below), sunk (sticking into the floor), overlaps (boxes intersecting), distances, and what the active camera sees (share of frame in %, left/center/right, top/middle/bottom).
4. Look with setdesign_capture_frame (pass "clay" for shapes, "beauty" with shading "material" or "rendered" for materials and light; addToMedia: false for check frames).
5. Correct with object.drop_to_floor, object.align, object.place_on, setdesign_transform_object, setdesign_set_material, then query and look again. Undo with setdesign_history (a whole batch is one undo step).
6. setdesign_describe_scene gives a compact summary of everything (hierarchy, sizes, materials, lights, cameras, problems).

## Building blocks
- build.room: interior width (x) × depth (y) × height, walls outside the interior, floor slab top at z = 0, ceiling optional; openings [{ wall: north|south|east|west, type: door|window, offset (centre along the wall from its middle), width, height, sill }] cut real holes. Defaults: ${ROOM_DEFAULTS.width} × ${ROOM_DEFAULTS.depth} × ${ROOM_DEFAULTS.height} m, walls ${ROOM_DEFAULTS.wallThickness} m; door ${OPENING_DEFAULTS.door.width} × ${OPENING_DEFAULTS.door.height} m; window ${OPENING_DEFAULTS.window.width} × ${OPENING_DEFAULTS.window.height} m at sill ${OPENING_DEFAULTS.window.sill} m. The result lists each opening's world centre and rotationZ, so a build.furniture door/window can be placed into it.
- build.furniture: table, chair, sofa, bed, shelf, door, window, lamp at real sizes (below), origin at the bottom centre, front -Y.
- build.array: rows of copies (chairs, columns, lights): count total, offset per copy in world metres, optional rotateStep.
- build.scatter: deterministic random copies on a floor area or on top of an object (seed, minDistance, randomRotationZ, scaleRange).
- build.stairs: straight solid stairs (default ${STAIRS_DEFAULTS.steps} steps, rise ${STAIRS_DEFAULTS.rise} m, run ${STAIRS_DEFAULTS.run} m, width ${STAIRS_DEFAULTS.width} m), climbing along +Y.
- group.create / group.ungroup / object.parent: build your own hierarchy ("keepWorld" keeps objects in place).
- material.set: PBR values and texture maps (file://, https://, data: URLs) with repeat tiling; groups pass it to everything inside.

## Real-world sizes (metres)
| thing | size |
|---|---|
| person (stand-in) | 1.75 tall, shoulders 0.5 wide, eyes at 1.6 |
| interior door | 0.9 × 2.1 (wide × high), handle at 1.0 |
| window | 1.2 × 1.2, sill 0.9 (kitchen 1.0–1.2) |
| room height | 2.5–3.0 (old buildings 3.2–3.5) |
| wall thickness | interior 0.1–0.12, exterior 0.3–0.4 |
| dining table | 0.75 high, 1.6 × 0.9 for 6 people, 0.6 width per seat |
| coffee table | 0.4–0.45 high |
| chair | seat 0.45 high, 0.45 × 0.5, back 0.9 |
| bar stool / counter | seat 0.75, counter 1.1 |
| kitchen counter | 0.9 high, 0.6 deep |
| desk | 0.75 high, 1.4 × 0.7 |
| sofa | seat 0.42, 0.85 high, 0.9 deep, 2.0 long (3-seater) |
| bed | double 1.6 × 2.0, single 0.9 × 2.0, mattress top 0.5 |
| bookshelf | 1.8–2.0 high, 0.3 deep |
| floor lamp | 1.6–1.8 |
| ceiling lamp | hangs 0.6 below the ceiling |
| light switch / door handle | 1.05 / 1.0 |
| stair step | rise 0.15–0.19, run 0.25–0.30, width ≥ 0.9 |
| car | 4.5 × 1.8 × 1.5 |
| walkway between furniture | ≥ 0.8 |

## Furniture defaults of build.furniture (width × depth × height)
| type | size | note |
|---|---|---|
${furnitureRows}

## Cameras and light
- Eye-level camera: z 1.5–1.7. Lens: 24–35 mm wide/establishing, 50 mm normal, 85 mm portrait. Keep the camera 0.5 m+ away from walls and outside objects.
- Lights in watts like Blender: point/spot/area 100–1000 W indoors, sun 3–10 W/m² daylight. Colour temperature 2700–3200 K tungsten, 5600 K daylight.
- Use shading "solid" to check shapes, "material" for materials/textures, "rendered" for scene lights and shadows.
`;
