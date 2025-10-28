import { IncomingForm, File } from 'formidable';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { NextApiRequest, NextApiResponse } from 'next';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 10, // 10 seconds for Hobby plan (free tier)
};

interface ExtractedData {
  text: string;
  filename: string;
  fileType: string;
}

const extractTextFromPDF = async (filePath: string): Promise<string> => {
  const dataBuffer = await fs.readFile(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
};

const extractTextFromDOCX = async (filePath: string): Promise<string> => {
  const dataBuffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer: dataBuffer });
  return result.value;
};

const extractTextFromTXT = async (filePath: string): Promise<string> => {
  const content = await fs.readFile(filePath, 'utf-8');
  return content;
};

const parseForm = (req: NextApiRequest): Promise<{ fields: any; files: any }> => {
  return new Promise(async (resolve, reject) => {
    // Use /tmp for Vercel, or OS temp directory for localhost
    const uploadDir = process.env.VERCEL ? '/tmp' : os.tmpdir();
    
    // Ensure directory exists
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (err) {
      // Directory might already exist, ignore error
    }

    const form = new IncomingForm({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error('Form parse error:', err);
        reject(err);
      }
      resolve({ fields, files });
    });
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('Extract API called');

  try {
    const { files } = await parseForm(req);
    console.log('Form parsed, files:', files ? 'found' : 'not found');
    
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!file) {
      console.error('No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = file.filepath;
    const fileName = file.originalFilename || 'unknown';
    const fileExt = path.extname(fileName).toLowerCase();

    console.log(`Processing file: ${fileName} (${fileExt}), path: ${filePath}`);

    let extractedText = '';

    // Extract text based on file type
    switch (fileExt) {
      case '.pdf':
        extractedText = await extractTextFromPDF(filePath);
        break;
      case '.docx':
        extractedText = await extractTextFromDOCX(filePath);
        break;
      case '.txt':
        extractedText = await extractTextFromTXT(filePath);
        break;
      default:
        // Try to read as plain text
        try {
          extractedText = await extractTextFromTXT(filePath);
        } catch (error) {
          return res.status(400).json({ 
            error: `Unsupported file type: ${fileExt}. Supported formats: PDF, DOCX, TXT` 
          });
        }
    }

    // Clean up the uploaded file
    await fs.unlink(filePath).catch(console.error);

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ 
        error: 'No text could be extracted from the document' 
      });
    }

    const result: ExtractedData = {
      text: extractedText,
      filename: fileName,
      fileType: fileExt,
    };

    res.status(200).json(result);
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ 
      error: 'Failed to process file',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
