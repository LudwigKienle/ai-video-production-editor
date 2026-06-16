import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const iconsPath = path.join(repoRoot, 'components', 'icons.tsx');
const source = fs.readFileSync(iconsPath, 'utf8');

const expectedExports = [
  'AppLogoIcon',
  'UploadIcon',
  'VideoIcon',
  'ImageIcon',
  'MagicWandIcon',
  'PlayIcon',
  'EditIcon',
  'TrimIcon',
  'ColorIcon',
  'ExportIcon',
  'FolderIcon',
  'UndoIcon',
  'RedoIcon',
  'ScriptIcon',
  'AudioIcon',
  'ScissorsIcon',
  'PdfIcon',
  'PaintBucketIcon',
  'TagIcon',
  'PropertiesIcon',
  'EffectsIcon',
  'TransitionsIcon',
  'TextIcon',
  'MagnetIcon',
  'ChevronLeftIcon',
  'ChevronRightIcon',
  'UserCircleIcon',
  'LandscapeIcon',
  'AddIcon',
  'LockIcon',
  'UnlockIcon',
  'MuteIcon',
  'TransformIcon',
  'KeyingIcon',
  'SearchIcon',
  'MapIcon',
  'BrainCircuitIcon',
  'MessageIcon',
  'TrashIcon',
  'FilmIcon',
  'CameraIcon',
  'ListIcon',
  'GridIcon',
  'MotionIcon',
  'WandSparklesIcon',
  'KeyframeIcon',
  'BrushIcon',
  'PaletteIcon',
  'ClipboardCheckIcon',
  'SparklesIcon',
  'BrainIcon',
  'LayersIcon',
  'EraserIcon',
  'ApertureIcon',
  'MusicNoteIcon',
  'CreditCardIcon',
  'ReceiptIcon',
  'CalendarIcon',
  'CheckCircleIcon',
  'BoxIcon',
  'InfoIcon',
  'DownloadIcon',
];

const failures = [];

if (!source.includes("from 'lucide-react'") && !source.includes('from "lucide-react"')) {
  failures.push('components/icons.tsx should use lucide-react as the shared icon base.');
}

for (const exportName of expectedExports) {
  const exportPattern = new RegExp(`export\\s+const\\s+${exportName}\\b`);
  if (!exportPattern.test(source)) {
    failures.push(`Missing icon export: ${exportName}`);
  }
}

if (!source.includes('IconProps')) {
  failures.push('components/icons.tsx should expose a shared IconProps type for consistent icon wrappers.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Icon system check passed (${expectedExports.length} exports).`);
