import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assignToBin,
    breadcrumbs,
    cleanBinName,
    countByKind,
    filterEntries,
    formatBytes,
    formatDuration,
    gridColumns,
    joinPath,
    kindFromName,
    matchImportedMedia,
    moveFocusIndex,
    orderForSequence,
    parentPath,
    pathToFileUrl,
    pruneSelection,
    pushRecent,
    selectRange,
    sortEntries,
    splitSequenceTracks,
    toggleFavorite,
    toggleSelection,
    EMPTY_SELECTION,
} from './mediaBrowserModel.ts';
import type { BrowserEntry } from './mediaBrowserModel.ts';

const entry = (name: string, extra: Partial<BrowserEntry> = {}): BrowserEntry => ({
    id: name,
    name,
    kind: extra.isDir ? 'folder' : kindFromName(name),
    isDir: false,
    origin: 'fs',
    ...extra,
});

test('paths: join, parent and breadcrumbs (posix, home, windows)', () => {
    assert.equal(joinPath('/home/ana/', 'Clips'), '/home/ana/Clips');
    assert.equal(joinPath('/', 'tmp'), '/tmp');
    assert.equal(parentPath('/home/ana/Clips'), '/home/ana');
    assert.equal(parentPath('/home'), '/');
    assert.equal(parentPath('/'), null);
    assert.equal(parentPath('C:\\Media\\Day1'), 'C:\\Media');
    assert.equal(parentPath('C:\\Media'), 'C:\\');
    assert.equal(parentPath('C:\\'), null);

    assert.deepEqual(breadcrumbs('/srv/media/day1'), [
        { label: '/', path: '/' },
        { label: 'srv', path: '/srv' },
        { label: 'media', path: '/srv/media' },
        { label: 'day1', path: '/srv/media/day1' },
    ]);
    assert.deepEqual(breadcrumbs('/home/ana/Movies/Dreh', { home: '/home/ana', homeLabel: 'Benutzer' }), [
        { label: 'Benutzer', path: '/home/ana' },
        { label: 'Movies', path: '/home/ana/Movies' },
        { label: 'Dreh', path: '/home/ana/Movies/Dreh' },
    ]);
    assert.deepEqual(breadcrumbs('/home/anabel', { home: '/home/ana' }).map((c) => c.label), ['/', 'home', 'anabel'], 'prefix of another folder is not home');
    assert.deepEqual(breadcrumbs('C:\\Media\\Day1'), [
        { label: 'C:', path: 'C:\\' },
        { label: 'Media', path: 'C:\\Media' },
        { label: 'Day1', path: 'C:\\Media\\Day1' },
    ]);
    assert.equal(pathToFileUrl('/srv/my clips/a#1.mov'), 'file:///srv/my%20clips/a%231.mov');
    assert.equal(pathToFileUrl('C:\\Media\\a.mov'), 'file:///C:/Media/a.mov');
});

test('filters by type and search, folders stay visible, sorting puts folders first', () => {
    const list = [
        entry('B-Roll', { isDir: true }),
        entry('shot10.mov', { mtime: 3, size: 30 }),
        entry('shot2.mov', { mtime: 1, size: 50 }),
        entry('still.PNG', { mtime: 2, size: 10 }),
        entry('vo take.wav', { mtime: 4, size: 20 }),
        entry('notes.txt'),
    ];
    assert.deepEqual(filterEntries(list, { kind: 'video' }).map((e) => e.name), ['B-Roll', 'shot10.mov', 'shot2.mov']);
    assert.deepEqual(filterEntries(list, { query: 'vo TAKE' }).map((e) => e.name), ['vo take.wav']);
    assert.ok(!filterEntries(list).some((e) => e.name === 'notes.txt'), 'non-media hidden by default');
    assert.ok(filterEntries(list, { showOther: true }).some((e) => e.name === 'notes.txt'));
    assert.deepEqual(sortEntries(list.slice(0, 5)).map((e) => e.name), ['B-Roll', 'shot2.mov', 'shot10.mov', 'still.PNG', 'vo take.wav'], 'natural name order');
    assert.deepEqual(sortEntries(list.slice(1, 5), 'size', true).map((e) => e.name), ['shot2.mov', 'shot10.mov', 'vo take.wav', 'still.PNG']);
    assert.deepEqual(sortEntries(list.slice(0, 5), 'date').map((e) => e.name)[0], 'B-Roll');
    assert.deepEqual(countByKind(list), { all: 4, video: 2, image: 1, audio: 1 });
});

test('selection keeps click order, supports shift ranges and pruning', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    let sel = toggleSelection(EMPTY_SELECTION, 'd');
    sel = toggleSelection(sel, 'b');
    assert.deepEqual(sel.ids, ['d', 'b']);
    sel = selectRange(sel, order, 'e');
    assert.deepEqual(sel.ids, ['d', 'b', 'c', 'e'], 'range from anchor b to e appends missing ids in view order');
    sel = toggleSelection(sel, 'c');
    assert.deepEqual(sel.ids, ['d', 'b', 'e']);
    const back = selectRange({ ids: ['d'], anchor: 'd' }, order, 'b');
    assert.deepEqual(back.ids, ['d', 'c', 'b'], 'backwards range walks from the anchor');
    assert.deepEqual(pruneSelection(sel, new Set(['b', 'e'])).ids, ['b', 'e']);
});

test('keyboard focus moves through a grid and clamps', () => {
    assert.equal(moveFocusIndex(-1, 'ArrowRight', 4, 10), 0);
    assert.equal(moveFocusIndex(-1, 'ArrowDown', 4, 10), 0);
    assert.equal(moveFocusIndex(1, 'ArrowDown', 4, 10), 5);
    assert.equal(moveFocusIndex(8, 'ArrowDown', 4, 10), 9);
    assert.equal(moveFocusIndex(2, 'ArrowUp', 4, 10), 0);
    assert.equal(moveFocusIndex(9, 'ArrowRight', 4, 10), 9);
    assert.equal(moveFocusIndex(3, 'End', 4, 10), 9);
    assert.equal(moveFocusIndex(3, 'x', 4, 10), 3);
    assert.equal(moveFocusIndex(0, 'ArrowRight', 4, 0), -1);
    assert.equal(gridColumns(1000, 180, 10), 5);
    assert.equal(gridColumns(100, 180, 10), 1);
});

test('sequence order: by selection, name or date; folders and non-media skipped; tracks split', () => {
    const list = [entry('c.mov', { mtime: 1 }), entry('a.png', { mtime: 3 }), entry('b.wav', { mtime: 2 }), entry('Dir', { isDir: true }), entry('x.txt')];
    const byId = new Map(list.map((e) => [e.id, e]));
    const ids = ['b.wav', 'Dir', 'c.mov', 'x.txt', 'a.png'];
    assert.deepEqual(orderForSequence(ids, byId).map((e) => e.name), ['b.wav', 'c.mov', 'a.png']);
    assert.deepEqual(orderForSequence(ids, byId, 'name').map((e) => e.name), ['a.png', 'b.wav', 'c.mov']);
    assert.deepEqual(orderForSequence(ids, byId, 'date').map((e) => e.name), ['c.mov', 'b.wav', 'a.png']);
    const tracks = splitSequenceTracks(orderForSequence(ids, byId));
    assert.deepEqual(tracks.visual.map((e) => e.name), ['c.mov', 'a.png']);
    assert.deepEqual(tracks.audio.map((e) => e.name), ['b.wav']);
});

test('imported media are matched by url first, then by new name', () => {
    const before = new Set(['m1']);
    const items = [
        { id: 'm1', name: 'old.mov', url: 'blob:1', originUrl: 'file:///lib/old.mov' },
        { id: 'm2', name: 'dup.png', url: 'blob:2' },
        { id: 'm3', name: 'dup.png', url: 'blob:3' },
    ];
    const result = matchImportedMedia([
        { key: 'k1', name: 'old.mov', url: 'file:///lib/old.mov' },
        { key: 'k2', name: 'dup.png' },
        { key: 'k3', name: 'dup.png' },
        { key: 'k4', name: 'missing.wav' },
    ], before, items);
    assert.deepEqual(result, { k1: 'm1', k2: 'm2', k3: 'm3', k4: null });
});

test('recent, favourites, bins and formatting', () => {
    assert.deepEqual(pushRecent(['/a', '/b', '/c'], '/c/', 3), ['/c', '/a', '/b']);
    assert.deepEqual(toggleFavorite(['/a'], '/b'), ['/a', '/b']);
    assert.deepEqual(toggleFavorite(['/a', '/b'], '/a'), ['/b']);
    assert.equal(cleanBinName('  Dreh   Tag 1 ', []), 'Dreh Tag 1');
    assert.equal(cleanBinName('', ['Ablage 1']), 'Ablage 2');
    assert.deepEqual(assignToBin({ X: ['m1'] }, 'X', ['m1', 'm2']), { X: ['m1', 'm2'] });
    assert.equal(formatBytes(1536), '1,5 KB');
    assert.equal(formatBytes(0), '');
    assert.equal(formatDuration(65.4), '1:05');
    assert.equal(formatDuration(3725), '1:02:05');
});

test('frame rate estimate snaps to common rates', async () => {
    const { snapFrameRate, frameRateFromIntervals } = await import('./mediaBrowserModel.ts');
    assert.equal(snapFrameRate(29.9), 29.97);
    assert.equal(snapFrameRate(24.02), 24);
    assert.equal(snapFrameRate(37.3), 37.3);
    assert.equal(frameRateFromIntervals([1 / 25, 1 / 25, 0.08, 1 / 25, 1 / 25]), 25);
    assert.equal(frameRateFromIntervals([0.04]), null);
});

test('entries from paths and URLs for agent imports', async () => {
    const { entryFromLocation } = await import('./mediaBrowserModel.ts');
    const fromPath = entryFromLocation('/srv/dreh/A001 C003.mov');
    assert.equal(fromPath?.kind, 'video');
    assert.equal(fromPath?.name, 'A001 C003.mov');
    assert.equal(fromPath?.url, 'file:///srv/dreh/A001%20C003.mov');
    assert.equal(entryFromLocation('https://cdn.example.org/a/b/still%201.png?x=1')?.name, 'still 1.png');
    assert.equal(entryFromLocation('data:audio/wav;base64,AAAA')?.kind, 'audio');
    assert.equal(entryFromLocation('file:///srv/x/take.wav')?.path, '/srv/x/take.wav');
    assert.equal(entryFromLocation('/srv/notes.txt'), null);
    assert.equal(entryFromLocation(''), null);
});
