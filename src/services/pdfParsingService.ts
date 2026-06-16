import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

let pdfJsConfigured = false;

const SCENE_HEADING_REGEX = /^\s*(?:\d{1,4}[A-Z]?(?:[.)-])?\s+)?(INT\.?|EXT\.?|INT\/EXT\.?|EXT\/INT\.?|I\/E\.?|E\/I\.?)\b/i;

const getPdfJsLib = async (): Promise<any> => {
    if (!pdfJsConfigured) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        pdfJsConfigured = true;
    }
    return pdfjsLib;
};

/**
 * Parses a PDF file to extract script content, intelligently identifying and tagging
 * different elements like scene headings, actions, and dialogue based on layout.
 * @param file The PDF file to parse.
 * @returns A promise that resolves with the structured and tagged script text.
 */
export const parsePdfScript = (file: File, options?: { maxPages?: number }): Promise<string> => {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            try {
                const pdfjs = await getPdfJsLib();
                const typedarray = new Uint8Array(this.result as ArrayBuffer);
                const pdf = await pdfjs.getDocument({ data: typedarray, disableWorker: true }).promise;
                const pageLimit = options?.maxPages ?? pdf.numPages;
                const pageCount = Math.min(pdf.numPages, pageLimit);

                const allLineData: { text: string; x: number; }[] = [];

                for (let i = 1; i <= pageCount; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    if (!textContent.items || textContent.items.length === 0) {
                        continue;
                    }

                    // Group text items into lines based on Y-coordinate
                    const lines = new Map<number, any[]>();
                    textContent.items.forEach((item: any) => {
                        const y = Math.round(item.transform[5]); // Round Y to group items on the same line
                        if (!lines.has(y)) lines.set(y, []);
                        lines.get(y)!.push(item);
                    });

                    // Sort lines by Y-coordinate (top to bottom)
                    const sortedY = Array.from(lines.keys()).sort((a, b) => b - a);

                    for (const y of sortedY) {
                        // Sort items within a line by X-coordinate (left to right)
                        const items = lines.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
                        const text = items.map((item: any) => item.str).join('').trim();
                        if (text) {
                            allLineData.push({ text, x: items[0].transform[4] });
                        }
                    }
                }

                if (allLineData.length === 0) {
                    resolve('');
                    return;
                }

                // 1. Determine common indentation levels from the document structure
                const xCoordinates = allLineData.map(line => Math.round(line.x));
                const xCounts = xCoordinates.reduce((acc, x) => {
                    acc[x] = (acc[x] || 0) + 1;
                    return acc;
                }, {} as Record<number, number>);

                const sortedX = Object.entries(xCounts).sort((a, b) => b[1] - a[1]).map(e => parseInt(e[0]));

                const actionMargin = sortedX[0] || 50;
                const dialogueMargin = sortedX.find(x => x > actionMargin + 20) || actionMargin * 2.5;
                const characterMargin = sortedX.find(x => x > dialogueMargin + 20) || actionMargin * 3.5;

                // 2. Classify and format each line with tags for the AI
                const formattedLines: string[] = [];
                let lastLineType: 'CHARACTER' | null = null;
                let successfulClassifications = 0;

                const ignoredSectionsRegex = /^(REFERENCES \/\/|OUTFITS \/\/|CAST LIST)/i;
                let inIgnoredSection = false;

                for (const line of allLineData) {
                    const { text, x } = line;

                    if (ignoredSectionsRegex.test(text)) {
                        inIgnoredSection = true;
                        continue;
                    }
                    if (inIgnoredSection) continue;

                    const isAllUpperCase = text === text.toUpperCase() && /[A-Z]/.test(text);
                    const headingCandidate = text.replace(/\s+/g, ' ').trim();
                    const isSceneHeading = SCENE_HEADING_REGEX.test(headingCandidate);
                    const isAtMargin = (targetMargin: number) => Math.abs(x - targetMargin) < 25; // Increased tolerance

                    if (isSceneHeading && (isAtMargin(actionMargin) || x <= actionMargin + 45)) {
                        const normalizedSceneHeading = headingCandidate
                            .replace(/^\s*\d{1,4}[A-Z]?(?:[.)-])?\s+/, '')
                            .replace(/\s+\d{1,4}[A-Z]?\s*$/, '')
                            .replace(/^\s*INT\s*\/\s*EXT\.?/i, 'INT/EXT.')
                            .replace(/^\s*EXT\s*\/\s*INT\.?/i, 'EXT/INT.')
                            .replace(/\s+/g, ' ')
                            .trim()
                            .toUpperCase();
                        formattedLines.push(`\n[SCENE] ${normalizedSceneHeading}`);
                        lastLineType = null;
                        successfulClassifications++;
                    } else if (isAllUpperCase && isAtMargin(characterMargin) && !text.endsWith(':') && text.length < 35) {
                        formattedLines.push(`\n[CHARACTER] ${text}`);
                        lastLineType = 'CHARACTER';
                        successfulClassifications++;
                    } else if (lastLineType === 'CHARACTER' && isAtMargin(dialogueMargin)) {
                        formattedLines.push(`[DIALOGUE] ${text}`);
                        // lastLineType remains 'CHARACTER' for multi-line dialogue
                        successfulClassifications++;
                    } else if (isAtMargin(actionMargin)) {
                        formattedLines.push(`[ACTION] ${text}`);
                        lastLineType = null;
                    } else {
                        // Keep lines we can't classify (e.g., page numbers, transitions), but don't tag them
                        formattedLines.push(text);
                        lastLineType = null;
                    }
                }

                const finalScript = formattedLines.join('\n');

                // If structured parsing was ineffective, fall back to a simpler text extraction.
                if (successfulClassifications < 5) {
                    console.warn("Structured parsing was not effective, falling back to simple text extraction.");
                    const simpleText = allLineData
                        .map(l => l.text)
                        .filter(text => !ignoredSectionsRegex.test(text))
                        .join('\n');
                    resolve(simpleText);
                } else {
                    resolve(finalScript);
                }

            } catch (pdfError) {
                if (pdfError && typeof pdfError === 'object' && 'name' in pdfError && (pdfError as any).name === 'PasswordException') {
                    reject(new Error('This PDF is password-protected. Please export an unprotected PDF.'));
                    return;
                }
                reject(pdfError instanceof Error ? new Error(`PDF Parsing Error: ${pdfError.message}`) : new Error('Failed to parse the PDF file.'));
            }
        };
        fileReader.onerror = () => {
            reject(new Error('An error occurred while reading the file.'));
        };
        fileReader.readAsArrayBuffer(file);
    });
};

export type PdfImageExtraction = {
    page: number;
    dataUrl: string;
    width: number;
    height: number;
};

export const extractPdfPageImages = (
    file: File,
    options?: {
        scale?: number;
        maxPages?: number;
        imageOnly?: boolean;
        concurrency?: number;
        onProgress?: (processed: number, total: number) => void;
        maxDimension?: number;
        outputFormat?: 'image/jpeg' | 'image/png';
        quality?: number;
        forcePortrait?: boolean;
    }
): Promise<PdfImageExtraction[]> => {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            try {
                const pdfjs = await getPdfJsLib();
                const typedarray = new Uint8Array(this.result as ArrayBuffer);
                const pdf = await pdfjs.getDocument({ data: typedarray, disableWorker: true }).promise;
                const scale = options?.scale ?? 1.1;
                const pageLimit = options?.maxPages ?? pdf.numPages;
                const pageCount = Math.min(pdf.numPages, pageLimit);
                const imagesByPage: PdfImageExtraction[][] = Array.from({ length: pageCount }, () => []);
                const concurrency = Math.max(1, Math.min(options?.concurrency ?? 2, 6));
                const maxDimension = Math.max(512, options?.maxDimension ?? 1280);
                const outputFormat = options?.outputFormat ?? 'image/jpeg';
                const quality = Math.max(0.45, Math.min(0.9, options?.quality ?? 0.72));
                let processedPages = 0;
                let nextPage = 1;

                const normalizeCanvasForOutput = (sourceCanvas: HTMLCanvasElement) => {
                    let canvas = sourceCanvas;
                    if (options?.forcePortrait && canvas.width > canvas.height) {
                        const rotated = document.createElement('canvas');
                        rotated.width = canvas.height;
                        rotated.height = canvas.width;
                        const rCtx = rotated.getContext('2d');
                        if (rCtx) {
                            rCtx.translate(rotated.width / 2, rotated.height / 2);
                            rCtx.rotate(Math.PI / 2);
                            rCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
                            canvas = rotated;
                        }
                    }

                    const largestSide = Math.max(canvas.width, canvas.height);
                    if (largestSide > maxDimension) {
                        const ratio = maxDimension / largestSide;
                        const resized = document.createElement('canvas');
                        resized.width = Math.max(1, Math.round(canvas.width * ratio));
                        resized.height = Math.max(1, Math.round(canvas.height * ratio));
                        const resizeCtx = resized.getContext('2d');
                        if (resizeCtx) {
                            resizeCtx.drawImage(canvas, 0, 0, resized.width, resized.height);
                            canvas = resized;
                        }
                    }

                    return canvas;
                };

                const canvasToExtraction = (pageNumber: number, canvas: HTMLCanvasElement): PdfImageExtraction => {
                    const normalized = normalizeCanvasForOutput(canvas);
                    const dataUrl = outputFormat === 'image/png'
                        ? normalized.toDataURL('image/png')
                        : normalized.toDataURL('image/jpeg', quality);
                    return {
                        page: pageNumber,
                        dataUrl,
                        width: normalized.width,
                        height: normalized.height,
                    };
                };

                const rawToCanvas = (raw: any): HTMLCanvasElement | null => {
                    if (!raw || !raw.width || !raw.height) return null;
                    const canvas = document.createElement('canvas');
                    canvas.width = raw.width;
                    canvas.height = raw.height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return null;
                    if (raw instanceof ImageBitmap) {
                        ctx.drawImage(raw, 0, 0);
                        return canvas;
                    }
                    if (raw instanceof HTMLCanvasElement) {
                        ctx.drawImage(raw, 0, 0);
                        return canvas;
                    }
                    const kind = raw.kind;
                    const ImageKind = pdfjs.ImageKind;
                    if (!raw.data || !kind) return null;
                    let data: Uint8ClampedArray;
                    if (kind === ImageKind.RGBA_32BPP) {
                        data = new Uint8ClampedArray(raw.data);
                    } else if (kind === ImageKind.RGB_24BPP) {
                        const rgb = raw.data;
                        data = new Uint8ClampedArray(raw.width * raw.height * 4);
                        for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
                            data[j] = rgb[i];
                            data[j + 1] = rgb[i + 1];
                            data[j + 2] = rgb[i + 2];
                            data[j + 3] = 255;
                        }
                    } else {
                        return null;
                    }
                    // Normalize into a plain ArrayBuffer-backed typed array for ImageData typings.
                    const imageData = new ImageData(new Uint8ClampedArray(Array.from(data)), raw.width, raw.height);
                    ctx.putImageData(imageData, 0, 0);
                    return canvas;
                };

                const getImageObject = (container: any, name: string) =>
                    new Promise<any>((resolveObj) => {
                        if (!container || !container.get) {
                            resolveObj(null);
                            return;
                        }
                        try {
                            container.get(name, (obj: any) => resolveObj(obj));
                        } catch {
                            resolveObj(null);
                        }
                    });

                const extractEmbeddedImagesForPage = async (pageNumber: number) => {
                    const page = await pdf.getPage(pageNumber);
                    const opList = await page.getOperatorList();
                    const OPS = pdfjs.OPS;
                    const seen = new Set<string>();
                    const pageImages: PdfImageExtraction[] = [];

                    for (let i = 0; i < opList.fnArray.length; i++) {
                        const fn = opList.fnArray[i];
                        const args = opList.argsArray[i] || [];
                        if (fn === OPS.paintInlineImageXObject) {
                            const inlineImg = args[0];
                            const sourceCanvas = rawToCanvas(inlineImg);
                            if (sourceCanvas) {
                                pageImages.push(canvasToExtraction(pageNumber, sourceCanvas));
                            }
                            continue;
                        }
                        if (
                            fn === OPS.paintImageXObject ||
                            fn === OPS.paintImageXObjectRepeat ||
                            fn === OPS.paintJpegXObject
                        ) {
                            const name = args[0];
                            if (!name || seen.has(name)) continue;
                            seen.add(name);
                            const [objA, objB] = await Promise.all([
                                getImageObject(page.objs, name),
                                getImageObject(page.commonObjs, name),
                            ]);
                            const raw = objA || objB;
                            const sourceCanvas = rawToCanvas(raw);
                            if (sourceCanvas) {
                                pageImages.push(canvasToExtraction(pageNumber, sourceCanvas));
                            }
                        }
                    }
                    return pageImages;
                };

                const processPage = async (pageNumber: number) => {
                    if (options?.imageOnly) {
                        const pageImages = await extractEmbeddedImagesForPage(pageNumber);
                        if (pageImages.length > 0) {
                            imagesByPage[pageNumber - 1] = pageImages;
                            return;
                        }
                    }
                    const page = await pdf.getPage(pageNumber);
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    if (!context) {
                        return;
                    }
                    canvas.width = Math.ceil(viewport.width);
                    canvas.height = Math.ceil(viewport.height);
                    await page.render({ canvasContext: context, viewport }).promise;
                    imagesByPage[pageNumber - 1] = [canvasToExtraction(pageNumber, canvas)];
                };

                const runWorker = async () => {
                    while (true) {
                        const pageNumber = nextPage;
                        nextPage += 1;
                        if (pageNumber > pageCount) {
                            return;
                        }
                        await processPage(pageNumber);
                        processedPages += 1;
                        options?.onProgress?.(processedPages, pageCount);
                    }
                };

                const workerCount = Math.min(concurrency, pageCount);
                await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
                resolve(imagesByPage.flat());
            } catch (pdfError) {
                reject(pdfError instanceof Error ? pdfError : new Error('Failed to extract PDF images.'));
            }
        };
        fileReader.onerror = () => {
            reject(new Error('An error occurred while reading the file.'));
        };
        fileReader.readAsArrayBuffer(file);
    });
};
