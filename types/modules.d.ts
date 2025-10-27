declare module 'pdf-parse' {
  interface PDFInfo {
    [key: string]: any;
  }

  interface PDFMetadata {
    [key: string]: any;
  }

  interface PDFData {
    numpages: number;
    numrender: number;
    info: PDFInfo;
    metadata: PDFMetadata | null;
    text: string;
    version: string;
  }

  function pdf(
    dataBuffer: Buffer,
    options?: any
  ): Promise<PDFData>;

  export = pdf;
}

declare module 'mammoth' {
  export function extractRawText(options: { buffer: Buffer }): Promise<{ value: string }>;
}

declare module 'formidable' {
  export interface File {
    filepath: string;
    originalFilename: string | null;
    mimetype: string | null;
    size: number;
  }

  export interface Fields {
    [key: string]: string | string[];
  }

  export interface Files {
    [key: string]: File | File[];
  }

  export interface Options {
    uploadDir?: string;
    keepExtensions?: boolean;
    maxFileSize?: number;
    multiples?: boolean;
  }

  export class IncomingForm {
    constructor(options?: Options);
    parse(
      req: any,
      callback: (err: Error | null, fields: Fields, files: Files) => void
    ): void;
  }
}
