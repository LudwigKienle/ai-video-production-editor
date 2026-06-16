import type {
  DesignCanvasElement,
  DesignCanvasPreset,
  DesignCanvasState,
} from '../types';

export const DESIGN_CANVAS_PRESETS: Record<DesignCanvasPreset, { width: number; height: number; label: string }> = {
  '16:9': { width: 1920, height: 1080, label: 'Landscape' },
  '9:16': { width: 1080, height: 1920, label: 'Vertical' },
  '1:1': { width: 1080, height: 1080, label: 'Square' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait' },
};

type ElementInput = Partial<DesignCanvasElement> & Pick<DesignCanvasElement, 'type'>;

const makeId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const nowIso = () => new Date().toISOString();

const sortLayers = (elements: DesignCanvasElement[]) =>
  [...elements]
    .sort((a, b) => a.zIndex - b.zIndex);

const assignLayerOrder = (elements: DesignCanvasElement[]) =>
  elements.map((element, index) => ({ ...element, zIndex: index + 1 }));

export const resolveDesignPreset = (preset: unknown) => {
  if (preset === '16:9' || preset === '9:16' || preset === '1:1' || preset === '4:5') {
    return DESIGN_CANVAS_PRESETS[preset];
  }
  return DESIGN_CANVAS_PRESETS['16:9'];
};

export const normalizeDesignPreset = (preset: unknown): DesignCanvasPreset => {
  if (preset === '16:9' || preset === '9:16' || preset === '1:1' || preset === '4:5') return preset;
  return '16:9';
};

export const createDefaultDesignState = (preset: DesignCanvasPreset = '16:9'): DesignCanvasState => {
  const resolved = resolveDesignPreset(preset);
  return {
    id: makeId('design'),
    name: `${preset} Design`,
    preset,
    width: resolved.width,
    height: resolved.height,
    background: '#111827',
    elements: [],
    selectedElementId: null,
    updatedAt: nowIso(),
  };
};

const getElementDefaults = (
  state: DesignCanvasState,
  input: ElementInput,
): Omit<DesignCanvasElement, 'id' | 'type' | 'name' | 'zIndex'> => {
  const maxWidth = Math.max(240, Math.round(state.width * 0.36));
  const maxHeight = Math.max(160, Math.round(state.height * 0.26));
  const base = {
    x: Math.round(state.width * 0.32),
    y: Math.round(state.height * 0.32),
    width: input.width ?? maxWidth,
    height: input.height ?? maxHeight,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };

  if (input.type === 'text') {
    return {
      ...base,
      height: input.height ?? Math.max(96, Math.round(state.height * 0.12)),
      text: input.text ?? 'Title text',
      fontFamily: input.fontFamily ?? 'Inter, Arial, sans-serif',
      fontSize: input.fontSize ?? Math.max(48, Math.round(state.width * 0.055)),
      fontWeight: input.fontWeight ?? 'bold',
      textAlign: input.textAlign ?? 'center',
      color: input.color ?? '#FFFFFF',
      fill: input.fill ?? 'transparent',
    };
  }

  if (input.type === 'shape') {
    return {
      ...base,
      fill: input.fill ?? '#2563EB',
      stroke: input.stroke ?? 'transparent',
      strokeWidth: input.strokeWidth ?? 0,
      borderRadius: input.borderRadius ?? 24,
      shape: input.shape ?? 'rect',
    };
  }

  return {
    ...base,
    fill: input.fill ?? 'transparent',
  };
};

export const addDesignElement = (state: DesignCanvasState, input: ElementInput): DesignCanvasState => {
  const nextZ = Math.max(0, ...state.elements.map((element) => element.zIndex)) + 1;
  const element: DesignCanvasElement = {
    ...getElementDefaults(state, input),
    ...input,
    id: input.id ?? makeId(input.type),
    type: input.type,
    name: input.name ?? (input.type === 'image' ? 'Image' : input.type === 'text' ? 'Text' : 'Shape'),
    zIndex: input.zIndex ?? nextZ,
    visible: input.visible ?? true,
    locked: input.locked ?? false,
  };

  return {
    ...state,
    elements: sortLayers([...state.elements, element]),
    selectedElementId: element.id,
    updatedAt: nowIso(),
  };
};

export const updateDesignElement = (
  state: DesignCanvasState,
  elementId: string,
  updates: Partial<DesignCanvasElement>,
): DesignCanvasState => ({
  ...state,
  elements: state.elements.map((element) =>
    element.id === elementId ? { ...element, ...updates, id: element.id, type: element.type } : element,
  ),
  selectedElementId: state.selectedElementId,
  updatedAt: nowIso(),
});

export const removeDesignElement = (state: DesignCanvasState, elementId: string): DesignCanvasState => {
  const elements = assignLayerOrder(sortLayers(state.elements).filter((element) => element.id !== elementId));
  return {
    ...state,
    elements,
    selectedElementId: state.selectedElementId === elementId ? elements[elements.length - 1]?.id ?? null : state.selectedElementId,
    updatedAt: nowIso(),
  };
};

export const duplicateDesignElement = (state: DesignCanvasState, elementId: string): DesignCanvasState => {
  const source = state.elements.find((element) => element.id === elementId);
  if (!source) return state;
  const nextZ = Math.max(0, ...state.elements.map((element) => element.zIndex)) + 1;
  const copy: DesignCanvasElement = {
    ...source,
    id: makeId(source.type),
    name: `${source.name} copy`,
    x: source.x + 24,
    y: source.y + 24,
    zIndex: nextZ,
    locked: false,
  };
  return {
    ...state,
    elements: sortLayers([...state.elements, copy]),
    selectedElementId: copy.id,
    updatedAt: nowIso(),
  };
};

export const moveDesignElementLayer = (
  state: DesignCanvasState,
  elementId: string,
  direction: 'front' | 'back' | 'forward' | 'backward',
): DesignCanvasState => {
  const ordered = assignLayerOrder(sortLayers(state.elements));
  const index = ordered.findIndex((element) => element.id === elementId);
  if (index === -1) return state;

  const next = [...ordered];
  const [element] = next.splice(index, 1);
  if (direction === 'front') {
    next.push(element);
  } else if (direction === 'back') {
    next.unshift(element);
  } else if (direction === 'forward') {
    next.splice(Math.min(next.length, index + 1), 0, element);
  } else {
    next.splice(Math.max(0, index - 1), 0, element);
  }

  return {
    ...state,
    elements: assignLayerOrder(next),
    selectedElementId: elementId,
    updatedAt: nowIso(),
  };
};

export const resizeDesignCanvas = (state: DesignCanvasState, preset: DesignCanvasPreset): DesignCanvasState => {
  const currentWidth = state.width || DESIGN_CANVAS_PRESETS['16:9'].width;
  const currentHeight = state.height || DESIGN_CANVAS_PRESETS['16:9'].height;
  const nextPreset = resolveDesignPreset(preset);
  const scaleX = nextPreset.width / currentWidth;
  const scaleY = nextPreset.height / currentHeight;

  return {
    ...state,
    preset,
    width: nextPreset.width,
    height: nextPreset.height,
    elements: state.elements.map((element) => ({
      ...element,
      x: Math.round(element.x * scaleX),
      y: Math.round(element.y * scaleY),
      width: Math.round(element.width * scaleX),
      height: Math.round(element.height * scaleY),
      fontSize: element.fontSize ? Math.round(element.fontSize * Math.min(scaleX, scaleY)) : element.fontSize,
    })),
    updatedAt: nowIso(),
  };
};

export const normalizeDesignState = (value?: Partial<DesignCanvasState> | null): DesignCanvasState => {
  if (!value) return createDefaultDesignState();
  const preset = normalizeDesignPreset(value.preset);
  const resolved = resolveDesignPreset(preset);
  return {
    id: typeof value.id === 'string' && value.id ? value.id : makeId('design'),
    name: typeof value.name === 'string' && value.name ? value.name : `${preset} Design`,
    preset,
    width: Number.isFinite(value.width) ? Number(value.width) : resolved.width,
    height: Number.isFinite(value.height) ? Number(value.height) : resolved.height,
    background: typeof value.background === 'string' && value.background ? value.background : '#111827',
    elements: assignLayerOrder(sortLayers(Array.isArray(value.elements) ? value.elements.filter(Boolean).map((element) => ({
      ...element,
      id: element.id || makeId(element.type || 'element'),
      type: element.type || 'shape',
      name: element.name || 'Layer',
      x: Number.isFinite(element.x) ? Number(element.x) : 0,
      y: Number.isFinite(element.y) ? Number(element.y) : 0,
      width: Number.isFinite(element.width) ? Number(element.width) : 320,
      height: Number.isFinite(element.height) ? Number(element.height) : 180,
      rotation: Number.isFinite(element.rotation) ? Number(element.rotation) : 0,
      opacity: Number.isFinite(element.opacity) ? Number(element.opacity) : 1,
      zIndex: Number.isFinite(element.zIndex) ? Number(element.zIndex) : 1,
      visible: element.visible !== false,
      locked: element.locked === true,
    } as DesignCanvasElement)) : [])),
    selectedElementId: value.selectedElementId ?? null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
  };
};
