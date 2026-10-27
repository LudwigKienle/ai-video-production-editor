/**
 * Diana, Roman goddess of the hunt, in profile with a drawn bow.
 * Clean-room drawing: every curve below is our own Bézier construction.
 *
 * Design coordinates: feet at y = 0, the figure faces +x and is about 770
 * units tall. `dianaPose` returns the masses (closed shapes; their union gives
 * the silhouette and, via stroke-then-knockout, the outline), detail strokes,
 * the bow and the string for a given draw amount.
 */
import { cubic, line, type Pt, type SubPath } from '../brand/logoGeometry.ts';
import { add, ellipse, lerpP, limb, mul, norm, perp, shape, stroke, sub } from './shapeKit.ts';

/** Aim direction of the arrow (slightly upwards to the right). */
export const DIANA_AIM: Pt = norm([0.99, -0.12]);

/** Draw-hand (nock) anchor at full draw, below the cheek. */
const ANCHOR: Pt = [30, -668];
/** Distance nock -> bow grip at full draw (design units). */
const FULL_DRAW = 238;
/** Brace height: string-to-grip distance at rest. */
const BRACE = 30;
const BOW_HALF = 196;

export type DianaPose = {
  masses: SubPath[];
  details: SubPath[];
  /** Small filled accents (crescent diadem). */
  accents: SubPath[];
  bow: SubPath;
  string: SubPath;
  /** Nock point = where the arrow's tail sits (design units). */
  nock: Pt;
  grip: Pt;
};

/**
 * @param draw 0 = string at rest, 1 = full draw.
 * @param stringWobble after release: lateral offset of the string centre (units).
 * @param follow follow-through of the draw hand after release (0..1).
 */
export function dianaPose(draw: number, stringWobble = 0, follow = 0): DianaPose {
  const d = DIANA_AIM;
  const n = perp(d); // points up-left
  const grip = add(ANCHOR, mul(d, FULL_DRAW));
  const restNock = sub(grip, mul(d, BRACE));
  const nock = lerpP(restNock, ANCHOR, Math.max(0, Math.min(1, draw)));
  const tension = Math.max(0, Math.min(1, draw));

  // Bow limbs bend back with tension; recurve tips.
  const tipBack = 22 * tension;
  const tipIn = 8 * tension;
  const top = add(sub(grip, mul(d, BRACE + tipBack)), mul(n, BOW_HALF - tipIn));
  const bottom = add(sub(grip, mul(d, BRACE + tipBack)), mul(n, -(BOW_HALF - tipIn)));
  const bow = stroke(
    cubic(top, add(top, add(mul(d, 34), mul(n, -40))), add(grip, add(mul(d, 16), mul(n, 92))), grip),
    cubic(grip, add(grip, add(mul(d, 16), mul(n, -92))), add(bottom, add(mul(d, 34), mul(n, 40))), bottom),
  );
  // String: V to the nock while drawn, straight (with wobble) at rest.
  const restMid = add(lerpP(top, bottom, 0.5), mul(d, -stringWobble));
  const stringMid = draw > 0.02 ? nock : restMid;
  const string = stroke(line(top, stringMid), line(stringMid, bottom));

  // Hands and arms.
  const drawHand = follow > 0 ? add(ANCHOR, add(mul(d, -26 * follow), mul(n, 6 * follow))) : nock;
  const shoulderF: Pt = [20, -628];
  const shoulderB: Pt = [-22, -630];
  const elbowF: Pt = add(lerpP(shoulderF, grip, 0.5), [0, 7]);
  const elbowB: Pt = add(drawHand, add(mul(d, -142), [0, -10]));

  const masses: SubPath[] = [
    // head in profile
    shape(
      cubic([0, -758], [-26, -758], [-42, -736], [-40, -706]),
      cubic([-40, -706], [-38, -688], [-27, -675], [-12, -668]),
      cubic([-12, -668], [4, -662], [22, -661], [30, -668]),
      cubic([30, -668], [35, -673], [35, -680], [33, -685]),
      cubic([33, -685], [37, -688], [37, -692], [34, -695]),
      cubic([34, -695], [39, -698], [45, -701], [44, -706]),
      cubic([44, -706], [40, -715], [34, -723], [32, -731]),
      cubic([32, -731], [30, -748], [18, -758], [0, -758]),
    ),
    ellipse([-45, -740], 16, 14, -20), // hair bun
    limb([3, -668], [6, -622], 12.5, 15), // neck
    // torso: bust, waist, curved back
    shape(
      line([-28, -630], [24, -634]),
      cubic([24, -634], [40, -612], [46, -580], [38, -560]),
      cubic([38, -560], [32, -546], [22, -520], [15, -480]),
      line([15, -480], [-22, -480]),
      cubic([-22, -480], [-30, -530], [-42, -580], [-28, -630]),
    ),
    // knee-length chiton, hem fluttering backwards
    shape(
      line([-22, -486], [15, -486]),
      cubic([15, -486], [40, -440], [52, -330], [72, -246]),
      cubic([72, -246], [50, -232], [24, -228], [2, -240]),
      cubic([2, -240], [-22, -226], [-48, -230], [-70, -238]),
      cubic([-70, -238], [-86, -236], [-100, -228], [-118, -222]),
      cubic([-118, -222], [-90, -290], [-40, -380], [-22, -486]),
    ),
    limb([50, -256], [72, -150], 16, 13.5), // front leg
    limb([72, -150], [94, -26], 13.5, 7.5),
    limb([94, -18], [136, -4], 8, 5), // front foot
    limb([-44, -252], [-70, -152], 16, 13.5), // back leg
    limb([-70, -152], [-94, -34], 13.5, 7.5),
    limb([-100, -24], [-62, -4], 8, 5), // back foot, heel lifted
    limb([-58, -676], [-31, -506], 12, 9.5), // quiver on the back
    limb(shoulderF, elbowF, 13.5, 10.5), // bow arm
    limb(elbowF, grip, 10.5, 8),
    ellipse(grip, 10, 11.5, 0), // bow hand
    limb(shoulderB, elbowB, 13.5, 11), // draw arm
    limb(elbowB, drawHand, 11, 8),
    ellipse(drawHand, 9.5, 9.5, 0), // draw hand
  ];

  const details: SubPath[] = [
    stroke(line([-22, -484], [16, -484])), // belt
    stroke(cubic([-22, -624], [0, -592], [12, -540], [15, -500])), // chiton strap
    stroke(cubic([-4, -478], [-12, -400], [-22, -320], [-34, -246])), // skirt folds
    stroke(cubic([8, -478], [16, -400], [26, -320], [36, -244])),
    stroke(cubic([-112, -722], [-92, -716], [-74, -728], [-58, -736])), // hair ribbon in the wind
    stroke(cubic([-124, -700], [-100, -700], [-78, -720], [-60, -730])),
    stroke(cubic([20, -751], [0, -746], [-22, -744], [-38, -742])), // hair line to the bun
    stroke(line([27, -715], [22, -713])), // eye
    // fletchings in the quiver
    stroke(line([-64, -694], [-58, -676]), line([-58, -676], [-50, -693])),
    stroke(line([-72, -684], [-62, -670])),
  ];

  // Crescent diadem: horns up, just above the forehead.
  const accents: SubPath[] = [
    shape(
      cubic([-2, -766], [2, -750], [26, -750], [30, -766]),
      cubic([30, -766], [22, -758], [6, -758], [-2, -766]),
    ),
  ];

  return { masses, details, accents, bow, string, nock, grip };
}
