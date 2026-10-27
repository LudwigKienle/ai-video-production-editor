/**
 * Time marks of the start animation (seconds), shared by the picture
 * (renderSplashFrame) and the sound (startSound). [start, end] ranges.
 */
export const SPLASH_TIMELINE = {
  diana: { in: [0.0, 0.24], draw: [0.04, 0.5], release: 0.52, out: [0.6, 0.98] },
  flight: [0.52, 1.1],
  hermes: { unfurl: [0.56, 0.8], morph: [0.96, 1.36] },
  trail: [0.52, 1.3],
  impact: [1.1, 1.44],
  leaves: [0.96, 1.36],
  loop: [1.12, 1.5],
  ring: [1.24, 1.76],
  antler: { arc: [1.52, 1.88], outer: [1.7, 1.94], inner: [1.78, 2.0] },
  eyes: [1.88, 2.12],
  smile: [2.02, 2.36],
  shimmer: [2.3, 2.72],
  wordmark: [2.12, 2.62],
  product: [2.24, 2.7],
  rule: [2.3, 2.66],
  claim: [2.38, 2.8],
  handoff: [3.04, 3.4],
  end: 3.4,
} as const;

export const REDUCED_TIMELINE = { fadeIn: [0, 0.22], handoff: [0.36, 0.6], end: 0.6 } as const;

