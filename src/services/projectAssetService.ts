type ProjectRecord = {
  storyBible?: {
    posterUrl?: string;
    moodboard?: Array<{ url?: string }>;
  };
  mediaItems?: Array<{ path?: string }>;
  references?: Array<{ imagePath?: string | null; imageVersionPaths?: string[]; multiAnglePaths?: string[] }>;
  avatars?: Array<{ imagePath?: string | null }>;
  projectHub?: {
    shotPrompts?: Array<{
      imagePath?: string | null;
      imageVersionPaths?: string[];
      sketchPath?: string | null;
      startFramePath?: string | null;
      endFramePath?: string | null;
      videoPath?: string | null;
      voiceoverPath?: string | null;
      motionReferencePath?: string | null;
      openPoseSourcePath?: string | null;
      openPoseReferencePath?: string | null;
      contextReferences?: Array<{ imagePath?: string | null }>;
    }>;
  };
  reviewData?: {
    shotAnnotations?: Array<{ imagePath?: string | null }>;
  };
};

const isRelativeAssetPath = (value?: string | null) => {
  if (!value) return false;
  if (/^https?:|^data:|^file:/.test(value)) return false;
  return true;
};

const pushPath = (set: Set<string>, value?: string | null) => {
  if (!isRelativeAssetPath(value)) return;
  set.add(value!);
};

export const collectAssetPathsFromProjectJson = (raw: string) => {
  const set = new Set<string>();
  let project: ProjectRecord;
  try {
    project = JSON.parse(raw) as ProjectRecord;
  } catch {
    return [];
  }
  pushPath(set, project.storyBible?.posterUrl);
  project.storyBible?.moodboard?.forEach((entry) => pushPath(set, entry.url || null));

  project.mediaItems?.forEach((item) => pushPath(set, item.path || null));
  project.references?.forEach((ref) => {
    pushPath(set, ref.imagePath || null);
    ref.imageVersionPaths?.forEach((path) => pushPath(set, path || null));
    ref.multiAnglePaths?.forEach((path) => pushPath(set, path || null));
  });
  project.avatars?.forEach((avatar) => pushPath(set, avatar.imagePath || null));

  project.projectHub?.shotPrompts?.forEach((shot) => {
    pushPath(set, shot.imagePath || null);
    shot.imageVersionPaths?.forEach((path) => pushPath(set, path || null));
    pushPath(set, shot.sketchPath || null);
    pushPath(set, shot.startFramePath || null);
    pushPath(set, shot.endFramePath || null);
    pushPath(set, shot.videoPath || null);
    pushPath(set, shot.voiceoverPath || null);
    pushPath(set, shot.motionReferencePath || null);
    pushPath(set, shot.openPoseSourcePath || null);
    pushPath(set, shot.openPoseReferencePath || null);
    shot.contextReferences?.forEach((ctx) => pushPath(set, ctx.imagePath || null));
  });

  project.reviewData?.shotAnnotations?.forEach((annotation) => pushPath(set, annotation.imagePath || null));

  return Array.from(set);
};
