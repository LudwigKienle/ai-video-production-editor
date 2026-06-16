import handPaintedAnimation from '../assets/styles/hand-painted-animation.jpg';
import urbanLoneliness from '../assets/styles/urban-loneliness.jpg';
import classicSuspense from '../assets/styles/classic-suspense.png';
import noirBw from '../assets/styles/noir-bw.jpg';
import painterly from '../assets/styles/painterly.png';
import cyberpunk from '../assets/styles/cyberpunk.jpg';
import watercolor from '../assets/styles/watercolor.jpg';
import symmetricPastel from '../assets/styles/symmetric-pastel.jpg';
import neonBrutalist from '../assets/styles/neon-brutalist.jpg';
import greenCyberNoir from '../assets/styles/green-cyber-noir.jpg';
import desertEpic from '../assets/styles/desert-epic.jpg';
import psychologicalHorror from '../assets/styles/psychological-horror.jpg';
import daylightHorror from '../assets/styles/daylight-horror.jpg';
import neonGridWorld from '../assets/styles/neon-grid-world.jpg';
import graphicNoir from '../assets/styles/graphic-noir.jpg';
import historicalDrama from '../assets/styles/historical-drama.jpg';
// New Styles
import styleSteampunk from '../assets/styles/style-steampunk.jpg';
import styleVaporwave from '../assets/styles/style-vaporwave.jpg';
import styleGothic from '../assets/styles/style-gothic.jpg';
import styleMinimalist from '../assets/styles/style-minimalist.jpg';
import styleSurrealist from '../assets/styles/style-surrealist.jpg';
import styleDocumentary from '../assets/styles/style-documentary.jpg';
import styleVintage70s from '../assets/styles/style-vintage-70s.jpg';
import styleAnime90s from '../assets/styles/style-anime-90s.jpg';
import style3dAnimation from '../assets/styles/style-3d-animation.jpg';
import stylePolaroid from '../assets/styles/style-polaroid.png';
import styleVhs from '../assets/styles/style-vhs.png';
import styleTechnicolor from '../assets/styles/style-technicolor.png';
import styleGrindhouse from '../assets/styles/style-grindhouse.png';
import styleEthereal from '../assets/styles/style-ethereal.png';
import styleClaymation from '../assets/styles/style-claymation.jpg';
import styleInfrared from '../assets/styles/style-infrared.png';
import stylePopArt from '../assets/styles/style-pop-art.jpg';
import styleGlitch from '../assets/styles/style-glitch.jpg';
import stylePapercraft from '../assets/styles/style-papercraft.png';
import styleRetrofuturism from '../assets/styles/style_retrofuturism_1772276196864.png';
import styleDarkacademia from '../assets/styles/style_darkacademia_1772276210571.png';
import styleCybergoth from '../assets/styles/style_cybergoth_1772276305380.png';
import styleBiopunk from '../assets/styles/style_biopunk_1772276321020.png';
import styleSynthwave from '../assets/styles/style_synthwave_1772276335306.png';
import styleOrigami from '../assets/styles/style_origami_1772438656113.png';
import styleNeonNoir from '../assets/styles/style_neon_noir_1772438670108.png';
import styleSketch from '../assets/styles/style_sketch_1772438683920.png';
import style8Bit from '../assets/styles/style_8bit_1772438848092.png';
import styleMacro from '../assets/styles/style_macro_1772438728106.png';
import stylePastelDream from '../assets/styles/style_pastel_dream_1772438740292.png';
import styleFriendly3dAnimation from '../assets/styles/style_friendly_3d_animation.png';
import styleClassicCelAnimation from '../assets/styles/style_classic_cel_animation.png';
import styleStopMotion from '../assets/styles/style_stop_motion.png';
import styleComicBook from '../assets/styles/style_comic_book.png';

export type StylePreset = {
  id: string;
  label: string;
  prompt: string;
  image: string;
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'historical-drama',
    label: 'Historical Drama',
    prompt: 'historical drama aesthetic, 19th century Berlin, warm candlelight, detailed period costumes, rich textures, soft cinematic lighting',
    image: historicalDrama,
  },
  {
    id: 'hand-painted-animation',
    label: 'Hand-Painted Animation',
    prompt: 'hand-painted animation, warm light, soft gradients, whimsical atmosphere',
    image: handPaintedAnimation,
  },
  {
    id: 'urban-loneliness',
    label: 'Urban Loneliness',
    prompt: 'quiet realism, hard sunlight, cinematic loneliness, sparse urban interiors',
    image: urbanLoneliness,
  },
  {
    id: 'classic-suspense',
    label: 'Classic Suspense',
    prompt: 'classic suspense lighting, dramatic shadows, 1950s cinema mood',
    image: classicSuspense,
  },
  {
    id: 'noir-bw',
    label: 'Black and White',
    prompt: 'black and white, high contrast, film grain, moody shadows',
    image: noirBw,
  },
  {
    id: 'painterly',
    label: 'Painterly',
    prompt: 'visible brush strokes, textured canvas, expressive colors',
    image: painterly,
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    prompt: 'neon city lights, rain, reflective surfaces, futuristic atmosphere',
    image: cyberpunk,
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    prompt: 'watercolor illustration, soft edges, textured paper, gentle washes',
    image: watercolor,
  },
  {
    id: 'symmetric-pastel',
    label: 'Symmetric Pastel',
    prompt: 'symmetrical composition, pastel color palette, flat lighting, quirky aesthetic',
    image: symmetricPastel,
  },
  {
    id: 'neon-brutalist',
    label: 'Neon Brutalist',
    prompt: 'monochromatic orange haze, brutalist architecture, atmospheric fog, silhouette lighting',
    image: neonBrutalist,
  },
  {
    id: 'green-cyber-noir',
    label: 'Green Cyber Noir',
    prompt: 'green tint, cybergoth aesthetic, high contrast, glossy textures, code rain atmosphere',
    image: greenCyberNoir,
  },
  {
    id: 'desert-epic',
    label: 'Desert Epic',
    prompt: 'monochromatic desert tones, spice haze, brutalist scale, organic technology, cinematic wide shot',
    image: desertEpic,
  },
  {
    id: 'psychological-horror',
    label: 'Psychological Horror',
    prompt: 'dark psychological horror, dim lighting, miniature aesthetic, unsettling atmosphere',
    image: psychologicalHorror,
  },
  {
    id: 'daylight-horror',
    label: 'Daylight Horror',
    prompt: 'bright daylight horror, overexposed whites, vibrant floral colors, unsettling cheerfulness',
    image: daylightHorror,
  },
  {
    id: 'neon-grid-world',
    label: 'Neon Grid World',
    prompt: 'dark background, glowing neon lines, clean geometry, electrical blue and orange, digital world',
    image: neonGridWorld,
  },
  {
    id: 'graphic-noir',
    label: 'Graphic Noir',
    prompt: 'high contrast black and white, splashes of single vibrant color, comic book noir aesthetic',
    image: graphicNoir,
  },
  {
    id: 'steampunk',
    label: 'Steampunk',
    prompt: 'steampunk aesthetic, Victorian industrial, brass gears, steam power, copper tones, intricate mechanical details',
    image: styleSteampunk,
  },
  {
    id: 'vaporwave',
    label: 'Vaporwave',
    prompt: 'vaporwave aesthetic, 80s nostalgia, neon pink and blue, marble statues, glitch art, lo-fi VHS look',
    image: styleVaporwave,
  },
  {
    id: 'gothic',
    label: 'Gothic',
    prompt: 'gothic aesthetic, dark moody atmosphere, cathedral architecture, fog, shadows, dramatic lighting',
    image: styleGothic,
  },
  {
    id: 'minimalist',
    label: 'Minimalist',
    prompt: 'minimalist composition, clean lines, negative space, simple color palette, uncluttered',
    image: styleMinimalist,
  },
  {
    id: 'surrealist',
    label: 'Surrealist',
    prompt: 'surrealist art style, dream-like atmosphere, bizarre juxtapositions, impossible objects',
    image: styleSurrealist,
  },
  {
    id: 'documentary',
    label: 'Documentary',
    prompt: 'documentary style, handheld camera, natural lighting, raw realism, journalistic look',
    image: styleDocumentary,
  },
  {
    id: 'vintage-70s',
    label: 'Vintage 70s',
    prompt: '1970s film look, warm yellow tones, film grain, vintage fashion, retro aesthetic',
    image: styleVintage70s,
  },
  {
    id: 'anime-90s',
    label: '90s Anime',
    prompt: '90s anime style, cel shading, hand drawn, detailed backgrounds, retro animation aesthetic',
    image: styleAnime90s,
  },
  {
    id: 'friendly-3d-animation',
    label: '3D Animation',
    prompt: 'high fidelity 3D animation, bright colors, soft lighting, expressive characters',
    image: style3dAnimation,
  },
  {
    id: 'polaroid',
    label: 'Polaroid',
    prompt: 'polaroid film aesthetic, instant photo look, faded colors, soft focus, vintage vibe',
    image: stylePolaroid,
  },
  {
    id: 'vhs',
    label: 'VHS',
    prompt: 'VHS tape aesthetic, tracking lines, color bleeding, low resolution, 80s home video look',
    image: styleVhs,
  },
  {
    id: 'technicolor',
    label: 'Technicolor',
    prompt: 'technicolor process, saturated colors, vibrant reds and greens, classic hollywood look',
    image: styleTechnicolor,
  },
  {
    id: 'grindhouse',
    label: 'Grindhouse',
    prompt: 'grindhouse cinema, scratched film, dirt, high contrast, saturated colors, b-movie aesthetic',
    image: styleGrindhouse,
  },
  {
    id: 'ethereal',
    label: 'Ethereal',
    prompt: 'ethereal atmosphere, soft bloom, dreamy lighting, pastel colors, angelic vibe',
    image: styleEthereal,
  },
  {
    id: 'claymation',
    label: 'Claymation',
    prompt: 'stop motion claymation, plasticine texture, handmade look, studio lighting, aardman style',
    image: styleClaymation,
  },
  {
    id: 'papercraft',
    label: 'Papercraft',
    prompt: 'papercraft style, cut paper textures, layered depth, origami elements, handmade aesthetic, soft shadows, vibrant colors, stop motion feel',
    image: stylePapercraft,
  },
  {
    id: 'infrared',
    label: 'Infrared',
    prompt: 'infrared photography, surreal colors, white foliage, dark skies, dreamlike contrast',
    image: styleInfrared,
  },
  {
    id: 'pop-art',
    label: 'Pop Art',
    prompt: 'pop art style, warhol aesthetic, bold colors, halftone dots, comic book elements',
    image: stylePopArt,
  },
  {
    id: 'glitch',
    label: 'Glitch Art',
    prompt: 'digital glitch art, data mosh, pixel sorting, visual artifacts, cyber chaos',
    image: styleGlitch,
  },
  {
    id: 'retrofuturism',
    label: 'Retro-Futurism',
    prompt: '1950s atomic age sci-fi aesthetic, shiny chrome flying cars, stylized rayguns, pastel color palette, optimistic future, Norman Rockwell meets sci-fi',
    image: styleRetrofuturism,
  },
  {
    id: 'dark-academia',
    label: 'Dark Academia',
    prompt: 'old dusty library, mahogany wood, vintage leather books, flickering candlelight, mysterious atmosphere, moody and intellectual, highly detailed',
    image: styleDarkacademia,
  },
  {
    id: 'cyber-goth',
    label: 'Cyber-Goth',
    prompt: 'futuristic industrial setting with gothic architectural details, dark moody lighting, neon green and purple accents, high contrast, highly detailed',
    image: styleCybergoth,
  },
  {
    id: 'biopunk',
    label: 'Biopunk',
    prompt: 'organic technology, glowing bioluminescent veins, dark and chaotic laboratory environment, fleshy textures, green and cyan lighting',
    image: styleBiopunk,
  },
  {
    id: 'synthwave',
    label: 'Synthwave',
    prompt: 'retro 80s futuristic grid, glowing pink and cyan neon lights, stylized palm trees, retrowave sun, low poly landscape, vibrant colors',
    image: styleSynthwave,
  },
  {
    id: 'origami',
    label: 'Origami World',
    prompt: 'Origami World style, folded paper textures, sharp creases on geometric shapes, soft studio lighting, macro photography, high detail',
    image: styleOrigami,
  },
  {
    id: 'neon-noir',
    label: 'Neon Noir',
    prompt: 'Neon Noir style, moody cinematic lighting, bright glowing pink and blue neon signs reflecting in rain puddles, mysterious alleyway, high contrast',
    image: styleNeonNoir,
  },
  {
    id: 'pencil-sketch',
    label: 'Pencil Sketch',
    prompt: 'Pencil Sketch style, loose expressive graphite lines, detailed cross-hatching shading, monochromatic drawing, artistic aesthetic',
    image: styleSketch,
  },
  {
    id: '8bit-retro',
    label: '8-Bit Retro',
    prompt: '8-Bit Retro Game style, crisp pixel art, vibrant nostalgic colors, isometric view of a landscape, vintage arcade aesthetic',
    image: style8Bit,
  },
  {
    id: 'macro-miniature',
    label: 'Macro Miniature',
    prompt: 'Macro Miniature World style, tilt-shift photography, shallow depth of field, tiny detailed objects looking massive, realistic textures',
    image: styleMacro,
  },
  {
    id: 'pastel-dream',
    label: 'Pastel Dreamscape',
    prompt: 'Pastel Dreamscape style, soft cotton candy clouds, gradients of pink and baby blue, ethereal glowing lights, dreamy surreal atmosphere',
    image: stylePastelDream,
  },
  {
    id: 'friendly-3d-character',
    label: 'Friendly 3D Character',
    prompt: 'A cute high quality 3D render showing an expressive character in a magical environment, vibrant colors, soft lighting, intricate details',
    image: styleFriendly3dAnimation,
  },
  {
    id: 'classic-cel-animation',
    label: 'Classic Cel Animation',
    prompt: 'A beautiful hand-drawn cel animation frame with a magical forest, expressive cute animal, rich colors, nostalgic feel',
    image: styleClassicCelAnimation,
  },
  {
    id: 'stop-motion',
    label: 'Stop Motion',
    prompt: 'stop motion animation style, highly detailed miniature set, clay and fabric textures, dramatic cinematic lighting, slight tilt-shift',
    image: styleStopMotion,
  },
  {
    id: 'comic-book',
    label: 'Comic Book',
    prompt: 'Vintage comic book style illustration, bright pop colors, halftone dots, thick outlines, expressive action scene',
    image: styleComicBook,
  }
];
