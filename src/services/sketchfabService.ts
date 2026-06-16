
export interface SketchfabModel {
    uid: string;
    name: string;
    description: string;
    uri: string; // API uri
    thumbnails: {
        images: {
            url: string;
            width: number;
            height: number;
        }[];
    };
    user: {
        username: string;
        displayName: string;
    };
    license: {
        label: string;
    };
    faceCount: number;
    vertexCount: number;
    viewCount: number;
    likeCount: number;
}

export interface SketchfabSearchResponse {
    results: SketchfabModel[];
    next?: string;
    previous?: string;
}

const SKETCHFAB_API_BASE = 'https://api.sketchfab.com/v3';

export const searchSketchfabModels = async (
    query: string,
    apiToken?: string
): Promise<SketchfabModel[]> => {
    const params = new URLSearchParams({
        q: query,
        type: 'models',
        downloadable: 'true', // We only want downloadable models
        count: '24',
        sort_by: '-likeCount', // Popular first
    });

    const headers: HeadersInit = {};
    if (apiToken) {
        headers['Authorization'] = `Token ${apiToken}`;
    }

    try {
        const response = await fetch(`${SKETCHFAB_API_BASE}/search?${params.toString()}`, {
            headers,
        });

        if (!response.ok) {
            throw new Error(`Sketchfab search failed: ${response.statusText}`);
        }

        const data = (await response.json()) as SketchfabSearchResponse;
        return data.results;
    } catch (error) {
        console.error('Error searching Sketchfab:', error);
        return [];
    }
};

export const getSketchfabDownloadUrl = async (uid: string, apiToken: string): Promise<string | null> => {
    if (!apiToken) {
        throw new Error('Sketchfab API Token is required to download models.');
    }

    try {
        const response = await fetch(`${SKETCHFAB_API_BASE}/models/${uid}/download`, {
            method: 'GET',
            headers: {
                Authorization: `Token ${apiToken}`,
            },
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || response.statusText);
        }

        const data = await response.json();
        // Sketchfab returns: { glb: { url, size, expires }, gltf: ... }
        // We prefer GLB (single file)
        if (data.glb && data.glb.url) {
            return data.glb.url;
        }
        if (data.gltf && data.gltf.url) {
            return data.gltf.url;
        }

        throw new Error('No supported format (GLB/GLTF) found for this model.');

    } catch (error) {
        console.error('Error getting download URL:', error);
        throw error;
    }
};
