import React, { useEffect, useMemo, useState } from 'react';
import { CharacterOutfit, ReferenceItem } from '../types';
import { fileToBase64 } from '../utils/helpers';

interface OutfitWorkspaceProps {
  references: ReferenceItem[];
  setReferences: React.Dispatch<React.SetStateAction<ReferenceItem[]>>;
  onOpenProject: () => void;
}

const OutfitWorkspace: React.FC<OutfitWorkspaceProps> = ({
  references,
  setReferences,
  onOpenProject,
}) => {
  const characters = useMemo(
    () => references.filter((item) => item.type === 'character'),
    [references]
  );
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

  useEffect(() => {
    if (characters.length === 0) {
      setSelectedCharacterId(null);
      return;
    }
    setSelectedCharacterId((prev) => {
      if (prev && characters.some((character) => character.id === prev)) {
        return prev;
      }
      return characters[0].id;
    });
  }, [characters]);

  const selectedCharacter = characters.find((item) => item.id === selectedCharacterId) || null;

  const fileToDataUrl = async (file: File) => {
    const base64 = await fileToBase64(file);
    const mime = file.type || 'image/png';
    return `data:${mime};base64,${base64}`;
  };

  const updateCharacter = (characterId: string, updates: Partial<ReferenceItem>) => {
    setReferences((prev) =>
      prev.map((item) => (item.id === characterId ? { ...item, ...updates } : item))
    );
  };

  const updateOutfit = (characterId: string, outfitId: string, updates: Partial<CharacterOutfit>) => {
    setReferences((prev) =>
      prev.map((item) => {
        if (item.id !== characterId) return item;
        const outfits = (item.outfits || []).map((outfit) =>
          outfit.id === outfitId ? { ...outfit, ...updates } : outfit
        );
        return { ...item, outfits };
      })
    );
  };

  const addOutfit = (characterId: string) => {
    const id = `outfit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const newOutfit: CharacterOutfit = {
      id,
      name: 'New Outfit',
      description: '',
      prompt: '',
      imageUrl: undefined,
      clothingReferenceUrls: [],
      isGenerating: false,
      isGeneratingAngles: false,
    };
    setReferences((prev) =>
      prev.map((item) =>
        item.id === characterId ? { ...item, outfits: [...(item.outfits || []), newOutfit] } : item
      )
    );
  };

  const removeOutfit = (characterId: string, outfitId: string) => {
    setReferences((prev) =>
      prev.map((item) => {
        if (item.id !== characterId) return item;
        return { ...item, outfits: (item.outfits || []).filter((outfit) => outfit.id !== outfitId) };
      })
    );
  };

  const addOutfitRefs = async (characterId: string, outfit: CharacterOutfit, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const urls = await Promise.all(Array.from(files).map((file) => fileToDataUrl(file)));
    const next = Array.from(new Set([...(outfit.clothingReferenceUrls || []), ...urls]));
    updateOutfit(characterId, outfit.id, { clothingReferenceUrls: next });
  };

  const removeOutfitRef = (characterId: string, outfit: CharacterOutfit, url: string) => {
    const next = (outfit.clothingReferenceUrls || []).filter((item) => item !== url);
    updateOutfit(characterId, outfit.id, { clothingReferenceUrls: next });
  };

  const openImage = (url?: string | null) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!selectedCharacter) {
    return (
      <div className="h-full p-6">
        <div className="h-full rounded-xl border border-gray-800 bg-gray-900/50 flex flex-col items-center justify-center text-center px-6">
          <div className="text-xl font-semibold text-white">No characters available</div>
          <div className="mt-2 text-sm text-gray-400 max-w-xl">
            Create at least one character in Project Hub first, then manage swimsuit base and outfit references here.
          </div>
          <button
            className="mt-4 px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-500"
            onClick={onOpenProject}
          >
            Open Project Hub
          </button>
        </div>
      </div>
    );
  }

  const outfits = selectedCharacter.outfits || [];

  return (
    <div className="h-full p-5">
      <div className="h-full grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
        <aside className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 overflow-y-auto custom-scrollbar">
          <div className="text-xs uppercase tracking-wide text-gray-500 px-1 mb-2">Characters</div>
          <div className="space-y-2">
            {characters.map((character) => {
              const isActive = character.id === selectedCharacterId;
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedCharacterId(character.id)}
                  className={`w-full text-left rounded-lg border px-2 py-2 transition ${
                    isActive
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-11 h-11 rounded-md overflow-hidden bg-gray-800 border border-gray-700 flex items-center justify-center text-[10px] text-gray-500">
                      {character.imageUrl ? (
                        <img src={character.imageUrl} alt={character.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>No Img</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-white font-semibold truncate">{character.name || 'Character'}</div>
                      <div className="text-[10px] text-gray-500">
                        {(character.outfits || []).length} outfit{(character.outfits || []).length === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 overflow-y-auto custom-scrollbar">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">Outfit Workspace</h2>
              <p className="text-xs text-gray-400 mt-1">
                Manage swimsuit base and clothing references per outfit for {selectedCharacter.name}.
              </p>
            </div>
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded bg-gray-800 text-white border border-gray-700 hover:bg-gray-700"
              onClick={onOpenProject}
            >
              Open Project Hub
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900/80 p-3">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Swimsuit Base (Character)</div>
            <div className="flex flex-wrap gap-3 items-start">
              <button
                type="button"
                onClick={() => openImage(selectedCharacter.swimsuitBaseUrl || selectedCharacter.imageUrl)}
                className="w-24 h-24 rounded-md overflow-hidden border border-gray-700 bg-gray-950 flex items-center justify-center text-[10px] text-gray-500"
              >
                {selectedCharacter.swimsuitBaseUrl ? (
                  <img
                    src={selectedCharacter.swimsuitBaseUrl}
                    alt={`${selectedCharacter.name} swimsuit base`}
                    className="w-full h-full object-cover"
                  />
                ) : selectedCharacter.imageUrl ? (
                  <img src={selectedCharacter.imageUrl} alt={selectedCharacter.name} className="w-full h-full object-cover opacity-80" />
                ) : (
                  <span>No base</span>
                )}
              </button>
              <div className="space-y-2">
                <div className="text-xs text-gray-300">
                  Used as body guide. Final result should still wear the outfit references.
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-200 border border-gray-700 cursor-pointer hover:bg-gray-700">
                    Upload Base
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const url = await fileToDataUrl(file);
                        updateCharacter(selectedCharacter.id, { swimsuitBaseUrl: url });
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {selectedCharacter.imageUrl && (
                    <button
                      type="button"
                      className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-200 border border-gray-700 hover:bg-gray-700"
                      onClick={() =>
                        updateCharacter(selectedCharacter.id, { swimsuitBaseUrl: selectedCharacter.imageUrl || undefined })
                      }
                    >
                      Use Character Image
                    </button>
                  )}
                  {selectedCharacter.swimsuitBaseUrl && (
                    <button
                      type="button"
                      className="text-[11px] px-2 py-1 rounded text-gray-300 border border-gray-700 hover:bg-gray-800"
                      onClick={() => updateCharacter(selectedCharacter.id, { swimsuitBaseUrl: '' })}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Outfit References</div>
            <button
              type="button"
              className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500"
              onClick={() => addOutfit(selectedCharacter.id)}
            >
              Add Outfit
            </button>
          </div>

          {outfits.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-gray-700 p-4 text-xs text-gray-500">
              No outfits yet. Add one and attach clothing references.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {outfits.map((outfit) => {
                const refs = (outfit.clothingReferenceUrls || []).filter(Boolean);
                return (
                  <div key={outfit.id} className="rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                    <div className="flex flex-wrap gap-2 items-center justify-between">
                      <input
                        value={outfit.name}
                        onChange={(event) =>
                          updateOutfit(selectedCharacter.id, outfit.id, { name: event.target.value })
                        }
                        className="bg-gray-800 text-white text-xs px-2 py-1.5 rounded border border-gray-700 min-w-[180px] flex-1"
                      />
                      <div className="text-[10px] text-gray-500">
                        {refs.length} reference{refs.length === 1 ? '' : 's'}
                      </div>
                      <button
                        type="button"
                        className="text-[10px] px-2 py-1 rounded text-red-300 border border-red-400/30 hover:bg-red-500/10"
                        onClick={() => removeOutfit(selectedCharacter.id, outfit.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      value={outfit.prompt}
                      onChange={(event) =>
                        updateOutfit(selectedCharacter.id, outfit.id, { prompt: event.target.value })
                      }
                      rows={2}
                      placeholder="Describe the final outfit the character should wear..."
                      className="mt-2 w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700"
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">Clothing References</div>
                      <label className="text-[10px] px-2 py-1 rounded bg-gray-800 text-white border border-gray-700 cursor-pointer hover:bg-gray-700">
                        Add Refs
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={async (event) => {
                            await addOutfitRefs(selectedCharacter.id, outfit, event.target.files);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                    </div>
                    {refs.length === 0 ? (
                      <div className="mt-2 text-[10px] text-gray-500">
                        Add jacket/pants/shoes/accessory references so generation does not stay in base swimwear.
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                        {refs.map((url, index) => (
                          <div
                            key={`${outfit.id}-ref-${index}`}
                            className="relative w-16 h-16 rounded-md overflow-hidden border border-gray-700 bg-gray-950 flex-shrink-0"
                          >
                            <button type="button" className="absolute inset-0" onClick={() => openImage(url)}>
                              <img src={url} alt={`${outfit.name} reference ${index + 1}`} className="w-full h-full object-cover" />
                            </button>
                            <button
                              type="button"
                              className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center"
                              onClick={(event) => {
                                event.stopPropagation();
                                removeOutfitRef(selectedCharacter.id, outfit, url);
                              }}
                              title="Remove reference"
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default OutfitWorkspace;
