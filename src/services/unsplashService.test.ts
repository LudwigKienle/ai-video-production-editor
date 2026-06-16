import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUnsplashMediaItem,
  buildUnsplashSearchUrl,
  mapUnsplashPhotoToStockAsset,
  searchUnsplashPhotos,
  trackUnsplashDownload,
} from './unsplashService.ts';

const photo = {
  id: 'abc123',
  width: 2400,
  height: 1600,
  color: '#111111',
  description: null,
  alt_description: 'cinematic mountain road',
  urls: {
    raw: 'https://images.unsplash.com/photo-abc?ixid=test',
    full: 'https://images.unsplash.com/photo-abc?ixid=test&fm=jpg',
    regular: 'https://images.unsplash.com/photo-abc?ixid=test&w=1080',
    small: 'https://images.unsplash.com/photo-abc?ixid=test&w=400',
    thumb: 'https://images.unsplash.com/photo-abc?ixid=test&w=200',
  },
  links: {
    html: 'https://unsplash.com/photos/abc123',
    download_location: 'https://api.unsplash.com/photos/abc123/download?ixid=test',
  },
  user: {
    name: 'Ada Shooter',
    links: {
      html: 'https://unsplash.com/@ada',
    },
  },
};

test('buildUnsplashSearchUrl builds a safe stock search request', () => {
  const url = new URL(buildUnsplashSearchUrl(' production design ', { page: 2, perPage: 12, orientation: 'landscape' }));

  assert.equal(url.origin, 'https://api.unsplash.com');
  assert.equal(url.pathname, '/search/photos');
  assert.equal(url.searchParams.get('query'), 'production design');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '12');
  assert.equal(url.searchParams.get('orientation'), 'landscape');
  assert.equal(url.searchParams.get('content_filter'), 'high');
});

test('mapUnsplashPhotoToStockAsset keeps hotlinked images and attribution links', () => {
  const asset = mapUnsplashPhotoToStockAsset(photo);

  assert.equal(asset.id, 'unsplash-abc123');
  assert.equal(asset.kind, 'image');
  assert.equal(asset.url, photo.urls.regular);
  assert.equal(asset.previewUrl, photo.urls.small);
  assert.equal(asset.downloadLocation, photo.links.download_location);
  assert.equal(asset.photographerName, 'Ada Shooter');
  assert.match(asset.photographerUrl, /utm_source=ai_video_production_editor/);
  assert.match(asset.unsplashUrl, /utm_medium=referral/);
});

test('searchUnsplashPhotos authorizes requests and maps response assets', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ results: [photo] }), { status: 200 });
  };

  const results = await searchUnsplashPhotos('road', { accessKey: 'test-access-key', fetcher });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'cinematic mountain road');
  assert.equal(requests[0].init?.headers?.['Authorization'], 'Client-ID test-access-key');
  assert.equal(requests[0].init?.headers?.['Accept-Version'], 'v1');
});

test('trackUnsplashDownload calls the returned download_location endpoint', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ url: photo.urls.full }), { status: 200 });
  };

  const url = await trackUnsplashDownload(photo.links.download_location, { accessKey: 'test-access-key', fetcher });

  assert.equal(url, photo.urls.full);
  assert.equal(requests[0].url, photo.links.download_location);
  assert.equal(requests[0].init?.headers?.['Authorization'], 'Client-ID test-access-key');
});

test('buildUnsplashMediaItem stores stock photos with source attribution metadata', () => {
  const asset = mapUnsplashPhotoToStockAsset(photo);
  const item = buildUnsplashMediaItem(asset);

  assert.equal(item.type, 'image');
  assert.equal(item.url, asset.url);
  assert.equal(item.source, 'unsplash');
  assert.equal(item.generatedBy, 'Unsplash Stock');
  assert.match(item.prompt || '', /Ada Shooter/);
});
