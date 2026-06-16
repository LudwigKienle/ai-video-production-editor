import mammoth from 'mammoth/mammoth.browser';
import * as XLSX from '@e965/xlsx';
import { parsePdfScript } from './pdfParsingService';

const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) || '');
        reader.onerror = () => reject(new Error('Failed to read text file.'));
        reader.readAsText(file);
    });

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error('Failed to read binary file.'));
        reader.readAsArrayBuffer(file);
    });

const getFileExtension = (name: string) => {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
};

const parseDocx = async (file: File) => {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return (result.value || '').trim();
};

const parseSpreadsheet = async (file: File, extension: string) => {
    if (extension === 'csv' || file.type === 'text/csv') {
        return (await readFileAsText(file)).trim();
    }

    const arrayBuffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    const sheetChunks = workbook.SheetNames.slice(0, 8)
        .map((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
            if (!csv) return '';
            return `# Sheet: ${sheetName}\n${csv}`;
        })
        .filter(Boolean);

    return sheetChunks.join('\n\n');
};

export const parseScriptDocument = async (file: File): Promise<string> => {
    const extension = getFileExtension(file.name);

    if (extension === 'pdf') {
        return parsePdfScript(file);
    }
    if (extension === 'docx') {
        return parseDocx(file);
    }
    if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
        return parseSpreadsheet(file, extension);
    }
    if (extension === 'txt' || extension === 'md' || extension === 'json') {
        return readFileAsText(file);
    }
    if (file.type.startsWith('text/')) {
        return readFileAsText(file);
    }

    throw new Error(
        `Unsupported file format ".${extension || 'unknown'}". Use PDF, DOCX, XLSX/XLS/CSV, TXT, MD, or JSON.`
    );
};
