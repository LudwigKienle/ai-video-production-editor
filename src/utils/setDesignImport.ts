export const SUPPORTED_MODEL_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj'] as const;

export type SupportedModelExtension = typeof SUPPORTED_MODEL_EXTENSIONS[number];

export const MODEL_IMPORT_ACCEPT = SUPPORTED_MODEL_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export const normalizeModelExtension = (value: string) => value.toLowerCase().replace('.', '');

export const isSupportedModelExtension = (name: string) => {
  const extension = normalizeModelExtension(name.split('.').pop() || '');
  return SUPPORTED_MODEL_EXTENSIONS.includes(extension as SupportedModelExtension);
};
