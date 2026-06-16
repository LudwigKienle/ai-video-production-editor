import React from 'react';
import {
  Aperture,
  Box,
  Brain,
  BrainCircuit,
  Brush,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Diamond,
  Download,
  Eraser,
  FileText,
  Film,
  Folder,
  Grid3X3,
  Image as ImageSvg,
  Info,
  KeyRound,
  Layers,
  List,
  Lock,
  Magnet,
  Map,
  MessageSquare,
  Mountain,
  Move3D,
  PaintBucket,
  Palette,
  PencilLine,
  PlayCircle,
  Plus,
  ReceiptText,
  Redo2,
  Scissors,
  Search,
  Settings2,
  Sparkles,
  SplitSquareHorizontal,
  Tag,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  UserCircle,
  Video,
  Volume2,
  VolumeX,
  WandSparkles,
  Music,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

export type IconProps = LucideProps;

const hasAccessibleName = (props: IconProps) =>
  Boolean(props['aria-label'] || props['aria-labelledby'] || props.title);

const createIcon = (Icon: LucideIcon, displayName: string): React.FC<IconProps> => {
  const IconComponent: React.FC<IconProps> = (props) => (
    <Icon
      aria-hidden={hasAccessibleName(props) ? undefined : true}
      focusable="false"
      strokeWidth={1.75}
      {...props}
    />
  );

  IconComponent.displayName = displayName;
  return IconComponent;
};

export const AppLogoIcon: React.FC<IconProps> = (props) => {
  const { className, ...rest } = props;

  return (
    <svg
      aria-hidden={hasAccessibleName(props) ? undefined : true}
      focusable="false"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...rest}
    >
      <path
        d="M20 4L34 12V28L20 36L6 28V12L20 4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-20"
      />
      <path d="M20 4V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-50" />
      <path d="M6 28L11 25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-50" />
      <path d="M34 28L29 25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-50" />
      <path
        d="M16 14L28 20L16 26V14Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="14" r="2" fill="white" />
      <circle cx="16" cy="26" r="2" fill="white" />
      <circle cx="28" cy="20" r="2" fill="white" />
    </svg>
  );
};

export const UploadIcon = createIcon(Upload, 'UploadIcon');
export const VideoIcon = createIcon(Video, 'VideoIcon');
export const ImageIcon = createIcon(ImageSvg, 'ImageIcon');
export const MagicWandIcon = createIcon(WandSparkles, 'MagicWandIcon');
export const PlayIcon = createIcon(PlayCircle, 'PlayIcon');
export const EditIcon = createIcon(PencilLine, 'EditIcon');
export const TrimIcon = createIcon(Scissors, 'TrimIcon');
export const ColorIcon = createIcon(Palette, 'ColorIcon');
export const ExportIcon = createIcon(Upload, 'ExportIcon');
export const FolderIcon = createIcon(Folder, 'FolderIcon');
export const UndoIcon = createIcon(Undo2, 'UndoIcon');
export const RedoIcon = createIcon(Redo2, 'RedoIcon');
export const ScriptIcon = createIcon(FileText, 'ScriptIcon');
export const AudioIcon = createIcon(Volume2, 'AudioIcon');
export const ScissorsIcon = createIcon(Scissors, 'ScissorsIcon');
export const PdfIcon = createIcon(FileText, 'PdfIcon');
export const PaintBucketIcon = createIcon(PaintBucket, 'PaintBucketIcon');
export const TagIcon = createIcon(Tag, 'TagIcon');
export const PropertiesIcon = createIcon(Settings2, 'PropertiesIcon');
export const EffectsIcon = createIcon(Sparkles, 'EffectsIcon');
export const TransitionsIcon = createIcon(SplitSquareHorizontal, 'TransitionsIcon');
export const TextIcon = createIcon(Type, 'TextIcon');
export const MagnetIcon = createIcon(Magnet, 'MagnetIcon');
export const ChevronLeftIcon = createIcon(ChevronLeft, 'ChevronLeftIcon');
export const ChevronRightIcon = createIcon(ChevronRight, 'ChevronRightIcon');
export const UserCircleIcon = createIcon(UserCircle, 'UserCircleIcon');
export const LandscapeIcon = createIcon(Mountain, 'LandscapeIcon');
export const AddIcon = createIcon(Plus, 'AddIcon');
export const LockIcon = createIcon(Lock, 'LockIcon');
export const UnlockIcon = createIcon(Unlock, 'UnlockIcon');
export const MuteIcon = createIcon(VolumeX, 'MuteIcon');
export const TransformIcon = createIcon(Move3D, 'TransformIcon');
export const KeyingIcon = createIcon(KeyRound, 'KeyingIcon');
export const SearchIcon = createIcon(Search, 'SearchIcon');
export const MapIcon = createIcon(Map, 'MapIcon');
export const BrainCircuitIcon = createIcon(BrainCircuit, 'BrainCircuitIcon');
export const MessageIcon = createIcon(MessageSquare, 'MessageIcon');
export const TrashIcon = createIcon(Trash2, 'TrashIcon');
export const FilmIcon = createIcon(Film, 'FilmIcon');
export const CameraIcon = createIcon(Camera, 'CameraIcon');
export const ListIcon = createIcon(List, 'ListIcon');
export const GridIcon = createIcon(Grid3X3, 'GridIcon');
export const MotionIcon = createIcon(Move3D, 'MotionIcon');
export const WandSparklesIcon = createIcon(WandSparkles, 'WandSparklesIcon');
export const KeyframeIcon = createIcon(Diamond, 'KeyframeIcon');
export const BrushIcon = createIcon(Brush, 'BrushIcon');
export const PaletteIcon = createIcon(Palette, 'PaletteIcon');
export const ClipboardCheckIcon = createIcon(ClipboardCheck, 'ClipboardCheckIcon');
export const SparklesIcon = createIcon(Sparkles, 'SparklesIcon');
export const BrainIcon = createIcon(Brain, 'BrainIcon');
export const LayersIcon = createIcon(Layers, 'LayersIcon');
export const EraserIcon = createIcon(Eraser, 'EraserIcon');
export const ApertureIcon = createIcon(Aperture, 'ApertureIcon');
export const MusicNoteIcon = createIcon(Music, 'MusicNoteIcon');
export const CreditCardIcon = createIcon(CreditCard, 'CreditCardIcon');
export const ReceiptIcon = createIcon(ReceiptText, 'ReceiptIcon');
export const CalendarIcon = createIcon(Calendar, 'CalendarIcon');
export const CheckCircleIcon = createIcon(CheckCircle2, 'CheckCircleIcon');
export const BoxIcon = createIcon(Box, 'BoxIcon');
export const InfoIcon = createIcon(Info, 'InfoIcon');
export const DownloadIcon = createIcon(Download, 'DownloadIcon');
