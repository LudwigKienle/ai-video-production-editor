// Add pdfjsLib to the window scope for TypeScript
declare const pdfjsLib: any;

/**
 * Parses a PDF file to extract script content, intelligently identifying and tagging
 * different elements like scene headings, actions, and dialogue based on layout.
 * @param file The PDF file to parse.
 * @returns A promise that resolves with the structured and tagged script text.
 */
export const parsePdfScript = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (typeof pdfjsLib === 'undefined' || !pdfjsLib.getDocument) {
            reject(new Error('The PDF library is still loading. Please wait a moment and try uploading again.'));
            return;
        }

        const fileReader = new FileReader();
        fileReader.onload = async function() {
            try {
                const typedarray = new Uint8Array(this.result as ArrayBuffer);
                const pdf = await pdfjsLib.getDocument(typedarray).promise;

                const allLineData: { text: string; x: number; }[] = [];

                for (let i = 1; i <= pdf.numPages; i++) {
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
                    const isSceneHeading = (text.startsWith('INT.') || text.startsWith('EXT.')) && isAllUpperCase;
                    const isAtMargin = (targetMargin: number) => Math.abs(x - targetMargin) < 25; // Increased tolerance

                    if (isSceneHeading && isAtMargin(actionMargin)) {
                        formattedLines.push(`\n[SCENE] ${text}`);
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
                reject(pdfError instanceof Error ? `PDF Parsing Error: ${pdfError.message}` : new Error('Failed to parse the PDF file.'));
            }
        };
        fileReader.onerror = () => {
            reject(new Error('An error occurred while reading the file.'));
        };
        fileReader.readAsArrayBuffer(file);
    });
};