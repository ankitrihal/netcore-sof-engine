// Types for exportSOF.js, so TypeScript files can import it with full checking.
import type { SofExportData } from '../components/SofDashboard';
import type { Country } from './access';

export declare const TEMPLATES: Record<Country, string>;
export declare const TEMPLATE_URL: string;
export declare const COUNTRY_ENTITY: Record<Country, Record<string, unknown>>;
export declare function resolveCountry(data: Partial<SofExportData>): Country;
export declare function templateUrlFor(country: Country): string;
export declare function money(n: number): string;
export declare function moneyShort(n: number): string;
export declare function monthsInWords(n: number): string;
export declare function monthsCountText(n: number): string;
export declare function longDate(iso: string | null): string;
export declare function shortDate(iso: string | null): string;
export declare function buildSofTemplateData(data: SofExportData | (Omit<SofExportData, 'country'> & { country?: Country })): Record<string, unknown>;
export declare function renderSof(templateBuffer: ArrayBuffer, data: SofExportData | (Omit<SofExportData, 'country'> & { country?: Country })): Blob;
export type ExportFormat = 'docx' | 'pdf' | 'both';
export declare const EXPORT_FORMATS: ExportFormat[];
export declare function pngFromDataUrl(dataUrl: string | null | undefined): { bytes: Uint8Array; width: number; height: number } | null;
export declare function sofFileName(clientName: string, country?: Country, ext?: 'docx' | 'pdf'): string;
export interface ExportedFile { name: string; blob: Blob }
export declare const BOTH_DOWNLOAD_GAP_MS: number;
export declare function exportSOF(data: SofExportData, format?: ExportFormat): Promise<ExportedFile[]>;
export declare function downloadAgain(file: ExportedFile): void;
